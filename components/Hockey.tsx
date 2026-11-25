import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { createGuestSmoother } from '../src/game/guestSmoothing';
import {
  clampToHalf, createSim, keepOutOfGoalZone, moveHumanPaddle, resetMatch, startServe, stepSim, tickServe, type Control,
} from '../src/game/sim';
import { GOAL_BOTTOM, GOAL_TOP, LINE_THICKNESS, PUCK_RADIUS, TABLE_HEIGHT, TABLE_WIDTH } from '../src/game/table';
import { createView, render, stepView, viewOnEvent, type Layout } from '../src/game/view';
import type { GameSnapshot, PlayerInput } from '../src/net/protocol';
import type { Difficulty, GameEvent, GameMode, HockeyRef, Side } from '../types';

/**
 * 比赛画布：主循环、输入与联机。
 * 规则在 src/game/sim.ts，AI 在 src/game/ai.ts，画法在 src/game/view.ts。
 */
interface HockeyProps {
  mode: GameMode;
  difficulty?: Difficulty;
  paused?: boolean;
  theme?: 'light' | 'dark';
  onEvent?: (event: GameEvent) => void;
  online?: {
    enabled: boolean;
    ready: boolean;
    role: 'host' | 'guest';
    snapshot?: GameSnapshot;
    onSnapshot: (snap: GameSnapshot) => void;
    onInput: (input: PlayerInput) => void;
    readRemoteInput: () => PlayerInput | null;
  };
}

const INPUT_INTERVAL_MS = 33;
const SNAPSHOT_INTERVAL_MS = 50;
// 球桌四周留出的空白，占画布的比例。屏障皮筋绷出去的那一段画在这里。
const TABLE_FIT = 0.9;
const DEMO_HOLD_FRAMES = 150;

const round2 = (value: number) => Math.round(value * 100) / 100;
const isCenter = (snap: GameSnapshot) => snap.puck.x === TABLE_WIDTH / 2 && snap.puck.y === TABLE_HEIGHT / 2;

const Hockey = forwardRef<HockeyRef, HockeyProps>(({ mode, difficulty = 'normal', paused = false, theme = 'light', onEvent, online }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  // 主循环只建立一次；每帧从这里读取最新的属性。
  const cfgRef = useRef({ mode, difficulty, paused, theme, onEvent });
  cfgRef.current = { mode, difficulty, paused, theme, onEvent };
  const apiRef = useRef<{ reset: () => void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx) return;

    const sim = createSim();
    const view = createView();
    const layout: Layout = { scale: 1, baseX: 0, baseY: 0, rot: 0, dpr: 1 };
    const keys = { w: false, a: false, s: false, d: false, up: false, down: false, left: false, right: false };
    const pointer = { main: null as { x: number; y: number } | null, second: null as { x: number; y: number } | null };
    const touches = new Map<number, Side>();
    const smoother = createGuestSmoother(SNAPSHOT_INTERVAL_MS);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let frameId = 0;
    let lastTime = performance.now();
    let lastSent = -Infinity;
    let lastSnapshot: GameSnapshot | undefined;
    let wasReady = false;
    let demoHold = 0;
    let lineWidth = '';

    const emit = (event: GameEvent) => {
      viewOnEvent(view, sim, event);
      cfgRef.current.onEvent?.(event);
    };
    const reset = () => resetMatch(sim, emit);
    apiRef.current = { reset };
    reset();

    // 键盘方向按画面给出；竖屏时换算到球桌坐标。
    const toTableVector = (sx: number, sy: number) => layout.rot === -1 ? { x: -sy, y: sx } : layout.rot === 1 ? { x: sy, y: -sx } : { x: sx, y: sy };
    const keyVector = (left: boolean, right: boolean, up: boolean, down: boolean) =>
      toTableVector((right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));

    const fitCanvas = (isGuest: boolean) => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const { width, height } = parent.getBoundingClientRect();
      layout.dpr = window.devicePixelRatio || 1;
      const pixelW = Math.max(1, Math.round(width * layout.dpr));
      const pixelH = Math.max(1, Math.round(height * layout.dpr));
      if (canvas.width !== pixelW || canvas.height !== pixelH) { canvas.width = pixelW; canvas.height = pixelH; }
      // 竖屏时把球桌转 90°：访客的右半场、其余情况的左半场位于画面下方。
      const portrait = height > width;
      layout.rot = portrait ? (isGuest ? 1 : -1) : 0;
      const spanX = portrait ? TABLE_HEIGHT : TABLE_WIDTH;
      const spanY = portrait ? TABLE_WIDTH : TABLE_HEIGHT;
      layout.scale = Math.min(width / spanX, height / spanY) * TABLE_FIT;
      layout.baseX = (width - spanX * layout.scale) / 2;
      layout.baseY = (height - spanY * layout.scale) / 2;
      // 界面上的线框用这个宽度，和球桌的线一样粗。
      const next = `${(LINE_THICKNESS * layout.scale).toFixed(2)}px`;
      if (next !== lineWidth) { lineWidth = next; document.documentElement.style.setProperty('--line', next); }
    };

    // 访客：采用房主的快照，并由相邻快照的差异还原比赛事件。
    const applySnapshot = (snap: GameSnapshot, time: number, rawFrames: number) => {
      const prev = lastSnapshot;
      const speed = Math.hypot(snap.puck.vx, snap.puck.vy);
      Object.assign(sim.puck, { vx: snap.puck.vx, vy: snap.puck.vy, spin: snap.puck.spin });
      sim.p1.score = snap.p1.score; sim.p2.score = snap.p2.score;
      Object.assign(sim, {
        winner: snap.winner, leftGoalIntact: snap.leftGoalIntegrity, rightGoalIntact: snap.rightGoalIntegrity,
        hitStop: snap.effects.hitStop, hitStopMax: snap.effects.hitStopMax, lastImpactNormal: snap.effects.lastImpactNormal,
        isInversionHit: snap.effects.isInversionHit, goalActive: snap.effects.goalActive, slowMo: snap.effects.slowMoFactor,
        speedDisplay: snap.effects.currentSpeedDisplay, shake: snap.effects.shake,
        squash: { x: snap.effects.squash.x, y: snap.effects.squash.y, angle: snap.effects.squash.angle },
      });

      if (prev) {
        const total = snap.p1.score + snap.p2.score;
        const prevTotal = prev.p1.score + prev.p2.score;
        if ((prev.winner && !snap.winner) || total < prevTotal) emit({ type: 'reset' });
        else if (total > prevTotal) emit({ type: 'score', scorer: snap.p1.score > prev.p1.score ? 1 : 2, p1: snap.p1.score, p2: snap.p2.score });
        if (snap.winner && prev.winner !== snap.winner) emit({ type: 'win', winner: snap.winner, p1: snap.p1.score, p2: snap.p2.score });
        if (snap.effects.goalActive && !prev.effects.goalActive) emit({ type: 'goal', scorer: snap.puck.x < TABLE_WIDTH / 2 ? 2 : 1 });
        if (prev.leftGoalIntegrity && !snap.leftGoalIntegrity) emit({ type: 'break', side: 'left' });
        if (prev.rightGoalIntegrity && !snap.rightGoalIntegrity) emit({ type: 'break', side: 'right' });
        if (snap.effects.hitStop > prev.effects.hitStop + 0.5) {
          emit({ type: 'impact', kind: 'paddle', power: speed, speed, side: snap.puck.x < TABLE_WIDTH / 2 ? 1 : 2, x: snap.puck.x, y: snap.puck.y });
        }
        // 快照里的碰撞记号：落在边墙或屏障上的那些，就是一次拨弦。
        for (const mark of snap.effects.shockwaves) {
          if (prev.effects.shockwaves.some((old) => old.x === mark.x && old.y === mark.y && old.r === mark.r)) continue;
          const onEnd = mark.x <= 1 || mark.x >= TABLE_WIDTH - 1;
          if (!onEnd && mark.y > 1 && mark.y < TABLE_HEIGHT - 1) continue;
          const onBand = onEnd && mark.y > GOAL_TOP && mark.y < GOAL_BOTTOM;
          emit({ type: 'impact', kind: onBand ? 'barrier' : 'wall', power: mark.r, speed, x: mark.x, y: mark.y });
        }
      }

      const jumped = !prev || (isCenter(snap) && !isCenter(prev))
        || Math.hypot(snap.puck.x - prev.puck.x, snap.puck.y - prev.puck.y) > 220;
      if (isCenter(snap) && (!prev || !isCenter(prev)) && !snap.winner) startServe(sim, snap.p1.score + snap.p2.score === 0, emit);
      smoother.push(
        time, rawFrames * 16.666,
        { p1x: snap.p1.x, p1y: snap.p1.y, puckX: snap.puck.x, puckY: snap.puck.y, rotation: snap.puck.rotation },
        { p1x: sim.p1.x, p1y: sim.p1.y, puckX: sim.puck.x, puckY: sim.puck.y, rotation: sim.puck.rotation },
        jumped,
      );
      lastSnapshot = snap;
    };

    const loop = (time: number) => {
      const net = onlineRef.current;
      const cfg = cfgRef.current;
      const rawFrames = (time - lastTime) / 16.666;
      lastTime = time;
      const isGuest = !!net?.enabled && net.role === 'guest';
      const isHost = !!net?.enabled && net.role === 'host';
      const isPaused = cfg.paused && !net?.enabled;
      // frames：按 60 Hz 换算的真实帧数；进球慢动作另外由模拟计入。
      const frames = isPaused ? 0 : Math.min(rawFrames, 4);
      fitCanvas(isGuest);

      const allKeys = keyVector(keys.a || keys.left, keys.d || keys.right, keys.w || keys.up, keys.s || keys.down);

      if (isGuest && net) {
        if (net.ready && time - lastSent >= INPUT_INTERVAL_MS) {
          lastSent = time;
          net.onInput({
            t: time,
            keys: { w: allKeys.y < 0, a: allKeys.x < 0, s: allKeys.y > 0, d: allKeys.x > 0 },
            mouse: {
              x: pointer.main ? Math.max(0, Math.min(TABLE_WIDTH, pointer.main.x)) : null,
              y: pointer.main ? Math.max(0, Math.min(TABLE_HEIGHT, pointer.main.y)) : null,
            },
          });
        }
        const snap = net.snapshot;
        if (snap) {
          if (snap !== lastSnapshot) applySnapshot(snap, time, rawFrames);
          const dt = frames * sim.slowMo;
          // 快照之间的位置由 smoother 补出；冰球静止时不向前推算。
          const moving = !isCenter(snap) && !snap.winner && snap.effects.hitStop <= 0;
          const shown = smoother.sample(time, moving ? { vx: snap.puck.vx * sim.slowMo, vy: snap.puck.vy * sim.slowMo } : null);
          if (shown) {
            sim.p1.x = shown.p1x; sim.p1.y = shown.p1y;
            sim.puck.x = shown.puckX;
            sim.puck.y = Math.max(PUCK_RADIUS, Math.min(TABLE_HEIGHT - PUCK_RADIUS, shown.puckY));
            sim.puck.rotation = shown.rotation;
          }
          if (sim.hitStop > 0) sim.hitStop = Math.max(0, sim.hitStop - dt);
          if (!isCenter(snap) && sim.serve > 0) { sim.serve = 0; emit({ type: 'serve' }); }
          tickServe(sim, frames, emit);
          // 访客的球拍在本机先行移动，房主的结算结果稍后与之重合。
          if (sim.hitStop <= 0 && sim.winner === null) {
            moveHumanPaddle(sim.p2, { kind: 'human', keys: allKeys, target: pointer.main }, dt);
            clampToHalf(sim.p2, 2);
            keepOutOfGoalZone(sim.p2, 2);
          }
        }
      } else {
        // 房主：对手进入房间时开始一场新比赛。
        const ready = isHost && !!net?.ready;
        if (ready && !wasReady) reset();
        wasReady = ready;

        if (!isHost || ready) {
          let controls: Record<Side, Control>;
          if (cfg.mode === 'demo') {
            controls = { 1: { kind: 'ai', level: 'normal' }, 2: { kind: 'ai', level: 'normal' } };
          } else if (cfg.mode === 'pve') {
            controls = { 1: { kind: 'human', keys: allKeys, target: pointer.main }, 2: { kind: 'ai', level: cfg.difficulty } };
          } else if (isHost) {
            // 联机输入已经是球桌坐标。
            const remote = net?.readRemoteInput() ?? null;
            const remoteKeys = remote
              ? { x: (remote.keys.d ? 1 : 0) - (remote.keys.a ? 1 : 0), y: (remote.keys.s ? 1 : 0) - (remote.keys.w ? 1 : 0) }
              : { x: 0, y: 0 };
            const remoteTarget = remote && remote.mouse.x !== null && remote.mouse.y !== null ? { x: remote.mouse.x, y: remote.mouse.y } : null;
            controls = { 1: { kind: 'human', keys: allKeys, target: pointer.main }, 2: { kind: 'human', keys: remoteKeys, target: remoteTarget } };
          } else {
            controls = {
              1: { kind: 'human', keys: keyVector(keys.a, keys.d, keys.w, keys.s), target: pointer.main },
              2: { kind: 'human', keys: keyVector(keys.left, keys.right, keys.up, keys.down), target: pointer.second },
            };
          }
          stepSim(sim, controls, frames, emit);
        }

        if (ready && net && time - lastSent >= SNAPSHOT_INTERVAL_MS) {
          lastSent = time;
          net.onSnapshot({
            t: time,
            p1: { x: sim.p1.x, y: sim.p1.y, score: sim.p1.score },
            p2: { x: sim.p2.x, y: sim.p2.y, score: sim.p2.score },
            puck: { ...sim.puck },
            leftGoalIntegrity: sim.leftGoalIntact,
            rightGoalIntegrity: sim.rightGoalIntact,
            winner: sim.winner,
            effects: {
              hitStop: sim.hitStop, hitStopMax: sim.hitStopMax, lastImpactNormal: sim.lastImpactNormal,
              isInversionHit: sim.isInversionHit, goalActive: sim.goalActive, slowMoFactor: sim.slowMo,
              currentSpeedDisplay: sim.speedDisplay, shake: sim.shake,
              squash: { x: sim.squash.x, y: sim.squash.y, angle: sim.squash.angle, recovery: 0.4 },
              // 协议里的 shockwaves 现在承载碰撞记号（位置与力度），particles 不再使用。
              shockwaves: sim.marks.map((mark) => ({ x: round2(mark.x), y: round2(mark.y), r: round2(mark.r), alpha: round2(mark.alpha) })),
              particles: [],
            },
          });
        }
      }

      stepView(view, sim, frames, emit);

      // 演示比赛的线图停留一会儿，然后开始下一场。
      if (cfg.mode === 'demo' && view.win?.settled) {
        demoHold += frames;
        if (demoHold > DEMO_HOLD_FRAMES) { demoHold = 0; reset(); }
      }

      render(ctx, canvas, sim, view, layout, {
        theme: cfg.theme, paused: isPaused, shake: !reducedMotion && cfg.mode !== 'demo', demo: cfg.mode === 'demo',
      }, frames * sim.slowMo);
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);

    type Key = keyof typeof keys;
    const KEY_MAP: Record<string, Key> = { w: 'w', a: 'a', s: 's', d: 'd', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };
    const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const handleKey = (down: boolean) => (event: KeyboardEvent) => {
      const key = KEY_MAP[event.key.toLowerCase()];
      if (!key || (down && isTyping(event.target))) return;
      // 方向键用于移动球拍，不滚动页面。
      if (key.length > 1 && cfgRef.current.mode !== 'demo') event.preventDefault();
      keys[key] = down;
    };
    const handleKeyDown = handleKey(true);
    const handleKeyUp = handleKey(false);

    const toTable = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left - layout.baseX) / layout.scale;
      const y = (clientY - rect.top - layout.baseY) / layout.scale;
      if (layout.rot === -1) return { x: TABLE_WIDTH - y, y: x };
      if (layout.rot === 1) return { x: y, y: TABLE_HEIGHT - x };
      return { x, y };
    };
    // 鼠标无须按下即可移动球拍。触摸按落点所在半场分配：本地双人对战时双方各用一根手指。
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      event.preventDefault();
      const point = toTable(event.clientX, event.clientY);
      const twoPlayers = cfgRef.current.mode === 'pvp' && !onlineRef.current?.enabled;
      const side: Side = twoPlayers && point.x > TABLE_WIDTH / 2 ? 2 : 1;
      touches.set(event.pointerId, side);
      if (side === 2) pointer.second = point; else pointer.main = point;
    };
    const handlePointerMove = (event: PointerEvent) => {
      const side = event.pointerType === 'mouse' ? 1 : touches.get(event.pointerId);
      if (!side) return;
      const point = toTable(event.clientX, event.clientY);
      if (side === 2) pointer.second = point; else pointer.main = point;
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (touches.get(event.pointerId) === 2) pointer.second = null;
      touches.delete(event.pointerId);
    };
    const clearInput = () => {
      touches.clear();
      pointer.main = null; pointer.second = null;
      for (const key of Object.keys(keys) as Key[]) keys[key] = false;
    };

    window.addEventListener('blur', clearInput);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('blur', clearInput);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      cancelAnimationFrame(frameId);
      apiRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({ resetGame: () => apiRef.current?.reset() }), []);

  return <canvas ref={canvasRef} className="game-canvas" />;
});

export default Hockey;
