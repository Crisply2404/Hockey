import type { Difficulty, GameEvent, ImpactKind, Side } from '../../types';
import { createAiMemory, stepAi, type AiMemory } from './ai';
import { GOAL_BOTTOM, GOAL_HEIGHT, GOAL_TOP, GOAL_ZONE_RADIUS, PADDLE_RADIUS, PUCK_RADIUS, TABLE_HEIGHT, TABLE_WIDTH, WIN_SCORE } from './table';

/**
 * 比赛模拟：球拍移动、冰球运动、碰撞、屏障、进球与发球。
 * 这里不画任何东西；画面与声音通过 emit 报告的事件得知发生了什么。
 * 时间以 60 Hz 的逻辑帧为单位，frames 可以是小数。
 */

// --- 速度 ---
export const MAX_SPEED = 50;
export const MIN_SPEED = 6;
// 屏障像一根皮筋：水平速度不到这个数的球会被兜住弹回。
const BARRIER_STRENGTH = 12;
const EXPLOSION_THRESHOLD = 4;

// --- 球拍击球（沿用原有调校）---
const MOUSE_SPEED_REQ_FOR_MAX = 60;
const MAX_PADDLE_PHYSICS_SPEED = 25;
const MAX_PADDLE_IMPACT = 20;
const MAX_PADDLE_SPEED = 100;
const KEY_SPEED = 10;
const RESTITUTION = 1.15;
const SPIN_TRANSFER_FACTOR = 0.012;
const MAX_SPIN = 0.7;
// 一次击球之后的这段时间里，同一只球拍再碰到冰球只做物理分离，不重复触发停顿与旋转。
const HIT_EFFECT_COOLDOWN = 20;

// --- 击球停顿 ---
const HIT_STOP_SCALE = 0.5;
const MAX_HIT_STOP_FRAMES = 35;
const INVERSION_IMPACT_THRESHOLD = 100;

// --- 冰球运动 ---
const VELOCITY_FRICTION = 0.998;
const SPIN_FRICTION = 0.89;
const MAGNUS_POWER = 0.3;
const GOAL_SLOW_MO_FACTOR = 0.1;
const GOAL_CELEBRATION_FRAMES = 60;

// --- 发球 ---
export const SERVE_BEAT_FRAMES = 42;
const SERVE_FRAMES_START = SERVE_BEAT_FRAMES * 3;
const SERVE_FRAMES_POINT = 48;

export type Paddle = {
  x: number; y: number; prevX: number; prevY: number; vx: number; vy: number;
  score: number; recoilX: number; recoilY: number; cooldown: number;
};

/** 一次碰撞留下的记号。联机时随快照发给访客，访客据此还原撞墙的位置与力度。 */
export type Mark = { x: number; y: number; r: number; alpha: number };

export type Sim = {
  p1: Paddle;
  p2: Paddle;
  puck: { x: number; y: number; vx: number; vy: number; spin: number; rotation: number };
  winner: Side | null;
  leftGoalIntact: boolean;
  rightGoalIntact: boolean;
  barrierCooldown: number;
  consecutiveHits: number;
  lastHitPos: { x: number; y: number };
  hitStop: number;
  hitStopMax: number;
  lastImpactNormal: number;
  isInversionHit: boolean;
  goalActive: boolean;
  goalTimer: number;
  goalScorer: Side;
  slowMo: number;
  serve: number;
  serveMax: number;
  serveBeats: number;
  speedDisplay: number;
  shake: number;
  squash: { x: number; y: number; angle: number };
  marks: Mark[];
  ai: Record<Side, AiMemory>;
};

/** 一方球拍由谁控制。keys 与 target 都是球桌坐标。 */
export type Control =
  | { kind: 'human'; keys: { x: number; y: number }; target: { x: number; y: number } | null }
  | { kind: 'ai'; level: Difficulty };

export type Emit = (event: GameEvent) => void;

function createPaddle(x: number): Paddle {
  return { x, y: TABLE_HEIGHT / 2, prevX: x, prevY: TABLE_HEIGHT / 2, vx: 0, vy: 0, score: 0, recoilX: 0, recoilY: 0, cooldown: 0 };
}

export function createSim(): Sim {
  return {
    p1: createPaddle(100),
    p2: createPaddle(TABLE_WIDTH - 100),
    puck: { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2, vx: 0, vy: 0, spin: 0, rotation: 0 },
    winner: null,
    leftGoalIntact: true,
    rightGoalIntact: true,
    barrierCooldown: 0,
    consecutiveHits: 0,
    lastHitPos: { x: 0, y: 0 },
    hitStop: 0,
    hitStopMax: 0,
    lastImpactNormal: 0,
    isInversionHit: false,
    goalActive: false,
    goalTimer: 0,
    goalScorer: 1,
    slowMo: 1,
    serve: 0,
    serveMax: 0,
    serveBeats: 0,
    speedDisplay: 0,
    shake: 0,
    squash: { x: 1, y: 1, angle: 0 },
    marks: [],
    ai: { 1: createAiMemory(), 2: createAiMemory() },
  };
}

export function resetMatch(sim: Sim, emit: Emit) {
  Object.assign(sim, createSim());
  emit({ type: 'reset' });
  serveFromCenter(sim, null, emit);
}

/** 开始一次发球倒计时。访客看到冰球回到中央时，也用它在本机计时。 */
export function startServe(sim: Sim, opening: boolean, emit: Emit) {
  sim.serveBeats = opening ? 3 : 1;
  sim.serve = opening ? SERVE_FRAMES_START : SERVE_FRAMES_POINT;
  sim.serveMax = sim.serve;
  if (opening) emit({ type: 'countdown', n: 3 });
}

function serveFromCenter(sim: Sim, scorer: Side | null, emit: Emit) {
  Object.assign(sim.puck, { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2, spin: 0, rotation: 0 });
  // 冰球发向刚丢分的一方；开局随机。
  const direction = scorer === 1 ? -1 : scorer === 2 ? 1 : Math.random() > 0.5 ? 1 : -1;
  sim.puck.vx = direction * MIN_SPEED;
  sim.puck.vy = (Math.random() - 0.5) * 4;
  Object.assign(sim, {
    consecutiveHits: 0, goalActive: false, goalTimer: 0, slowMo: 1, leftGoalIntact: true, rightGoalIntact: true,
    barrierCooldown: 0, hitStop: 0, isInversionHit: false,
  });
  sim.squash.x = 1; sim.squash.y = 1;
  sim.p1.cooldown = 0; sim.p2.cooldown = 0;
  startServe(sim, scorer === null, emit);
}

function award(sim: Sim, scorer: Side, emit: Emit) {
  const paddle = scorer === 1 ? sim.p1 : sim.p2;
  paddle.score++;
  emit({ type: 'score', scorer, p1: sim.p1.score, p2: sim.p2.score });
  if (paddle.score >= WIN_SCORE) {
    Object.assign(sim, { winner: scorer, goalActive: false, slowMo: 1, hitStop: 0, shake: 0 });
    emit({ type: 'win', winner: scorer, p1: sim.p1.score, p2: sim.p2.score });
    return;
  }
  serveFromCenter(sim, scorer, emit);
}

// 发球倒计时期间冰球停在中央；返回 true 表示仍在等待发球。
export function tickServe(sim: Sim, frames: number, emit: Emit) {
  if (sim.serve <= 0) return false;
  const before = Math.ceil(sim.serve / SERVE_BEAT_FRAMES);
  sim.serve -= frames;
  if (sim.serve <= 0) { sim.serve = 0; emit({ type: 'serve' }); return false; }
  const after = Math.ceil(sim.serve / SERVE_BEAT_FRAMES);
  if (sim.serveBeats === 3 && after < before) emit({ type: 'countdown', n: after });
  return true;
}

function impact(sim: Sim, emit: Emit, x: number, y: number, normalAngle: number, force: number, freeze: boolean, kind: ImpactKind, side?: Side) {
  if (freeze) {
    sim.hitStop = Math.max(4, Math.min(MAX_HIT_STOP_FRAMES, force * HIT_STOP_SCALE));
    sim.hitStopMax = sim.hitStop;
    sim.lastImpactNormal = normalAngle;
    sim.isInversionHit = force > INVERSION_IMPACT_THRESHOLD;
    const squashFactor = Math.min(0.6, force * 0.025);
    sim.squash.angle = normalAngle;
    sim.squash.x = 1 - squashFactor;
    sim.squash.y = 1 + squashFactor;
  }
  // 边墙自己会抖，画面只在球拍击球时震动。
  if (kind === 'paddle' || kind === 'burst') sim.shake = Math.min(20, 3 + force);
  sim.marks.push({ x, y, r: Math.min(99, force), alpha: 1 });
  if (sim.marks.length > 12) sim.marks.shift();
  emit({ type: 'impact', kind, power: force, speed: Math.hypot(sim.puck.vx, sim.puck.vy), side, x, y });
}

export function keepOutOfGoalZone(paddle: { x: number; y: number }, side: Side) {
  const gx = side === 1 ? 0 : TABLE_WIDTH;
  const gy = TABLE_HEIGHT / 2;
  const dx = paddle.x - gx;
  const dy = paddle.y - gy;
  const dist = Math.hypot(dx, dy) || 1;
  const minDist = GOAL_ZONE_RADIUS + PADDLE_RADIUS;
  if (dist < minDist) {
    paddle.x = gx + (dx / dist) * minDist;
    paddle.y = gy + (dy / dist) * minDist;
  }
}

export function clampToHalf(paddle: { x: number; y: number }, side: Side) {
  const minX = side === 1 ? PADDLE_RADIUS : TABLE_WIDTH / 2 + PADDLE_RADIUS;
  const maxX = side === 1 ? TABLE_WIDTH / 2 - PADDLE_RADIUS : TABLE_WIDTH - PADDLE_RADIUS;
  paddle.x = Math.max(minX, Math.min(maxX, paddle.x));
  paddle.y = Math.max(PADDLE_RADIUS, Math.min(TABLE_HEIGHT - PADDLE_RADIUS, paddle.y));
}

/** 人控制的球拍：有方向键时按键移动，否则跟随目标位置。访客在本机预测自己的球拍时也用它。 */
export function moveHumanPaddle(paddle: { x: number; y: number }, control: Extract<Control, { kind: 'human' }>, dt: number) {
  if (control.target && control.keys.x === 0 && control.keys.y === 0) {
    let dx = control.target.x - paddle.x;
    let dy = control.target.y - paddle.y;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_PADDLE_SPEED) { dx *= MAX_PADDLE_SPEED / dist; dy *= MAX_PADDLE_SPEED / dist; }
    paddle.x += dx * dt;
    paddle.y += dy * dt;
  } else {
    paddle.x += control.keys.x * KEY_SPEED * dt;
    paddle.y += control.keys.y * KEY_SPEED * dt;
  }
}

function movePaddle(sim: Sim, side: Side, control: Control, dt: number) {
  const paddle = side === 1 ? sim.p1 : sim.p2;
  if (control.kind === 'ai') {
    stepAi(sim.ai[side], paddle, side, sim.puck, side === 1 ? sim.p2 : sim.p1, control.level, sim.serve > 0, dt);
  } else {
    moveHumanPaddle(paddle, control, dt);
  }
  paddle.x += paddle.recoilX * dt;
  paddle.y += paddle.recoilY * dt;
  clampToHalf(paddle, side);
  keepOutOfGoalZone(paddle, side);
  paddle.vx = (paddle.x - paddle.prevX) / (dt || 1);
  paddle.vy = (paddle.y - paddle.prevY) / (dt || 1);
}

export function stepSim(sim: Sim, controls: Record<Side, Control>, frames: number, emit: Emit) {
  if (sim.winner !== null || frames <= 0) return;
  const s = sim;
  const dt = frames * s.slowMo;

  for (let i = s.marks.length - 1; i >= 0; i--) {
    s.marks[i].alpha -= 0.12 * frames;
    if (s.marks[i].alpha <= 0) s.marks.splice(i, 1);
  }

  const recoilDecay = 0.85 * dt + (1 - dt);
  s.p1.recoilX *= recoilDecay; s.p1.recoilY *= recoilDecay;
  s.p2.recoilX *= recoilDecay; s.p2.recoilY *= recoilDecay;

  if (s.goalActive) s.hitStop = 0;
  if (s.hitStop > 0) s.hitStop -= dt;
  if (s.hitStop > 0) return;

  if (s.p1.cooldown > 0) s.p1.cooldown -= dt;
  if (s.p2.cooldown > 0) s.p2.cooldown -= dt;
  if (s.barrierCooldown > 0) s.barrierCooldown -= dt;

  movePaddle(s, 1, controls[1], dt);
  movePaddle(s, 2, controls[2], dt);

  if (!tickServe(s, frames, emit)) movePuck(s, dt, emit);

  if (s.goalActive) {
    s.goalTimer -= frames;
    if (s.goalTimer <= 0) { award(s, s.goalScorer, emit); if (s.winner !== null) return; }
  }

  s.p1.prevX = s.p1.x; s.p1.prevY = s.p1.y;
  s.p2.prevX = s.p2.x; s.p2.prevY = s.p2.y;

  const friction = Math.pow(VELOCITY_FRICTION, dt);
  s.puck.spin *= Math.pow(SPIN_FRICTION, dt);
  s.puck.vx *= friction; s.puck.vy *= friction;
  const speedSq = s.puck.vx ** 2 + s.puck.vy ** 2;
  s.speedDisplay = s.speedDisplay * 0.9 + Math.sqrt(speedSq) * 0.1;
  if (speedSq < MIN_SPEED ** 2 && speedSq > 0.01) {
    const boost = MIN_SPEED / Math.sqrt(speedSq);
    s.puck.vx *= boost; s.puck.vy *= boost;
  }
  if (speedSq > MAX_SPEED ** 2) {
    const decay = Math.pow(0.95, dt);
    s.puck.vx *= decay; s.puck.vy *= decay;
  }
}

function movePuck(s: Sim, dt: number, emit: Emit) {
  const puck = s.puck;
  const fastestPaddle = Math.max(Math.hypot(s.p1.vx, s.p1.vy), Math.hypot(s.p2.vx, s.p2.vy));
  // 每个子步最多移动半个像素，高速时也不会穿过球拍或边墙。
  const steps = Math.max(1, Math.ceil(((Math.hypot(puck.vx, puck.vy) + fastestPaddle + 10) * dt) / 0.5));
  const h = dt / steps;

  for (let step = 0; step < steps; step++) {
    let barrierBroke = false;
    const stepVx = puck.vx * h;
    const stepVy = puck.vy * h;

    // 旋转使速度方向持续偏转（Magnus 效应）。
    if (Math.abs(puck.spin) > 0.01) {
      const turn = puck.spin * h * MAGNUS_POWER;
      const vx0 = puck.vx; const vy0 = puck.vy;
      puck.vx = vx0 - vy0 * turn;
      puck.vy = vy0 + vx0 * turn;
    }

    const startX = puck.x; const startY = puck.y;
    puck.x += stepVx; puck.y += stepVy; puck.rotation += puck.spin * h;

    if (!s.goalActive) {
      const scorer: Side | null = puck.x < -PUCK_RADIUS && !s.leftGoalIntact ? 2
        : puck.x > TABLE_WIDTH + PUCK_RADIUS && !s.rightGoalIntact ? 1 : null;
      if (scorer) {
        Object.assign(s, { goalActive: true, goalScorer: scorer, slowMo: GOAL_SLOW_MO_FACTOR, goalTimer: GOAL_CELEBRATION_FRAMES });
        emit({ type: 'goal', scorer });
      }
    }

    if (!s.goalActive) {
      const insideX = puck.x > 0 && puck.x < TABLE_WIDTH;
      if (insideX && puck.y < PUCK_RADIUS) {
        puck.y = PUCK_RADIUS;
        if (puck.vy < 0) { puck.vy *= -0.9; impact(s, emit, puck.x, 0, Math.PI / 2, Math.abs(puck.vy), false, 'wall'); }
      }
      if (insideX && puck.y > TABLE_HEIGHT - PUCK_RADIUS) {
        puck.y = TABLE_HEIGHT - PUCK_RADIUS;
        if (puck.vy > 0) { puck.vy *= -0.9; impact(s, emit, puck.x, TABLE_HEIGHT, -Math.PI / 2, Math.abs(puck.vy), false, 'wall'); }
      }

      // 屏障已经断开时，球门范围内的冰球可以越过端线。
      const inGoalMouth = Math.abs(puck.y - TABLE_HEIGHT / 2) < GOAL_HEIGHT / 2 + 20;
      if (puck.x < PUCK_RADIUS && (s.leftGoalIntact || !inGoalMouth)) {
        puck.x = PUCK_RADIUS;
        if (puck.vx < 0) { puck.vx *= -0.9; impact(s, emit, 0, puck.y, 0, Math.abs(puck.vx), false, 'wall'); }
      }
      if (puck.x > TABLE_WIDTH - PUCK_RADIUS && (s.rightGoalIntact || !inGoalMouth)) {
        puck.x = TABLE_WIDTH - PUCK_RADIUS;
        if (puck.vx > 0) { puck.vx *= -0.9; impact(s, emit, TABLE_WIDTH, puck.y, Math.PI, Math.abs(puck.vx), false, 'wall'); }
      }

      if (hitBarrier(s, 'left', emit)) barrierBroke = true;
      if (hitBarrier(s, 'right', emit)) barrierBroke = true;
    }

    if (!barrierBroke) {
      for (const [cx, cy] of [[0, GOAL_TOP], [0, GOAL_BOTTOM], [TABLE_WIDTH, GOAL_TOP], [TABLE_WIDTH, GOAL_BOTTOM]]) {
        const dx = puck.x - cx; const dy = puck.y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist < PUCK_RADIUS && dist > 0) {
          const nx = dx / dist; const ny = dy / dist;
          puck.x = cx + nx * PUCK_RADIUS; puck.y = cy + ny * PUCK_RADIUS;
          const along = puck.vx * nx + puck.vy * ny;
          puck.vx -= 2 * along * nx; puck.vy -= 2 * along * ny;
          impact(s, emit, cx, cy, Math.atan2(ny, nx), 5, false, 'post');
        }
      }
    }

    hitPaddles(s, startX, startY, (step + 1) / steps, emit);
  }
}

// 屏障的碰撞。返回 true 表示这一步把屏障撞断了。
function hitBarrier(s: Sim, side: 'left' | 'right', emit: Emit) {
  const puck = s.puck;
  const intact = side === 'left' ? s.leftGoalIntact : s.rightGoalIntact;
  if (!intact || s.barrierCooldown > 0) return false;
  if (puck.y <= GOAL_TOP || puck.y >= GOAL_BOTTOM) return false;
  const bx = side === 'left' ? 0 : TABLE_WIDTH;
  if (Math.abs(puck.x - bx) >= PUCK_RADIUS + 5) return false;

  const bounce = () => {
    puck.x = bx + (side === 'left' ? PUCK_RADIUS + 2 : -PUCK_RADIUS - 2);
    puck.vx *= -0.8;
    impact(s, emit, bx, puck.y, side === 'left' ? 0 : Math.PI, Math.abs(puck.vx), false, 'barrier');
  };
  s.barrierCooldown = 10;

  // 皮筋靠近两端的地方绷得紧，撞不断。
  const edgeMargin = PUCK_RADIUS * 1.2;
  if (puck.y - GOAL_TOP < edgeMargin || GOAL_BOTTOM - puck.y < edgeMargin) { bounce(); return false; }

  const towards = side === 'left' ? puck.vx < 0 : puck.vx > 0;
  if (towards && Math.abs(puck.vx) >= BARRIER_STRENGTH) {
    if (side === 'left') s.leftGoalIntact = false; else s.rightGoalIntact = false;
    emit({ type: 'break', side });
    return true;
  }
  bounce();
  return false;
}

function hitPaddles(s: Sim, startX: number, startY: number, t: number, emit: Emit) {
  const puck = s.puck;
  const minDist = PADDLE_RADIUS + PUCK_RADIUS;
  for (const side of [1, 2] as const) {
    const p = side === 1 ? s.p1 : s.p2;
    // 球拍这一帧的位置按子步插值；冰球按这一子步走过的线段检查。
    const pX = p.prevX + (p.x - p.prevX) * t;
    const pY = p.prevY + (p.y - p.prevY) * t;
    const segX = puck.x - startX; const segY = puck.y - startY;
    const segLenSq = segX * segX + segY * segY;
    let along = 0;
    if (segLenSq > 0.000001) along = Math.max(0, Math.min(1, ((pX - startX) * segX + (pY - startY) * segY) / segLenSq));
    const dx = startX + segX * along - pX;
    const dy = startY + segY * along - pY;
    const dist = Math.hypot(dx, dy);
    if (dist >= minDist) continue;

    const nx = dist > 0 ? dx / dist : (side === 1 ? 1 : -1);
    const ny = dist > 0 ? dy / dist : 0;
    puck.x = pX + nx * minDist; puck.y = pY + ny * minDist;

    // 球拍速度按线性映射限幅后参与碰撞计算。
    const paddleSpeed = Math.hypot(p.vx, p.vy);
    const intensity = Math.min(1, paddleSpeed / MOUSE_SPEED_REQ_FOR_MAX);
    const scale = paddleSpeed > 0.1 ? (intensity * MAX_PADDLE_PHYSICS_SPEED) / paddleSpeed : 1;
    const pVx = p.vx * scale; const pVy = p.vy * scale;
    const relVx = puck.vx - pVx; const relVy = puck.vy - pVy;
    const velNormal = relVx * nx + relVy * ny;
    const velTangent = relVx * -ny + relVy * nx;

    if (p.cooldown > 0) {
      if (velNormal < 0) { puck.vx -= 1.6 * velNormal * nx; puck.vy -= 1.6 * velNormal * ny; }
      return;
    }
    p.cooldown = HIT_EFFECT_COOLDOWN;

    // 轻触：球拍几乎没动时，这一下不加旋转也不停顿。
    const softTouch = paddleSpeed < 2 && Math.hypot(p.x - p.prevX, p.y - p.prevY) < 1.5;

    const fromLastHit = Math.hypot(puck.x - s.lastHitPos.x, puck.y - s.lastHitPos.y);
    s.consecutiveHits = fromLastHit < 100 ? s.consecutiveHits + 1 : 1;
    s.lastHitPos = { x: puck.x, y: puck.y };

    if (s.consecutiveHits >= EXPLOSION_THRESHOLD) {
      // 连击爆发：冰球背离球拍高速弹出，方向带一些随机。
      const angle = Math.atan2(ny, nx) + (Math.random() - 0.5) * 1.6;
      puck.vx = Math.cos(angle) * MAX_SPEED; puck.vy = Math.sin(angle) * MAX_SPEED;
      p.recoilX = -Math.cos(angle) * 80; p.recoilY = -Math.sin(angle) * 80;
      s.consecutiveHits = 0;
      impact(s, emit, puck.x, puck.y, angle, 30, true, 'burst', side);
      return;
    }

    if (!softTouch) puck.spin = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, puck.spin + velTangent * SPIN_TRANSFER_FACTOR));

    if (velNormal < 0) {
      const impulse = -(1 + RESTITUTION) * velNormal;
      puck.vx += impulse * nx; puck.vy += impulse * ny;
      // 只有迎着冰球挥拍才追加力度；顺着来球后撤可以卸力。
      const paddleNormalVel = pVx * nx + pVy * ny;
      if (paddleNormalVel > 0) {
        puck.vx += nx * intensity * MAX_PADDLE_IMPACT; puck.vy += ny * intensity * MAX_PADDLE_IMPACT;
        const outgoing = puck.vx * nx + puck.vy * ny;
        if (outgoing < MIN_SPEED) { puck.vx += nx * (MIN_SPEED - outgoing); puck.vy += ny * (MIN_SPEED - outgoing); }
      }
    }
    impact(s, emit, puck.x - nx * PUCK_RADIUS, puck.y - ny * PUCK_RADIUS, Math.atan2(ny, nx), Math.hypot(puck.vx, puck.vy), !softTouch, 'paddle', side);
    return;
  }
}
