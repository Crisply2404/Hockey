import { isWsClientMsg, RoomSummary, WsClientMsg, WsServerMsg } from './protocol';

type Env = {
  LOBBY: DurableObjectNamespace<Lobby>;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');

    // Basic debug endpoint to validate the request reaches the Worker and to see upgrade headers.
    if (url.pathname === '/debug') {
      const headers: Record<string, string> = {};
      for (const [k, v] of request.headers) headers[k] = v;
      return Response.json({
        ok: true,
        path: url.pathname,
        method: request.method,
        upgrade: request.headers.get('Upgrade'),
        headers,
      });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected websocket', { status: 426 });
      }
      const id = env.LOBBY.idFromName('global');
      const stub = env.LOBBY.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};

type PlayerConn = {
  socket: WebSocket;
  playerName: string;
  joinedRoomId: string | null;
};

type Room = {
  roomId: string;
  createdAt: number;
  host: WebSocket;
  guest: WebSocket | null;
  hostName: string;
  guestName: string | null;
};

export class Lobby implements DurableObject {
  private state: DurableObjectState;
  private conns: Map<string, PlayerConn> = new Map();
  private rooms: Map<string, Room> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    // If a proxy/CDN strips websocket upgrade, fail loudly in logs.
    // Also helps diagnosing browser-side "closed before established".
    // eslint-disable-next-line no-console
    console.log('DO /ws upgrade', {
      path: url.pathname,
      upgrade: request.headers.get('Upgrade'),
      connection: request.headers.get('Connection'),
      origin: request.headers.get('Origin'),
      ua: request.headers.get('User-Agent'),
    });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const connId = crypto.randomUUID();
    server.accept();
    this.conns.set(connId, { socket: server, playerName: 'Player', joinedRoomId: null });

    server.addEventListener('message', (evt) => {
      void this.onMessage(connId, evt.data);
    });
    server.addEventListener('close', () => {
      void this.onClose(connId);
    });
    server.addEventListener('error', () => {
      void this.onClose(connId);
    });

    this.send(server, { type: 'lobby:state', rooms: this.listRooms() });
    return new Response(null, { status: 101, webSocket: client });
  }

  private async onMessage(connId: string, data: unknown) {
    const conn = this.conns.get(connId);
    if (!conn) return;

    let msg: WsClientMsg | null = null;
    try {
      const parsed = JSON.parse(typeof data === 'string' ? data : String(data));
      if (isWsClientMsg(parsed)) msg = parsed;
    } catch {
      // ignore
    }
    if (!msg) {
      this.send(conn.socket, { type: 'error', code: 'bad_json', message: 'Invalid message' });
      return;
    }

    switch (msg.type) {
      case 'lobby:hello': {
        conn.playerName = (msg.playerName || 'Player').slice(0, 18);
        this.send(conn.socket, { type: 'lobby:state', rooms: this.listRooms() });
        return;
      }
      case 'lobby:list': {
        this.send(conn.socket, { type: 'lobby:state', rooms: this.listRooms() });
        return;
      }
      case 'room:create': {
        if (conn.joinedRoomId) this.leaveRoom(connId, conn.joinedRoomId);
        const roomId = this.generateRoomId();
        const room: Room = {
          roomId,
          createdAt: Date.now(),
          host: conn.socket,
          guest: null,
          hostName: conn.playerName,
          guestName: null,
        };
        this.rooms.set(roomId, room);
        conn.joinedRoomId = roomId;
        const summary = this.toSummary(room);
        this.send(conn.socket, { type: 'room:created', room: summary, role: 'host' });
        this.broadcastLobby();
        return;
      }
      case 'room:join': {
        const roomId = normalizeRoomId(msg.roomId);
        const room = this.rooms.get(roomId);
        if (!room) {
          this.send(conn.socket, { type: 'error', code: 'room_not_found', message: 'Room not found' });
          return;
        }
        if (conn.joinedRoomId && conn.joinedRoomId !== roomId) this.leaveRoom(connId, conn.joinedRoomId);

        const isHost = room.host === conn.socket;
        if (!isHost) {
          if (room.guest && room.guest !== conn.socket) {
            this.send(conn.socket, { type: 'error', code: 'room_full', message: 'Room is full' });
            return;
          }
          room.guest = conn.socket;
          room.guestName = conn.playerName;
        } else {
          room.hostName = conn.playerName;
        }
        conn.joinedRoomId = roomId;
        const summary = this.toSummary(room);
        this.send(conn.socket, { type: 'room:joined', room: summary, role: isHost ? 'host' : 'guest' });
        // Notify counterpart (so host can start offer flow)
        this.notifyBoth(room);
        this.broadcastLobby();
        return;
      }
      case 'room:leave': {
        const roomId = normalizeRoomId(msg.roomId);
        if (conn.joinedRoomId === roomId) this.leaveRoom(connId, roomId);
        this.send(conn.socket, { type: 'room:left', roomId });
        this.broadcastLobby();
        return;
      }
      case 'signal:offer':
      case 'signal:answer':
      case 'signal:ice': {
        const roomId = normalizeRoomId(msg.roomId);
        const room = this.rooms.get(roomId);
        if (!room) {
          this.send(conn.socket, { type: 'error', code: 'room_not_found', message: 'Room not found' });
          return;
        }
        const isHost = room.host === conn.socket;
        const target = isHost ? room.guest : room.host;
        if (!target) {
          this.send(conn.socket, { type: 'error', code: 'peer_missing', message: 'Other player not connected yet' });
          return;
        }
        this.send(target, msg as unknown as WsServerMsg);
        return;
      }
    }
  }

  private async onClose(connId: string) {
    const conn = this.conns.get(connId);
    if (!conn) return;
    if (conn.joinedRoomId) this.leaveRoom(connId, conn.joinedRoomId);
    this.conns.delete(connId);
    this.broadcastLobby();
  }

  private leaveRoom(connId: string, roomId: string) {
    const conn = this.conns.get(connId);
    const room = this.rooms.get(roomId);
    if (!conn || !room) return;

    const isHost = room.host === conn.socket;
    if (isHost) {
      // Host leaving destroys the room.
      if (room.guest) {
        this.send(room.guest, { type: 'error', code: 'room_closed', message: 'Host left the room' });
      }
      this.rooms.delete(roomId);
    } else {
      if (room.guest === conn.socket) {
        room.guest = null;
        room.guestName = null;
        this.send(room.host, { type: 'error', code: 'guest_left', message: 'Guest left the room' });
      }
    }
    conn.joinedRoomId = null;
  }

  private notifyBoth(room: Room) {
    const summary = this.toSummary(room);
    this.send(room.host, { type: 'room:joined', room: summary, role: 'host' });
    if (room.guest) this.send(room.guest, { type: 'room:joined', room: summary, role: 'guest' });
  }

  private broadcastLobby() {
    const msg: WsServerMsg = { type: 'lobby:state', rooms: this.listRooms() };
    for (const c of this.conns.values()) this.send(c.socket, msg);
  }

  private listRooms(): RoomSummary[] {
    const out: RoomSummary[] = [];
    for (const room of this.rooms.values()) out.push(this.toSummary(room));
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }

  private toSummary(room: Room): RoomSummary {
    return {
      roomId: room.roomId,
      players: 1 + (room.guest ? 1 : 0),
      maxPlayers: 2,
      createdAt: room.createdAt,
    };
  }

  private send(socket: WebSocket, msg: WsServerMsg) {
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      // ignore
    }
  }

  private generateRoomId(): string {
    // Avoid confusing chars.
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 30; attempt++) {
      let out = '';
      for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
      if (!this.rooms.has(out)) return out;
    }
    return crypto.randomUUID().slice(0, 6).toUpperCase();
  }
}

function normalizeRoomId(roomId: string) {
  return String(roomId || '').trim().toUpperCase();
}
