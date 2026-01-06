export type WsClientMsg =
  | { type: 'lobby:hello'; playerName: string }
  | { type: 'lobby:list' }
  | { type: 'room:create' }
  | { type: 'room:join'; roomId: string }
  | { type: 'room:leave'; roomId: string }
  | { type: 'signal:offer'; roomId: string; sdp: string }
  | { type: 'signal:answer'; roomId: string; sdp: string }
  | { type: 'signal:ice'; roomId: string; candidate: string };

export type WsServerMsg =
  | { type: 'lobby:state'; rooms: RoomSummary[] }
  | { type: 'room:created'; room: RoomSummary; role: 'host' }
  | { type: 'room:joined'; room: RoomSummary; role: 'host' | 'guest' }
  | { type: 'room:left'; roomId: string }
  | { type: 'signal:offer'; roomId: string; sdp: string }
  | { type: 'signal:answer'; roomId: string; sdp: string }
  | { type: 'signal:ice'; roomId: string; candidate: string }
  | { type: 'error'; code: string; message: string };

export type RoomSummary = {
  roomId: string;
  players: number;
  maxPlayers: 2;
  createdAt: number;
};

export function isWsClientMsg(v: unknown): v is WsClientMsg {
  if (!v || typeof v !== 'object') return false;
  const t = (v as any).type;
  return typeof t === 'string';
}
