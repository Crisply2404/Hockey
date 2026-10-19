import { wsServerMsgSchema, type GameSnapshot, type OnlineRole, type PlayerInput, type RoomSummary, type WsClientMsg } from './protocol';

export type ConnectionState = 'offline' | 'connecting' | 'online';

export type LobbyClientOptions = {
  url: string;
  onConnectionState?: (state: ConnectionState) => void;
  onLobbyState?: (rooms: RoomSummary[]) => void;
  onRoomCreated?: (room: RoomSummary, role: 'host') => void;
  onRoomJoined?: (room: RoomSummary, role: OnlineRole) => void;
  onRoomLeft?: (roomId: string) => void;
  onRoomClosed?: (roomId: string, reason: string) => void;
  onInput?: (input: PlayerInput) => void;
  onSnapshot?: (snapshot: GameSnapshot) => void;
  onRttMs?: (milliseconds: number | null) => void;
  onError?: (code: string, message: string) => void;
};

export class LobbyClient {
  private ws: WebSocket | null = null;
  private playerName = 'Player';
  private closed = true;
  private queue: WsClientMsg[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 500;
  private lastPong = 0;

  constructor(private opts: LobbyClientOptions) {}

  connect(playerName: string) {
    this.playerName = playerName.trim().slice(0, 18) || 'Player';
    this.closed = false;
    if (this.ws) return;
    this.opts.onConnectionState?.('connecting');
    const socket = new WebSocket(this.opts.url);
    this.ws = socket;
    socket.addEventListener('open', () => {
      if (this.ws !== socket || this.closed) return;
      this.reconnectDelay = 500;
      this.lastPong = performance.now();
      socket.send(JSON.stringify({ type: 'lobby:hello', playerName: this.playerName }));
      for (const message of this.queue.splice(0)) socket.send(JSON.stringify(message));
      this.opts.onConnectionState?.('online');
      this.heartbeat = setInterval(() => {
        if (performance.now() - this.lastPong > 12_000) {
          socket.close(4000, 'Heartbeat timeout');
          return;
        }
        this.sendRaw({ type: 'ping', t: performance.now() });
      }, 2000);
    });
    socket.addEventListener('message', (event) => {
      if (this.ws !== socket) return;
      const message = wsServerMsgSchema.parse(JSON.parse(String(event.data)));
      switch (message.type) {
        case 'lobby:state': this.opts.onLobbyState?.(message.rooms); break;
        case 'room:created': this.opts.onRoomCreated?.(message.room, message.role); break;
        case 'room:joined': this.opts.onRoomJoined?.(message.room, message.role); break;
        case 'room:left': this.opts.onRoomLeft?.(message.roomId); break;
        case 'room:closed': this.opts.onRoomClosed?.(message.roomId, message.reason); break;
        case 'game:input': this.opts.onInput?.(message.input); break;
        case 'game:snapshot': this.opts.onSnapshot?.(message.snapshot); break;
        case 'pong':
          this.lastPong = performance.now();
          this.opts.onRttMs?.(Math.round(this.lastPong - message.t));
          break;
        case 'error': this.opts.onError?.(message.code, message.message); break;
      }
    });
    socket.addEventListener('close', () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.clearHeartbeat();
      this.opts.onConnectionState?.('offline');
      this.opts.onRttMs?.(null);
      if (!this.closed) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect(this.playerName);
        }, this.reconnectDelay);
        this.reconnectDelay = Math.min(8000, this.reconnectDelay * 2);
      }
    });
    socket.addEventListener('error', () => {
      if (this.closed || this.ws !== socket) return;
      this.opts.onError?.('connection_failed', 'Unable to connect. Reconnecting…');
    });
  }

  disconnect() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearHeartbeat();
    this.queue = [];
    const socket = this.ws;
    this.ws = null;
    socket?.close();
  }

  setPlayerName(playerName: string) {
    this.playerName = playerName.trim().slice(0, 18) || 'Player';
    this.send({ type: 'lobby:hello', playerName: this.playerName });
  }

  createRoom() { this.send({ type: 'room:create' }); }
  joinRoom(roomId: string) { this.send({ type: 'room:join', roomId: roomId.trim().toUpperCase() }); }
  leaveRoom(roomId: string) { this.send({ type: 'room:leave', roomId }); }
  requestList() { this.send({ type: 'lobby:list' }); }

  sendRaw(message: WsClientMsg) {
    if (this.ws?.readyState !== WebSocket.OPEN || this.ws.bufferedAmount > 256_000) return;
    this.ws.send(JSON.stringify(message));
  }

  private send(message: WsClientMsg) {
    if (this.closed) throw new Error('Lobby connection has been closed');
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
    else this.queue.push(message);
  }

  private clearHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
