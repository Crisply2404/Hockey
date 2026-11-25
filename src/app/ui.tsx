import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { sfx } from '../audio/sfx';
import { useT } from './i18n';
import { updateSettings, useSettings } from './settings';

/**
 * 界面只有三样东西：直接写在纸面上的词、线条图标，以及用球桌同样粗细的线画出的方框。
 * 线宽来自 CSS 变量 --line，由比赛画布按球桌当前的缩放写入。
 */

/** 一个可以点的词，没有边框和底色。 */
export function Word({ className = '', onClick, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`word ${className}`} onClick={(event) => { sfx.click(); onClick?.(event); }} {...rest} />;
}

export function IconButton({ label, className = '', onClick, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      aria-label={label}
      title={label}
      onClick={(event) => { sfx.click(); onClick?.(event); }}
      {...rest}
    >
      {children}
    </button>
  );
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Icon = {
  pause: <svg viewBox="0 0 24 24" {...stroke}><path d="M9 6v12M15 6v12" /></svg>,
  back: <svg viewBox="0 0 24 24" {...stroke}><path d="M14 6l-6 6 6 6" /></svg>,
  soundOn: <svg viewBox="0 0 24 24" {...stroke}><path d="M5 10v4h3l4 3.5v-11L8 10H5zM16 9a4.5 4.5 0 010 6" /></svg>,
  soundOff: <svg viewBox="0 0 24 24" {...stroke}><path d="M5 10v4h3l4 3.5v-11L8 10H5zM16 10l4 4M20 10l-4 4" /></svg>,
  theme: <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="7.5" /><path d="M12 4.5a7.5 7.5 0 010 15z" fill="currentColor" /></svg>,
};

/** 球桌上方的方框，线和球桌的边墙一样粗。暂停、等待对手、一局结束都用它。 */
export function Popup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="popup" role="dialog" aria-label={label}>
      <div className="frame">{children}</div>
    </div>
  );
}

export function TopBar({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar__group">{start}</div>
      <div className="topbar__group">{end}</div>
    </header>
  );
}

export function SoundButton() {
  const t = useT();
  const { muted } = useSettings();
  return (
    <IconButton label={muted ? t.unmute : t.mute} onClick={() => updateSettings({ muted: !muted })}>
      {muted ? Icon.soundOff : Icon.soundOn}
    </IconButton>
  );
}

export function ThemeButton() {
  const t = useT();
  const { theme } = useSettings();
  return (
    <IconButton label={t.theme} onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}>
      {Icon.theme}
    </IconButton>
  );
}
