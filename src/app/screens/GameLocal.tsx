import { useEffect, useRef, useState } from 'react';
import Hockey from '../../../components/Hockey';
import type { HockeyRef } from '../../../types';
import { useT } from '../i18n';
import { useSettings } from '../settings';
import { Icon, IconButton, Popup, SoundButton, TopBar, Word } from '../ui';
import { useMatch } from '../useMatch';

export default function GameLocal({ mode, onExit }: { mode: 'pve' | 'pvp'; onExit: () => void }) {
  const t = useT();
  const settings = useSettings();
  const gameRef = useRef<HockeyRef>(null);
  const [paused, setPaused] = useState(false);
  const match = useMatch();
  const playing = match.phase === 'playing';

  // Esc 或 P 暂停；页面切到后台时自动暂停。
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat || !playing) return;
      if (event.key === 'Escape' || event.key.toLowerCase() === 'p') setPaused((current) => !current);
    };
    const pauseNow = () => { if (playing) setPaused(true); };
    const handleVisibility = () => { if (document.hidden) pauseNow(); };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('blur', pauseNow);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('blur', pauseNow);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [playing]);

  const restart = () => {
    gameRef.current?.resetGame();
    setPaused(false);
  };

  return (
    <div className="game">
      <TopBar
        start={<IconButton label={t.pause} onClick={() => setPaused(true)} disabled={!playing || paused}>{Icon.pause}</IconButton>}
        end={<SoundButton />}
      />

      <div className="game__stage">
        <Hockey ref={gameRef} mode={mode} difficulty={settings.difficulty} paused={paused} theme={settings.theme} onEvent={match.onEvent} />

        {paused && (
          <Popup label={t.pause}>
            <Word onClick={() => setPaused(false)} autoFocus>{t.resume}</Word>
            <Word onClick={restart}>{t.restart}</Word>
            <Word onClick={onExit}>{t.quit}</Word>
          </Popup>
        )}

        {match.phase === 'settled' && (
          <Popup label={t.rematch}>
            <Word onClick={restart} autoFocus>{t.rematch}</Word>
            <Word onClick={onExit}>{t.quit}</Word>
          </Popup>
        )}
      </div>
    </div>
  );
}
