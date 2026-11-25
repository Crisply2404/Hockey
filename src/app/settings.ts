import { useSyncExternalStore } from 'react';
import type { Difficulty } from '../../types';

export type Lang = 'zh' | 'en';
export type Theme = 'light' | 'dark';

export interface Settings {
  lang: Lang;
  theme: Theme;
  muted: boolean;
  difficulty: Difficulty;
  playerName: string;
}

const STORAGE_KEY = 'hockey.settings.v1';

function defaults(): Settings {
  const zh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
  return {
    lang: zh ? 'zh' : 'en',
    theme: 'light',
    muted: false,
    difficulty: 'normal',
    playerName: `Player${Math.floor(Math.random() * 900 + 100)}`,
  };
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

// 本机保存的设置可能来自旧版本或者被手动修改，逐项校验后再使用。
function load(): Settings {
  const base = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    return {
      lang: oneOf<Lang>(saved.lang, ['zh', 'en'], base.lang),
      theme: oneOf<Theme>(saved.theme, ['light', 'dark'], base.theme),
      muted: typeof saved.muted === 'boolean' ? saved.muted : base.muted,
      difficulty: oneOf<Difficulty>(saved.difficulty, ['easy', 'normal', 'hard'], base.difficulty),
      playerName: typeof saved.playerName === 'string' && saved.playerName.trim() ? saved.playerName.slice(0, 18) : base.playerName,
    };
  } catch {
    return base;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getSettings() {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // 隐私模式等情况下无法写入本机存储；设置在本次访问期间仍然有效。
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSettings() {
  return useSyncExternalStore(subscribe, getSettings);
}
