import type { GameEvent, Side } from '../../types';
import { SERVE_BEAT_FRAMES, type Emit, type Sim } from './sim';
import { createString, pluck, stepString, traceString, type StringLine } from './strings';
import {
  GOAL_BOTTOM, GOAL_TOP, GOAL_ZONE_RADIUS, LINE_THICKNESS, PADDLE_RADIUS, PUCK_RADIUS, TABLE_HEIGHT, TABLE_WIDTH,
} from './table';

/**
 * 画面：把模拟的状态画出来，并保存只属于画面的东西——
 * 边墙的抖动、屏障皮筋的状态、每个进球的球路。
 * 球桌上的一切都是线：撞墙是拨弦，破门是皮筋绷断，一局打完留下的是进球球路组成的线图。
 */

// 纸色与墨色随主题变化，与 src/styles.css 中的 --paper、--ink 保持一致。
// 速度箭头为蓝色、旋转箭头为红色；黑色主题使用更亮的蓝与红。
const PALETTES = {
  light: { paper: [236, 234, 228], ink: [34, 34, 32], velocity: '#1F3FE0', spin: '#E02B1F' },
  dark: { paper: [25, 25, 24], ink: [222, 220, 214], velocity: '#7C97FF', spin: '#FF6A55' },
} as const;
const BARRIER_TINT = 0.4;

const ARROW_LEN_SCALE = 6;
const SCORE_FLASH_FRAMES = 45;
const PATH_STEP = 4;
const PATH_MARGIN = 34;

// 屏障皮筋
const SNAP_DEPTH = 40;
const TORN_FRAMES = 34;
const RESTRING_FRAMES = 14;

// 获胜后的球路重画
const WIN_FADE_FRAMES = 40;
const RECAP_GAP_FRAMES = 20;
const RECAP_DRAW_FRAMES = 16;

type Point = { x: number; y: number };
type Shot = { pts: Point[]; scorer: Side };
type Band = { line: StringLine; mode: 'intact' | 'stretch' | 'torn' | 'restring'; tearY: number; t: number };

export type Layout = { scale: number; baseX: number; baseY: number; rot: -1 | 0 | 1; dpr: number };

export type View = {
  walls: { top: StringLine; bottom: StringLine; leftUpper: StringLine; leftLower: StringLine; rightUpper: StringLine; rightLower: StringLine };
  bands: { left: Band; right: Band };
  /** 最近一次球拍击球（或发球）之后冰球走过的路。 */
  path: Point[];
  /** 这一局每个进球的球路，按进球顺序。 */
  shots: Shot[];
  pulse: Record<Side, number>;
  scoreFlash: { side: 0 | Side; t: number };
  win: { winner: Side; t: number; drawn: number; settled: boolean } | null;
};

export function createView(): View {
  const band = (x: number, nx: number): Band => ({ line: createString(x, GOAL_TOP, x, GOAL_BOTTOM, nx, 0), mode: 'intact', tearY: TABLE_HEIGHT / 2, t: 0 });
  return {
    walls: {
      top: createString(0, 0, TABLE_WIDTH, 0, 0, -1),
      bottom: createString(0, TABLE_HEIGHT, TABLE_WIDTH, TABLE_HEIGHT, 0, 1),
      leftUpper: createString(0, 0, 0, GOAL_TOP, -1, 0),
      leftLower: createString(0, GOAL_BOTTOM, 0, TABLE_HEIGHT, -1, 0),
      rightUpper: createString(TABLE_WIDTH, 0, TABLE_WIDTH, GOAL_TOP, 1, 0),
      rightLower: createString(TABLE_WIDTH, GOAL_BOTTOM, TABLE_WIDTH, TABLE_HEIGHT, 1, 0),
    },
    bands: { left: band(0, -1), right: band(TABLE_WIDTH, 1) },
    path: [],
    shots: [],
    pulse: { 1: 0, 2: 0 },
    scoreFlash: { side: 0, t: 0 },
    win: null,
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/** 撞击点落在哪根弦上。 */
function stringAt(view: View, x: number, y: number): { line: StringLine; pos: number; band: boolean } {
  if (y <= 1) return { line: view.walls.top, pos: x, band: false };
  if (y >= TABLE_HEIGHT - 1) return { line: view.walls.bottom, pos: x, band: false };
  const left = x < TABLE_WIDTH / 2;
  if (y < GOAL_TOP) return { line: left ? view.walls.leftUpper : view.walls.rightUpper, pos: y, band: false };
  if (y > GOAL_BOTTOM) return { line: left ? view.walls.leftLower : view.walls.rightLower, pos: y - GOAL_BOTTOM, band: false };
  return { line: (left ? view.bands.left : view.bands.right).line, pos: y - GOAL_TOP, band: true };
}

export function viewOnEvent(view: View, sim: Sim, event: GameEvent) {
  switch (event.type) {
    case 'reset':
      Object.assign(view, { path: [], shots: [], win: null, scoreFlash: { side: 0, t: 0 } });
      break;
    case 'serve':
      view.path = [{ x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2 }];
      break;
    case 'impact':
      if (event.kind === 'paddle' || event.kind === 'burst') {
        if (event.side) view.pulse[event.side] = 1;
        view.path = [{ x: sim.puck.x, y: sim.puck.y }];
      } else {
        const hit = stringAt(view, event.x, event.y);
        const amp = event.kind === 'post' ? 3 : hit.band ? clamp(5 + event.power * 0.9, 6, 22) : clamp(1.5 + event.power * 0.3, 2, 13);
        pluck(hit.line, hit.pos, amp);
      }
      break;
    case 'score':
      view.shots.push({ pts: view.path, scorer: event.scorer });
      view.path = [];
      view.scoreFlash = { side: event.scorer, t: SCORE_FLASH_FRAMES };
      break;
    case 'win':
      view.win = { winner: event.winner, t: 0, drawn: 0, settled: false };
      break;
  }
}

function stepBand(band: Band, side: 'left' | 'right', sim: Sim, frames: number, emit: Emit) {
  const intact = side === 'left' ? sim.leftGoalIntact : sim.rightGoalIntact;
  if (intact) {
    if (band.mode === 'stretch' || band.mode === 'torn') { band.mode = 'restring'; band.t = 0; band.line.plucks = []; }
    else if (band.mode === 'restring') { band.t += frames; if (band.t >= RESTRING_FRAMES) band.mode = 'intact'; }
    return;
  }
  if (band.mode === 'intact' || band.mode === 'restring') { band.mode = 'stretch'; band.t = 0; band.line.plucks = []; }
  if (band.mode === 'stretch') {
    // 冰球顶着皮筋往外走；顶出一定深度后绷断。
    band.tearY = clamp(sim.puck.y, GOAL_TOP + 8, GOAL_BOTTOM - 8);
    if (bandDepth(band, sim) > SNAP_DEPTH || sim.winner !== null) { band.mode = 'torn'; band.t = 0; emit({ type: 'snap', side }); }
  } else {
    band.t += frames;
  }
}

function bandDepth(band: Band, sim: Sim) {
  const out = band.line.nx;
  return (sim.puck.x + out * PUCK_RADIUS - band.line.ax) * out;
}

export function stepView(view: View, sim: Sim, frames: number, emit: Emit) {
  if (frames <= 0) return;
  // 击球停顿时弦也停住；进球慢动作时弦跟着变慢。
  const stringFrames = sim.hitStop > 0 ? 0 : frames * sim.slowMo;
  for (const line of Object.values(view.walls)) stepString(line, stringFrames);
  stepString(view.bands.left.line, stringFrames);
  stepString(view.bands.right.line, stringFrames);
  stepBand(view.bands.left, 'left', sim, frames, emit);
  stepBand(view.bands.right, 'right', sim, frames, emit);

  for (const side of [1, 2] as const) view.pulse[side] = Math.max(0, view.pulse[side] - 0.07 * frames);
  if (view.scoreFlash.t > 0) view.scoreFlash.t -= frames;

  if (sim.winner === null && sim.serve <= 0 && view.path.length > 0 && view.path.length < 900) {
    const last = view.path[view.path.length - 1];
    const { x, y } = sim.puck;
    if (x > -PATH_MARGIN && x < TABLE_WIDTH + PATH_MARGIN && Math.hypot(x - last.x, y - last.y) >= PATH_STEP) view.path.push({ x, y });
  }

  const win = view.win;
  if (win) {
    win.t += frames;
    const total = view.shots.length;
    while (win.drawn < total && win.t >= recapStart(win.drawn)) {
      emit({ type: 'recap', index: win.drawn, total, scorer: view.shots[win.drawn].scorer });
      win.drawn++;
    }
    if (!win.settled && win.t >= recapStart(Math.max(0, total - 1)) + RECAP_DRAW_FRAMES + 24) {
      win.settled = true;
      emit({ type: 'settled', winner: win.winner });
    }
  }
}

const recapStart = (index: number) => WIN_FADE_FRAMES + 10 + index * RECAP_GAP_FRAMES;

function strokeShot(ctx: CanvasRenderingContext2D, shot: Shot, progress: number, arrow: boolean) {
  const count = Math.max(2, Math.ceil(shot.pts.length * clamp(progress, 0, 1)));
  if (shot.pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(shot.pts[0].x, shot.pts[0].y);
  for (let i = 1; i < count && i < shot.pts.length; i++) ctx.lineTo(shot.pts[i].x, shot.pts[i].y);
  const tip = shot.pts[Math.min(count, shot.pts.length) - 1];
  const before = shot.pts[Math.max(0, Math.min(count, shot.pts.length) - 4)];
  if (arrow && (tip.x !== before.x || tip.y !== before.y)) {
    const angle = Math.atan2(tip.y - before.y, tip.x - before.x);
    ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x - Math.cos(angle - Math.PI / 6) * 12, tip.y - Math.sin(angle - Math.PI / 6) * 12);
    ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x - Math.cos(angle + Math.PI / 6) * 12, tip.y - Math.sin(angle + Math.PI / 6) * 12);
  }
  ctx.stroke();
}

// 速度箭头越过球桌边缘后从另一边继续画，这样长箭头也能画全。
function drawWrappedArrow(ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number, color: string, progress: number) {
  const speed = Math.hypot(vx, vy);
  if (speed < 0.1) return;
  const dx = vx / speed; const dy = vy / speed;
  let remaining = speed * ARROW_LEN_SCALE * clamp(progress, 0, 1);
  let cx = x; let cy = y;
  ctx.strokeStyle = color; ctx.lineWidth = LINE_THICKNESS; ctx.beginPath();
  for (let segment = 0; segment < 3 && remaining > 0; segment++) {
    let reach = remaining; let wall = '';
    if (dx > 0) { const t = (TABLE_WIDTH - cx) / dx; if (t >= 0 && t < reach) { reach = t; wall = 'r'; } }
    if (dx < 0) { const t = -cx / dx; if (t >= 0 && t < reach) { reach = t; wall = 'l'; } }
    if (dy > 0) { const t = (TABLE_HEIGHT - cy) / dy; if (t >= 0 && t < reach) { reach = t; wall = 'b'; } }
    if (dy < 0) { const t = -cy / dy; if (t >= 0 && t < reach) { reach = t; wall = 't'; } }
    const ex = cx + dx * reach; const ey = cy + dy * reach;
    ctx.moveTo(cx, cy); ctx.lineTo(ex, ey);
    remaining -= reach;
    if (wall && remaining > 0) {
      cx = wall === 'r' ? 0 : wall === 'l' ? TABLE_WIDTH : ex;
      cy = wall === 'b' ? 0 : wall === 't' ? TABLE_HEIGHT : ey;
      cx += dx * 0.1; cy += dy * 0.1;
    } else {
      const angle = Math.atan2(dy, dx);
      ctx.lineTo(ex - Math.cos(angle - Math.PI / 6) * 15, ey - Math.sin(angle - Math.PI / 6) * 15);
      ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(angle + Math.PI / 6) * 15, ey - Math.sin(angle + Math.PI / 6) * 15);
      break;
    }
  }
  ctx.stroke();
}

function drawSpinArc(ctx: CanvasRenderingContext2D, sim: Sim, color: string, center: number, progress: number) {
  const spin = sim.puck.spin;
  if (Math.abs(spin) <= 0.05) return;
  const radius = PUCK_RADIUS + 13;
  const dir = Math.sign(spin);
  const arc = Math.min(Math.PI * 1.5, Math.abs(spin) * 6);
  const start = center - arc * 0.5 * dir;
  const end = start + arc * dir * progress;
  const tipX = sim.puck.x + Math.cos(end) * radius; const tipY = sim.puck.y + Math.sin(end) * radius;
  const tangent = end + dir * Math.PI / 2;
  ctx.strokeStyle = color; ctx.lineWidth = LINE_THICKNESS; ctx.beginPath();
  ctx.arc(sim.puck.x, sim.puck.y, radius, start, end, dir < 0);
  ctx.moveTo(tipX, tipY); ctx.lineTo(tipX - Math.cos(tangent - Math.PI / 6) * 10, tipY - Math.sin(tangent - Math.PI / 6) * 10);
  ctx.moveTo(tipX, tipY); ctx.lineTo(tipX - Math.cos(tangent + Math.PI / 6) * 10, tipY - Math.sin(tangent + Math.PI / 6) * 10);
  ctx.stroke();
}

function drawBand(ctx: CanvasRenderingContext2D, band: Band, sim: Sim) {
  const { line } = band;
  const bx = line.ax; const out = line.nx;
  ctx.beginPath();
  if (band.mode === 'intact') {
    traceString(ctx, line);
  } else if (band.mode === 'restring') {
    const grown = (line.length / 2) * easeOutCubic(band.t / RESTRING_FRAMES);
    traceString(ctx, line, 0, grown);
    traceString(ctx, line, line.length - grown, line.length);
  } else if (band.mode === 'stretch') {
    const tipX = bx + out * clamp(bandDepth(band, sim), 0, SNAP_DEPTH + 8);
    ctx.moveTo(bx, GOAL_TOP);
    ctx.quadraticCurveTo(tipX, band.tearY - PUCK_RADIUS * 1.2, tipX, band.tearY);
    ctx.quadraticCurveTo(tipX, band.tearY + PUCK_RADIUS * 1.2, bx, GOAL_BOTTOM);
  } else if (band.t < TORN_FRAMES) {
    // 断开的两截各自缩回门柱，缩的时候甩两下。
    const left = 1 - easeOutCubic(band.t / TORN_FRAMES);
    const whip = Math.sin(band.t * 0.7) * 12 * left;
    const tipX = bx + out * SNAP_DEPTH;
    for (const postY of [GOAL_TOP, GOAL_BOTTOM]) {
      const endX = bx + (tipX - bx) * left;
      const endY = postY + (band.tearY - postY) * left;
      ctx.moveTo(bx, postY);
      ctx.quadraticCurveTo((bx + endX) / 2 + out * whip, (postY + endY) / 2 + whip * 0.4, endX, endY);
    }
  }
  ctx.stroke();
}

export type RenderOptions = { theme: 'light' | 'dark'; paused: boolean; shake: boolean; demo: boolean };

export function render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, sim: Sim, view: View, layout: Layout, options: RenderOptions, dt: number) {
  const palette = PALETTES[options.theme];
  const ink = (alpha = 1) => `rgba(${palette.ink[0]},${palette.ink[1]},${palette.ink[2]},${alpha})`;
  const paper = `rgb(${palette.paper[0]},${palette.paper[1]},${palette.paper[2]})`;
  const barrier = `rgb(${palette.paper.map((value, index) => Math.round(value + (palette.ink[index] - value) * BARRIER_TINT)).join(',')})`;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let offsetX = 0; let offsetY = 0;
  if (sim.shake > 0) {
    if (options.shake && !options.paused) { offsetX = (Math.random() - 0.5) * sim.shake; offsetY = (Math.random() - 0.5) * sim.shake; }
    if (sim.hitStop <= 0) sim.shake *= 0.9 * dt + (1 - dt);
  }
  ctx.translate((layout.baseX + offsetX) * layout.dpr, (layout.baseY + offsetY) * layout.dpr);
  ctx.scale(layout.scale * layout.dpr, layout.scale * layout.dpr);
  if (layout.rot === -1) { ctx.translate(0, TABLE_WIDTH); ctx.rotate(-Math.PI / 2); }
  else if (layout.rot === 1) { ctx.translate(TABLE_HEIGHT, 0); ctx.rotate(Math.PI / 2); }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // 竖屏时球桌转了 90°：文字仍按画面方向正立。
  const textAngle = layout.rot === -1 ? Math.PI / 2 : layout.rot === 1 ? -Math.PI / 2 : 0;
  const upright = (x: number, y: number, draw: () => void) => { ctx.save(); ctx.translate(x, y); ctx.rotate(textAngle); draw(); ctx.restore(); };
  const fromScreen = (x: number, y: number) => layout.rot === -1 ? { x: TABLE_WIDTH - y, y: x } : layout.rot === 1 ? { x: y, y: TABLE_HEIGHT - x } : { x, y };
  const screenUp = layout.rot === -1 ? { x: 1, y: 0 } : layout.rot === 1 ? { x: -1, y: 0 } : { x: 0, y: -1 };

  // 获胜之后，球拍与冰球淡出，球桌退成淡淡的底，只留下球路。
  const win = view.win;
  const actors = win ? 1 - clamp(win.t / WIN_FADE_FRAMES, 0, 1) : 1;
  const table = win ? Math.max(0.22, actors) : 1;

  // 球门禁区与球门口袋
  ctx.lineWidth = 2; ctx.strokeStyle = ink(0.15 * table);
  ctx.beginPath(); ctx.arc(0, TABLE_HEIGHT / 2, GOAL_ZONE_RADIUS, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(TABLE_WIDTH, TABLE_HEIGHT / 2, GOAL_ZONE_RADIUS, Math.PI / 2, -Math.PI / 2); ctx.stroke();
  const pocket = 14;
  ctx.beginPath();
  ctx.moveTo(0, GOAL_TOP); ctx.lineTo(-pocket, GOAL_TOP); ctx.lineTo(-pocket, GOAL_BOTTOM); ctx.lineTo(0, GOAL_BOTTOM);
  ctx.moveTo(TABLE_WIDTH, GOAL_TOP); ctx.lineTo(TABLE_WIDTH + pocket, GOAL_TOP); ctx.lineTo(TABLE_WIDTH + pocket, GOAL_BOTTOM); ctx.lineTo(TABLE_WIDTH, GOAL_BOTTOM);
  ctx.stroke();

  // 中线与中央圆圈
  ctx.lineWidth = LINE_THICKNESS; ctx.strokeStyle = ink(0.1 * table);
  ctx.beginPath(); ctx.moveTo(TABLE_WIDTH / 2, 0); ctx.lineTo(TABLE_WIDTH / 2, TABLE_HEIGHT); ctx.stroke();
  ctx.beginPath(); ctx.arc(TABLE_WIDTH / 2, TABLE_HEIGHT / 2, 60, 0, Math.PI * 2); ctx.stroke();

  // 边墙：六根弦
  ctx.strokeStyle = ink(table);
  ctx.beginPath();
  for (const line of Object.values(view.walls)) traceString(ctx, line);
  ctx.stroke();

  // 半场里的比分。得分时短暂加深放大；一局结束后，胜方的数字留得更深。
  ctx.font = 'bold 160px "Helvetica Neue", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const drawScore = (side: Side, value: number, x: number) => {
    const flash = view.scoreFlash.side === side ? Math.max(0, view.scoreFlash.t / SCORE_FLASH_FRAMES) : 0;
    const ease = flash * flash;
    const settled = win ? clamp(win.t / WIN_FADE_FRAMES, 0, 1) * (win.winner === side ? 0.2 : -0.02) : 0;
    upright(x, TABLE_HEIGHT / 2, () => {
      ctx.scale(1 + ease * 0.3, 1 + ease * 0.3);
      ctx.fillStyle = ink(0.08 + ease * 0.5 + settled);
      ctx.fillText(value.toString(), 0, 0);
    });
  };
  drawScore(1, sim.p1.score, TABLE_WIDTH * 0.25); drawScore(2, sim.p2.score, TABLE_WIDTH * 0.75);

  // 进球的球路。比赛中淡淡地留在桌面上；获胜后按顺序重画成一张线图。
  if (!win) {
    ctx.lineWidth = 2; ctx.strokeStyle = ink(0.1);
    for (const shot of view.shots) strokeShot(ctx, shot, 1, false);
  } else {
    if (actors > 0) { ctx.lineWidth = 2; ctx.strokeStyle = ink(0.1 * actors); for (const shot of view.shots) strokeShot(ctx, shot, 1, false); }
    ctx.lineWidth = 2.5;
    for (let i = 0; i < win.drawn; i++) {
      const shot = view.shots[i];
      ctx.strokeStyle = ink(shot.scorer === win.winner ? 0.92 : 0.34);
      strokeShot(ctx, shot, (win.t - recapStart(i)) / RECAP_DRAW_FRAMES, true);
    }
  }

  // 速度读数
  if (!options.demo && actors > 0) {
    const anchor = layout.rot === 0 ? { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT - 30 } : fromScreen(TABLE_HEIGHT - 82, TABLE_WIDTH / 2 + 28);
    upright(anchor.x, anchor.y, () => {
      ctx.fillStyle = ink(0.6 * actors);
      ctx.font = 'italic bold 28px "Times New Roman", serif'; ctx.textAlign = 'right'; ctx.fillText('v', -5, 0);
      ctx.font = 'bold 28px "Times New Roman", serif'; ctx.textAlign = 'left'; ctx.fillText(`= ${Math.round(sim.speedDisplay * 3)}`, 0, 0);
    });
  }

  // 发球倒计时：围绕中央圆圈逐渐收短的圆环
  if (sim.serve > 0 && sim.winner === null) {
    const start = Math.atan2(screenUp.y, screenUp.x);
    ctx.lineWidth = LINE_THICKNESS; ctx.strokeStyle = ink(); ctx.beginPath();
    ctx.arc(TABLE_WIDTH / 2, TABLE_HEIGHT / 2, 60, start, start + Math.PI * 2 * Math.min(1, sim.serve / (sim.serveMax || SERVE_BEAT_FRAMES)));
    ctx.stroke();
  }

  // 屏障：两根皮筋
  ctx.globalAlpha = table;
  ctx.lineWidth = LINE_THICKNESS; ctx.strokeStyle = barrier;
  drawBand(ctx, view.bands.left, sim);
  drawBand(ctx, view.bands.right, sim);

  ctx.globalAlpha = actors;
  if (actors > 0) {
    // 这一拍打出去的球路
    if (view.path.length > 1 && sim.winner === null) {
      ctx.lineWidth = 2; ctx.strokeStyle = ink(0.14);
      strokeShot(ctx, { pts: view.path, scorer: 1 }, 1, false);
      const last = view.path[view.path.length - 1];
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(sim.puck.x, sim.puck.y); ctx.stroke();
    }

    // 球拍：左方中心是空心圆环，右方是实心圆点。击球时一圈波纹从中心扩到边缘。
    const inner = PADDLE_RADIUS / 3;
    for (const side of [1, 2] as const) {
      const paddle = side === 1 ? sim.p1 : sim.p2;
      ctx.lineWidth = LINE_THICKNESS; ctx.strokeStyle = ink(); ctx.fillStyle = paper;
      ctx.beginPath(); ctx.arc(paddle.x, paddle.y, PADDLE_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const pulse = view.pulse[side];
      if (pulse > 0) {
        ctx.lineWidth = 2; ctx.strokeStyle = ink(pulse * 0.6);
        ctx.beginPath(); ctx.arc(paddle.x, paddle.y, inner + (PADDLE_RADIUS - inner) * (1 - pulse), 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = LINE_THICKNESS; ctx.strokeStyle = ink();
      }
      ctx.beginPath(); ctx.arc(paddle.x, paddle.y, inner, 0, Math.PI * 2);
      if (side === 2) { ctx.fillStyle = ink(); ctx.fill(); } else ctx.stroke();
    }

    // 冰球：沿碰撞方向压扁，再恢复
    if (sim.hitStop <= 0) {
      sim.squash.x += (1 - sim.squash.x) * 0.45 * dt;
      sim.squash.y += (1 - sim.squash.y) * 0.45 * dt;
    }
    ctx.save();
    ctx.translate(sim.puck.x, sim.puck.y);
    ctx.rotate(sim.squash.angle); ctx.scale(sim.squash.x, sim.squash.y); ctx.rotate(-sim.squash.angle);
    ctx.rotate(sim.puck.rotation);
    ctx.lineWidth = LINE_THICKNESS; ctx.strokeStyle = ink(); ctx.fillStyle = paper;
    ctx.beginPath(); ctx.arc(0, 0, PUCK_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -PUCK_RADIUS + 3); ctx.lineTo(0, PUCK_RADIUS - 3);
    ctx.moveTo(-PUCK_RADIUS + 3, 0); ctx.lineTo(PUCK_RADIUS - 3, 0);
    ctx.stroke();
    ctx.restore();

    // 极强的一击：以冰球为中心扩张的反色
    if (sim.hitStop > 0 && sim.isInversionHit) {
      ctx.save(); ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = 'white';
      const progress = 1 - sim.hitStop / (sim.hitStopMax || 1);
      ctx.beginPath(); ctx.arc(sim.puck.x, sim.puck.y, PUCK_RADIUS + 500 * Math.pow(progress, 0.4), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // 时间停住的时候（击球停顿或者暂停），画出冰球的速度与旋转。
    if (sim.hitStop > 0) {
      const p = 1 - sim.hitStop / (sim.hitStopMax || 1);
      const grow = easeOutCubic(Math.min(1, p * 2.6));
      drawWrappedArrow(ctx, sim.puck.x, sim.puck.y, sim.puck.vx, sim.puck.vy, palette.velocity, grow);
      const swing = Math.sin(easeOutCubic(Math.min(1, p * 1.1)) * Math.PI) * 0.55 * Math.sign(sim.puck.spin);
      drawSpinArc(ctx, sim, palette.spin, sim.lastImpactNormal + swing, grow);
    } else if (options.paused && sim.serve <= 0 && sim.winner === null && !sim.goalActive) {
      drawWrappedArrow(ctx, sim.puck.x, sim.puck.y, sim.puck.vx, sim.puck.vy, palette.velocity, 1);
      drawSpinArc(ctx, sim, palette.spin, Math.atan2(sim.puck.vy, sim.puck.vx), 1);
    }
  }
  ctx.globalAlpha = 1;
}
