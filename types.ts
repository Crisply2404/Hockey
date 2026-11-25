export type GameMode = 'pve' | 'pvp' | 'demo';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Side = 1 | 2;
export type ImpactKind = 'paddle' | 'wall' | 'barrier' | 'post' | 'burst';

/** 比赛向画面与界面报告的事件。 */
export type GameEvent =
  | { type: 'reset' }
  | { type: 'countdown'; n: number }
  /** 发球倒计时结束，冰球离开中央。 */
  | { type: 'serve' }
  | { type: 'impact'; kind: ImpactKind; power: number; speed: number; side?: Side; x: number; y: number }
  /** 屏障被撞开；snap 是皮筋绷断的那一下。 */
  | { type: 'break'; side: 'left' | 'right' }
  | { type: 'snap'; side: 'left' | 'right' }
  | { type: 'goal'; scorer: Side }
  | { type: 'score'; scorer: Side; p1: number; p2: number }
  | { type: 'win'; winner: Side; p1: number; p2: number }
  /** 获胜后按顺序重画每个进球的球路；index 从 0 开始。 */
  | { type: 'recap'; index: number; total: number; scorer: Side }
  /** 球路全部画完，这一局的线图定格。 */
  | { type: 'settled'; winner: Side };

export interface HockeyRef {
  resetGame: () => void;
}
