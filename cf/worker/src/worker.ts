import { wsClientMsgSchema, type RoomSummary, type WsServerMsg } from './protocol';
import { DurableObject } from 'cloudflare:workers';

type Env = { LOBBY: DurableObjectNamespace<Lobby>; ALLOWED_ORIGINS: string };
type PlayerConn = {
  id: string;
  playerName: string;
  joinedRoomId: string | null;
  role: 'host' | 'guest' | null;
  createdAt: number;
  tokens: number;
  updatedAt: number;
};
type Room = { roomId: string; createdAt: number; host: WebSocket; guest: WebSocket | null };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'hockey-lobby' });
    if (url.pathname !== '/ws') return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const origin = request.headers.get('Origin');
    if (origin && !env.ALLOWED_ORIGINS.split(',').includes(origin)) {
      return new Response('Origin not allowed', { status: 403 });
    }
    return env.LOBBY.get(env.LOBBY.idFromName('global')).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class Lobby extends DurableObject<Env> {
  private conns = new Map<WebSocket, PlayerConn>();
  private rooms = new Map<string, Room>();

  constructor(private state: DurableObjectState, env: Env) {
    super(state, env);
    // WebSocket attachment 使房间能够随 Durable Object 休眠恢复。
    for (const socket of state.getWebSockets()) {
      const conn = socket.deserializeAttachment() as PlayerConn;
      this.conns.set(socket, conn);
      if (conn.joinedRoomId && conn.role === 'host') {
        this.rooms.set(conn.joinedRoomId, { roomId: conn.joinedRoomId, createdAt: conn.createdAt, host: socket, guest: null });
      }
    }
    for (const [socket, conn] of this.conns) {
      if (conn.joinedRoomId && conn.role === 'guest') {
        const room = this.rooms.get(conn.joinedRoomId);
        if (room) room.guest = socket;
        else this.clearRoom(socket);
      }
    }
  }

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    const now = Date.now();
    this.conns.set(server, {
      id: crypto.randomUUID(), playerName: 'Player', joinedRoomId: null, role: null,
      createdAt: now, tokens: 180, updatedAt: now,
    });
    this.save(server);
    this.send(server, { type: 'lobby:state', rooms: this.listRooms() });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string' || new TextEncoder().encode(data).byteLength > 64_000) {
      socket.close(1009, 'Message too large or unsupported');
      this.onClose(socket);
      return;
    }
    const conn = this.conns.get(socket);
    if (!conn) throw new Error('Connection not registered');
    const now = Date.now();
    conn.tokens = Math.min(180, conn.tokens + (now - conn.updatedAt) * 0.09) - 1;
    conn.updatedAt = now;
    if (conn.tokens < 0) {
      socket.close(1008, 'Message rate exceeded');
      this.onClose(socket);
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      this.send(socket, { type: 'error', code: 'bad_json', message: 'Invalid JSON' });
      return;
    }
    const parsed = wsClientMsgSchema.safeParse(payload);
    if (!parsed.success) {
      this.send(socket, { type: 'error', code: 'invalid_message', message: 'Invalid request' });
      return;
    }
    const msg = parsed.data;
    switch (msg.type) {
      case 'lobby:hello':
        conn.playerName = msg.playerName;
        this.save(socket);
        if (conn.joinedRoomId) this.notifyBoth(this.rooms.get(conn.joinedRoomId)!);
        this.send(socket, { type: 'lobby:state', rooms: this.listRooms() });
        return;
      case 'lobby:list':
        this.send(socket, { type: 'lobby:state', rooms: this.listRooms() });
        return;
      case 'ping':
        this.send(socket, { type: 'pong', t: msg.t });
        return;
      case 'room:create': {
        if (conn.joinedRoomId) this.leaveRoom(socket);
        const roomId = this.generateRoomId();
        const room = { roomId, createdAt: now, host: socket, guest: null };
        this.rooms.set(roomId, room);
        Object.assign(conn, { joinedRoomId: roomId, role: 'host', createdAt: now });
        this.save(socket);
        this.send(socket, { type: 'room:created', room: this.toSummary(room), role: 'host' });
        this.broadcastLobby();
        return;
      }
      case 'room:join': {
        const room = this.rooms.get(msg.roomId);
        if (!room) return this.error(socket, 'room_not_found', 'Room not found');
        if (room.host !== socket && room.guest && room.guest !== socket) {
          return this.error(socket, 'room_full', 'Room is full');
        }
        if (conn.joinedRoomId && conn.joinedRoomId !== room.roomId) this.leaveRoom(socket);
        const role = room.host === socket ? 'host' : 'guest';
        if (role === 'guest') room.guest = socket;
        Object.assign(conn, { joinedRoomId: room.roomId, role, createdAt: room.createdAt });
        this.save(socket);
        this.notifyBoth(room);
        this.broadcastLobby();
        return;
      }
      case 'room:leave':
        if (conn.joinedRoomId !== msg.roomId) return this.error(socket, 'not_in_room', 'You are not in this room');
        this.leaveRoom(socket);
        this.send(socket, { type: 'room:left', roomId: msg.roomId });
        this.broadcastLobby();
        return;
      case 'game:input':
      case 'game:snapshot': {
        const room = this.rooms.get(msg.roomId);
        if (!room || conn.joinedRoomId !== room.roomId) return this.error(socket, 'not_in_room', 'You are not in this room');
        const expected = msg.type === 'game:snapshot' ? room.host : room.guest;
        if (socket !== expected) return this.error(socket, 'wrong_role', 'This action belongs to the other player');
        const target = msg.type === 'game:snapshot' ? room.guest : room.host;
        if (target) this.send(target, msg);
        return;
      }
    }
  }

  webSocketClose(socket: WebSocket) {
    this.onClose(socket);
    socket.close(1000, 'Connection closed');
  }

  webSocketError(socket: WebSocket) {
    this.onClose(socket);
    socket.close(1011, 'Connection error');
  }

  private onClose(socket: WebSocket) {
    if (!this.conns.has(socket)) return;
    this.leaveRoom(socket);
    this.conns.delete(socket);
    this.broadcastLobby();
  }

  private leaveRoom(socket: WebSocket) {
    const conn = this.conns.get(socket)!;
    const room = conn.joinedRoomId ? this.rooms.get(conn.joinedRoomId) : undefined;
    this.clearRoom(socket);
    if (!room) return;
    if (room.host === socket) {
      this.rooms.delete(room.roomId);
      if (room.guest) {
        this.clearRoom(room.guest);
        this.send(room.guest, { type: 'room:closed', roomId: room.roomId, reason: 'Host left the room' });
      }
    } else if (room.guest === socket) {
      room.guest = null;
      this.notifyBoth(room);
    }
  }

  private clearRoom(socket: WebSocket) {
    const conn = this.conns.get(socket)!;
    conn.joinedRoomId = null;
    conn.role = null;
    this.save(socket);
  }

  private save(socket: WebSocket) { socket.serializeAttachment(this.conns.get(socket)); }

  private notifyBoth(room: Room) {
    const summary = this.toSummary(room);
    this.send(room.host, { type: 'room:joined', room: summary, role: 'host' });
    if (room.guest) this.send(room.guest, { type: 'room:joined', room: summary, role: 'guest' });
  }

  private broadcastLobby() {
    const msg = { type: 'lobby:state' as const, rooms: this.listRooms() };
    for (const socket of this.conns.keys()) this.send(socket, msg);
  }

  private listRooms() { return [...this.rooms.values()].sort((a, b) => b.createdAt - a.createdAt).map((room) => this.toSummary(room)); }

  private toSummary(room: Room): RoomSummary {
    return {
      roomId: room.roomId, createdAt: room.createdAt, players: room.guest ? 2 : 1, maxPlayers: 2,
      hostName: this.conns.get(room.host)!.playerName,
      guestName: room.guest ? this.conns.get(room.guest)!.playerName : null,
    };
  }

  private send(socket: WebSocket, msg: WsServerMsg) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }

  private error(socket: WebSocket, code: string, message: string) { this.send(socket, { type: 'error', code, message }); }

  private generateRoomId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 30; attempt++) {
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      const roomId = [...bytes].map((value) => chars[value % chars.length]).join('');
      if (!this.rooms.has(roomId)) return roomId;
    }
    throw new Error('Unable to allocate room ID');
  }
}
