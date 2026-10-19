import { useEffect, useRef, useState } from 'react';
import GameLocal from './screens/GameLocal';
import Lobby from './screens/Lobby';
import Room from './screens/Room';
import { LobbyClient, type ConnectionState } from '../net/lobbyClient';
import type { GameSnapshot, OnlineRole, PlayerInput, RoomSummary } from '../net/protocol';

type Route = { name: 'lobby' } | { name: 'local' } | { name: 'room'; room: RoomSummary; role: OnlineRole };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'lobby' });
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('offline');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [rttMs, setRttMs] = useState<number | null>(null);
  const remoteInput = useRef<PlayerInput | null>(null);
  const clientRef = useRef<LobbyClient | null>(null);

  useEffect(() => {
    const url = import.meta.env.DEV
      ? `ws://${location.hostname}:8796/ws`
      : import.meta.env.VITE_LOBBY_WS_URL || 'wss://hockey-lobby.tcoinsm.workers.dev/ws';
    const client = new LobbyClient({
      url,
      onConnectionState: (state) => {
        setConnection(state);
        if (state === 'online') setError(null);
        if (state === 'offline') {
          remoteInput.current = null;
          setSnapshot(null);
          setRoute((current) => current.name === 'room' ? { name: 'lobby' } : current);
          setError('Connection interrupted. Reconnecting…');
        }
      },
      onLobbyState: setRooms,
      onRoomCreated: (room, role) => {
        setSnapshot(null);
        remoteInput.current = null;
        setRoute({ name: 'room', room, role });
      },
      onRoomJoined: (room, role) => {
        if (role === 'host' && room.players === 1) remoteInput.current = null;
        setError(null);
        setRoute({ name: 'room', room, role });
      },
      onRoomClosed: (_roomId, reason) => {
        setSnapshot(null);
        remoteInput.current = null;
        setError(reason);
        setRoute({ name: 'lobby' });
      },
      onInput: (input) => { remoteInput.current = { ...input, t: performance.now() }; },
      onSnapshot: setSnapshot,
      onRttMs: setRttMs,
      onError: (code, message) => setError(`${code}: ${message}`),
    });
    clientRef.current = client;
    client.connect('Player');
    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, []);

  const enterRoom = (roomId: string, playerName: string) => {
    setError(null);
    clientRef.current?.setPlayerName(playerName);
    clientRef.current?.joinRoom(roomId);
  };

  const title = route.name === 'lobby' ? 'HOCKEY — LOBBY' : route.name === 'room' ? `ROOM ${route.room.roomId}` : 'HOCKEY — LOCAL';

  return (
    <div className="w-full h-screen bg-white flex flex-col items-center justify-center relative">
      <div className="absolute top-6 z-10 text-black/50 text-[10px] tracking-[0.35em] font-bold pointer-events-none select-none">
        {title}
      </div>
      {route.name === 'lobby' && (
        <Lobby
          rooms={rooms} connection={connection} error={error} client={clientRef.current}
          onClearError={() => setError(null)} onPlayLocal={() => setRoute({ name: 'local' })} onEnterRoom={enterRoom}
        />
      )}
      {route.name === 'room' && (
        <Room
          key={route.room.roomId} room={route.room} role={route.role} snapshot={snapshot}
          client={clientRef.current} remoteInput={remoteInput} rttMs={rttMs} error={error}
          onLeave={() => {
            clientRef.current?.leaveRoom(route.room.roomId);
            remoteInput.current = null;
            setSnapshot(null);
            setRoute({ name: 'lobby' });
          }}
        />
      )}
      {route.name === 'local' && <GameLocal onBack={() => setRoute({ name: 'lobby' })} />}
    </div>
  );
}
