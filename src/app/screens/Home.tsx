import type { Difficulty } from '../../../types';
import { useT } from '../i18n';
import { updateSettings, useSettings } from '../settings';
import { SoundButton, ThemeButton, Word } from '../ui';

export default function Home({ onSolo, onLocal, onOnline }: { onSolo: () => void; onLocal: () => void; onOnline: () => void }) {
  const t = useT();
  const settings = useSettings();
  const levels: Difficulty[] = ['easy', 'normal', 'hard'];

  return (
    <main className="home">
      <div className="corner">
        <Word className="word--small" onClick={() => updateSettings({ lang: settings.lang === 'zh' ? 'en' : 'zh' })}>{t.otherLanguage}</Word>
        <ThemeButton />
        <SoundButton />
      </div>

      <div className="home__content">
        <h1 className="title">HOCKEY</h1>
        <nav className="menu">
          <Word className="word--large" onClick={onSolo}>{t.solo}</Word>
          <div className="levels" role="radiogroup" aria-label={t.solo}>
            {levels.map((level) => (
              <Word
                key={level}
                role="radio"
                aria-checked={settings.difficulty === level}
                className={`word--small ${settings.difficulty === level ? 'is-on' : 'is-off'}`}
                onClick={() => updateSettings({ difficulty: level })}
              >
                {t.difficulty[level]}
              </Word>
            ))}
          </div>
          <Word className="word--large" onClick={onLocal}>{t.local}</Word>
          <Word className="word--large" onClick={onOnline}>{t.online}</Word>
        </nav>
      </div>
    </main>
  );
}
