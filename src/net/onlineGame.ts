import { GameSnapshot, PlayerInput } from './protocol';

export type OnlineRole = 'host' | 'guest';

export type OnlineGameCallbacks = {
  onLocalInput?: (input: PlayerInput) => void;
  onSnapshot?: (snapshot: GameSnapshot) => void;
};

export function encodeJson(obj: unknown) {
  return JSON.stringify(obj);
}

export function decodeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function makePlayerInput(now: number, keys: PlayerInput['keys'], mouse: PlayerInput['mouse']): PlayerInput {
  return { t: now, keys, mouse };
}
