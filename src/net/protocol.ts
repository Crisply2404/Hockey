export type WsClientMsg =
  | { type: 'lobby:hello'; playerName: string }
  | { type: 'lobby:list' }
  | { type: 'room:create' }
  | { type: 'room:join'; roomId: string }
  | { type: 'room:leave'; roomId: string }
  | { type: 'signal:offer'; roomId: string; sdp: string }
  | { type: 'signal:answer'; roomId: string; sdp: string }
  | { type: 'signal:ice'; roomId: string; candidate: string }
  | { type: 'game:input'; roomId: string; input: PlayerInput };

export type PlayerInput = {
  t: number;
  keys: {
    w: boolean;
    a: boolean;
    s: boolean;
    d: boolean;
  };
  mouse: {
    x: number | null;
    y: number | null;
  };
};

export type RoomSummary = {
  roomId: string;
  players: number;
  maxPlayers: 2;
  createdAt: number;
};

export type WsServerMsg =
  | { type: 'lobby:state'; rooms: RoomSummary[] }
  | { type: 'room:created'; room: RoomSummary; role: 'host' }
  | { type: 'room:joined'; room: RoomSummary; role: 'host' | 'guest' }
  | { type: 'room:left'; roomId: string }
  | { type: 'signal:offer'; roomId: string; sdp: string }
  | { type: 'signal:answer'; roomId: string; sdp: string }
  | { type: 'signal:ice'; roomId: string; candidate: string }
  | { type: 'game:snapshot'; roomId: string; snapshot: GameSnapshot }
  | { type: 'error'; code: string; message: string };

export type GameSnapshot = {
  t: number;
  p1: { x: number; y: number; score: number };
  p2: { x: number; y: number; score: number };
  puck: { x: number; y: number; vx: number; vy: number; spin: number; rotation: number };
  leftGoalIntegrity: boolean;
  rightGoalIntegrity: boolean;
  winner: null | 1 | 2;
};

export function isWsServerMsg(v: unknown): v is WsServerMsg {
  return !!v && typeof v === 'object' && typeof (v as any).type === 'string';
}
