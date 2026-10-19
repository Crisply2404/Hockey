import { useMemo, useState } from 'react';
import { LobbyClient } from '../../net/lobbyClient';
import { RoomSummary } from '../../net/protocol';

export default function Lobby({
  onPlayLocal,
  onEnterRoom,
  rooms,
  connection: connState,
  error: err,
  onClearError,
  client,
}: {
  onPlayLocal: () => void;
  onEnterRoom: (roomId: string, playerName: string) => void;
  rooms: RoomSummary[];
  connection: 'offline' | 'connecting' | 'online';
  error: string | null;
  onClearError: () => void;
  client: LobbyClient | null;
}) {
  const [playerName, setPlayerName] = useState(() => `Player${Math.floor(Math.random() * 900 + 100)}`);
  const [searchId, setSearchId] = useState('');

  const filtered = useMemo(() => {
    const q = searchId.trim().toUpperCase();
    if (!q) return rooms;
    return rooms.filter((r) => r.roomId.includes(q));
  }, [rooms, searchId]);

  const createRoom = () => {
    onClearError();
    client?.setPlayerName(playerName);
    client?.createRoom();
  };

  const joinById = () => {
    const id = searchId.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(id)) return;
    onClearError();
    onEnterRoom(id, playerName.trim() || 'Player');
  };

  return (
    <div className="w-full max-w-3xl px-6">
      <div className="bg-black/5 border border-black/10 rounded-2xl p-6 shadow-sm">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="text-xs font-bold tracking-[0.3em] opacity-60">ONLINE</div>
            <div className="text-2xl font-black tracking-wider">Lobby</div>
          </div>

          <div className="flex gap-3 items-center flex-wrap">
            <label className="text-xs font-bold tracking-widest uppercase opacity-60">Name</label>
            <input
              value={playerName}
              onChange={(e) => {
                setPlayerName(e.target.value);
                client?.setPlayerName(e.target.value);
              }}
              className="px-4 py-2 rounded-full border border-black/20 bg-white text-sm font-semibold tracking-wide outline-none focus:ring-2 focus:ring-black/20"
              placeholder="Your name"
              maxLength={18}
            />
            <button
              onClick={onPlayLocal}
              className="bg-white text-black px-5 py-2 rounded-full font-bold text-xs tracking-widest uppercase border border-black/20 hover:scale-105 transition-transform"
            >
              Local
            </button>
          </div>
        </div>

        <div className="mt-6 flex gap-3 flex-wrap">
          <button
            onClick={createRoom}
            disabled={connState !== 'online'}
            className="bg-black text-white px-6 py-3 rounded-full font-bold text-xs tracking-widest uppercase hover:scale-105 hover:bg-gray-800 transition-all shadow-lg"
          >
            Create Room
          </button>

          <div className="flex-1 min-w-[240px] flex gap-2">
            <input
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              className="flex-1 px-4 py-3 rounded-full border border-black/20 bg-white text-sm font-semibold tracking-[0.2em] uppercase outline-none focus:ring-2 focus:ring-black/20"
              placeholder="Search / Join by Room ID"
            />
            <button
              onClick={joinById}
              disabled={connState !== 'online' || !/^[A-Z2-9]{6}$/.test(searchId.trim().toUpperCase())}
              className="bg-white text-black px-5 py-3 rounded-full font-bold text-xs tracking-widest uppercase border border-black/20 hover:scale-105 transition-transform"
            >
              Join
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs font-bold tracking-widest uppercase opacity-60">
            {connState === 'online' ? 'CONNECTED' : connState === 'connecting' ? 'CONNECTING…' : 'OFFLINE'}
          </div>
          {err && <div className="text-xs font-bold tracking-widest uppercase text-red-600">{err}</div>}
        </div>

        <div className="mt-6">
          <div className="text-xs font-bold tracking-[0.3em] opacity-60">ROOMS</div>

          <div className="mt-3 grid gap-2">
            {filtered.length === 0 ? (
              <div className="text-sm opacity-60">No rooms found.</div>
            ) : (
              filtered.map((r) => (
                <div
                  key={r.roomId}
                  className="bg-white rounded-xl border border-black/10 px-4 py-3 flex items-center justify-between gap-4"
                >
                  <div className="flex items-baseline gap-3">
                    <div className="font-black tracking-[0.25em] text-sm">{r.roomId}</div>
                    <div className="text-xs font-bold tracking-widest uppercase opacity-60">
                      {r.players}/{r.maxPlayers} · {r.hostName}{r.guestName ? ` · ${r.guestName}` : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onEnterRoom(r.roomId, playerName.trim() || 'Player')}
                      disabled={r.players === 2 || connState !== 'online'}
                      className="bg-black text-white px-4 py-2 rounded-full font-bold text-xs tracking-widest uppercase hover:scale-105 transition-transform"
                    >
                      Enter
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

