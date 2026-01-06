import { useMemo, useState } from 'react';
import GameLocal from './screens/GameLocal';
import Lobby from './screens/Lobby';
import Room from './screens/Room';

type Route =
  | { name: 'lobby' }
  | { name: 'room'; roomId: string; playerName: string }
  | { name: 'local' };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'lobby' });

  const onEnterRoom = (roomId: string, playerName: string) => {
    setRoute({ name: 'room', roomId, playerName });
  };

  const title = useMemo(() => {
    if (route.name === 'lobby') return 'HOCKEY — LOBBY';
    if (route.name === 'room') return `ROOM ${route.roomId}`;
    return 'HOCKEY — LOCAL';
  }, [route]);

  return (
    <div className="w-full h-screen bg-white flex flex-col items-center justify-center relative">
      <div className="absolute top-6 z-10 text-black/50 text-[10px] tracking-[0.35em] font-bold pointer-events-none select-none">
        {title}
      </div>

      {route.name === 'lobby' && (
        <Lobby
          onPlayLocal={() => setRoute({ name: 'local' })}
          onEnterRoom={onEnterRoom}
        />
      )}

      {route.name === 'room' && (
        <Room
          roomId={route.roomId}
          playerName={route.playerName}
          onLeave={() => setRoute({ name: 'lobby' })}
        />
      )}

      {route.name === 'local' && <GameLocal onBack={() => setRoute({ name: 'lobby' })} />}
    </div>
  );
}
