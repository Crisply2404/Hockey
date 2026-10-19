import { useRef, type RefObject } from 'react';
import Hockey from '../../../components/Hockey';
import type { HockeyRef } from '../../../types';
import type { LobbyClient } from '../../net/lobbyClient';
import type { GameSnapshot, OnlineRole, PlayerInput, RoomSummary } from '../../net/protocol';

export default function Room({ room, role, snapshot, client, remoteInput, rttMs, error, onLeave }: {
  room: RoomSummary;
  role: OnlineRole;
  snapshot: GameSnapshot | null;
  client: LobbyClient | null;
  remoteInput: RefObject<PlayerInput | null>;
  rttMs: number | null;
  error: string | null;
  onLeave: () => void;
}) {
  const gameRef = useRef<HockeyRef>(null);
  return (
    <div className="w-full h-full">
      <div className="absolute inset-0 z-0">
        <Hockey ref={gameRef} mode="pvp" online={{
          enabled: true,
          ready: room.players === 2,
          role,
          snapshot: snapshot ?? undefined,
          readRemoteInput: () => {
            const input = remoteInput.current;
            return input && performance.now() - input.t < 500 ? input : null;
          },
          onInput: (input) => client?.sendRaw({ type: 'game:input', roomId: room.roomId, input }),
          onSnapshot: (value) => client?.sendRaw({ type: 'game:snapshot', roomId: room.roomId, snapshot: value }),
        }} />
      </div>
      <div className="absolute top-14 inset-x-0 z-10 px-4 flex justify-center pointer-events-none">
        <div className="pointer-events-auto bg-white/90 border border-black/10 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap shadow-sm">
          <div>
            <div className="text-lg font-black tracking-[0.25em]" data-testid="room-id">{room.roomId}</div>
            <div className="text-xs opacity-60" role="status">
              {role.toUpperCase()} · {room.players}/2 · {room.players === 2 ? 'Ready' : 'Waiting for opponent'}
            </div>
          </div>
          <div className="text-xs opacity-60">{room.hostName} / {room.guestName ?? 'Waiting…'}</div>
          <div className="text-xs opacity-60">RTT: {rttMs === null ? '—' : `${rttMs} ms`}</div>
          <button className="border border-black/20 rounded-full px-4 py-2 text-xs font-bold" onClick={() => navigator.clipboard.writeText(room.roomId)}>Copy ID</button>
          {role === 'host' && <button className="border border-black/20 rounded-full px-4 py-2 text-xs font-bold" onClick={() => gameRef.current?.resetGame()}>Reset Game</button>}
          <button className="bg-black text-white rounded-full px-4 py-2 text-xs font-bold" onClick={onLeave}>Leave</button>
          {error && <div role="alert" className="text-red-600 text-xs">{error}</div>}
        </div>
      </div>
      <div className="absolute bottom-6 inset-x-0 text-center text-[10px] tracking-widest pointer-events-none">
        {role === 'host' ? 'PLAYER 1 · LEFT' : 'PLAYER 2 · RIGHT'} · WASD / MOUSE / TOUCH
      </div>
    </div>
  );
}
