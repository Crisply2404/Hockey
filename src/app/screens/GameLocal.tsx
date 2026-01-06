import { useRef, useState } from 'react';
import Hockey from '../../../components/Hockey';
import { HockeyRef } from '../../../types';

export default function GameLocal({ onBack }: { onBack: () => void }) {
  const gameRef = useRef<HockeyRef>(null);
  const [gameMode, setGameMode] = useState<'pve' | 'pvp'>('pve');

  const handleModeToggle = () => {
    setGameMode((prev) => (prev === 'pve' ? 'pvp' : 'pve'));
    gameRef.current?.resetGame();
  };

  return (
    <>
      <div className="absolute inset-0 z-0">
        <Hockey ref={gameRef} mode={gameMode} />
      </div>

      <div className="absolute bottom-8 z-10 flex gap-4 pointer-events-none">
        <div className="pointer-events-auto bg-black/5 backdrop-blur-md border border-black/10 text-black px-6 py-2 rounded-full flex items-center gap-4 transition-all hover:bg-black/10 shadow-sm">
          <span className="text-xs font-bold tracking-widest uppercase opacity-50">Mode</span>
          <button
            onClick={handleModeToggle}
            className="font-black text-sm tracking-wider hover:scale-105 transition-transform"
          >
            {gameMode === 'pve' ? 'HUMAN VS AI' : 'HUMAN VS HUMAN'}
          </button>
        </div>

        <button
          onClick={() => gameRef.current?.resetGame()}
          className="pointer-events-auto bg-black text-white px-6 py-2 rounded-full font-bold text-xs tracking-widest uppercase hover:scale-105 hover:bg-gray-800 transition-all shadow-lg"
        >
          Reset Game
        </button>

        <button
          onClick={onBack}
          className="pointer-events-auto bg-white text-black px-6 py-2 rounded-full font-bold text-xs tracking-widest uppercase border border-black/20 hover:scale-105 transition-all shadow-sm"
        >
          Back
        </button>
      </div>

      <div className="absolute top-10 z-10 text-black/30 text-[10px] tracking-[0.3em] font-bold pointer-events-none select-none">
        FIRST TO 7 WINS • WASD / MOUSE TO MOVE
      </div>
    </>
  );
}
