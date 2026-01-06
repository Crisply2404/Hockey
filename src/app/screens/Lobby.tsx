import { useEffect, useMemo, useRef, useState } from 'react';
import { LobbyClient } from '../../net/lobbyClient';
import { RoomSummary } from '../../net/protocol';

type LobbyRoom = RoomSummary;

export default function Lobby({
  onPlayLocal,
  onEnterRoom,
}: {
  onPlayLocal: () => void;
  onEnterRoom: (roomId: string, playerName: string) => void;
}) {
  const [playerName, setPlayerName] = useState(() => `Player${Math.floor(Math.random() * 900 + 100)}`);
  const [searchId, setSearchId] = useState('');
  const [rooms, setRooms] = useState<LobbyRoom[]>([]);
  const [connState, setConnState] = useState<'offline' | 'connecting' | 'online'>('offline');
  const [err, setErr] = useState<string | null>(null);
  const clientRef = useRef<LobbyClient | null>(null);

  const wsUrl = useMemo(() => {
    // Configure via Vite env. Example:
    // VITE_LOBBY_WS_URL=wss://<your-worker-subdomain>/ws
    const fromEnv = (import.meta as any).env?.VITE_LOBBY_WS_URL as string | undefined;
    if (fromEnv) return fromEnv;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }, []);

  useEffect(() => {
    setConnState('connecting');
    const client = new LobbyClient({
      url: wsUrl,
      onLobbyState: (rs) => {
        setRooms(rs);
        setConnState('online');
      },
      onRoomCreated: (room) => {
        onEnterRoom(room.roomId, playerName.trim() || 'Player');
      },
      onError: (code, message) => {
        setErr(`${code}: ${message}`);
      },
    });
    clientRef.current = client;
    client.connect(playerName.trim() || 'Player');
    const poll = window.setInterval(() => client.requestList(), 1500);
    return () => {
      window.clearInterval(poll);
      client.disconnect();
      clientRef.current = null;
    };
  }, [onEnterRoom, playerName, wsUrl]);

  const filtered = useMemo(() => {
    const q = searchId.trim().toUpperCase();
    if (!q) return rooms;
    return rooms.filter((r) => r.roomId.includes(q));
  }, [rooms, searchId]);

  const createRoom = () => {
    setErr(null);
    clientRef.current?.createRoom();
  };

  const joinById = () => {
    const id = searchId.trim().toUpperCase();
    if (!id) return;
    setErr(null);
    clientRef.current?.joinRoom(id);
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
              onChange={(e) => setPlayerName(e.target.value)}
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
                      {r.players}/{r.maxPlayers}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onEnterRoom(r.roomId, playerName.trim() || 'Player')}
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

      <div className="mt-4 text-black/40 text-[10px] tracking-[0.28em] font-bold select-none">
        P2P MODE (A) • CF WORKER LOBBY/SIGNALING • GAME DATA NOT YET WIRED
      </div>
    </div>
  );
}

