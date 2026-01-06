import { isWsServerMsg, RoomSummary, WsClientMsg, WsServerMsg } from './protocol';

export type LobbyClientOptions = {
  url: string;
  onLobbyState?: (rooms: RoomSummary[]) => void;
  onRoomCreated?: (room: RoomSummary, role: 'host') => void;
  onRoomJoined?: (room: RoomSummary, role: 'host' | 'guest') => void;
  onSignal?: (msg: WsServerMsg) => void;
  onError?: (code: string, message: string) => void;
};

export class LobbyClient {
  private ws: WebSocket | null = null;
  private opts: LobbyClientOptions;
  private isOpen = false;

  constructor(opts: LobbyClientOptions) {
    this.opts = opts;
  }

  connect(playerName: string) {
    if (this.ws) return;
    this.ws = new WebSocket(this.opts.url);
    this.ws.addEventListener('open', () => {
      this.isOpen = true;
      this.send({ type: 'lobby:hello', playerName });
      this.send({ type: 'lobby:list' });
    });
    this.ws.addEventListener('message', (evt) => this.onMessage(evt.data));
    this.ws.addEventListener('close', (evt) => {
      this.isOpen = false;
      this.ws = null;
      this.opts.onError?.('ws_closed', `WebSocket closed (code=${evt.code}, reason=${evt.reason || 'n/a'})`);
    });
    this.ws.addEventListener('error', () => {
      this.opts.onError?.('ws_error', 'WebSocket error (check Worker deploy and VITE_LOBBY_WS_URL)');
    });
  }

  disconnect() {
    if (!this.ws) return;
    try {
      this.ws.close();
    } catch {
      // ignore
    }
    this.ws = null;
    this.isOpen = false;
  }

  createRoom() {
    this.send({ type: 'room:create' });
  }

  joinRoom(roomId: string) {
    this.send({ type: 'room:join', roomId });
  }

  leaveRoom(roomId: string) {
    this.send({ type: 'room:leave', roomId });
  }

  requestList() {
    this.send({ type: 'lobby:list' });
  }

  sendRaw(msg: WsClientMsg) {
    this.send(msg);
  }

  private send(msg: WsClientMsg) {
    if (!this.ws || !this.isOpen) return;
    this.ws.send(JSON.stringify(msg));
  }

  private onMessage(data: unknown) {
    let msg: WsServerMsg | null = null;
    try {
      const parsed = JSON.parse(typeof data === 'string' ? data : String(data));
      if (isWsServerMsg(parsed)) msg = parsed;
    } catch {
      // ignore
    }
    if (!msg) return;

    switch (msg.type) {
      case 'lobby:state':
        this.opts.onLobbyState?.(msg.rooms);
        return;
      case 'room:created':
        this.opts.onRoomCreated?.(msg.room, msg.role);
        return;
      case 'room:joined':
        this.opts.onRoomJoined?.(msg.room, msg.role);
        return;
      case 'signal:offer':
      case 'signal:answer':
      case 'signal:ice':
        this.opts.onSignal?.(msg);
        return;
      case 'error':
        this.opts.onError?.(msg.code, msg.message);
        return;
    }
  }
}
