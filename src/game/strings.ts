/**
 * 球桌的边墙与球门屏障都是两端固定的弦。冰球撞上去就是拨了一下：
 * 弦在撞击点被推出一个尖角，随后按拨弦的各次谐波来回振动并衰减。
 * 这里只负责形状，碰撞仍按直线计算。
 */
export type Pluck = { pos: number; amp: number; age: number };

export type StringLine = {
  ax: number; ay: number; bx: number; by: number;
  /** 弦被冰球推开的方向（球桌外侧）。 */
  nx: number; ny: number;
  length: number;
  plucks: Pluck[];
};

const WAVE_SPEED = 24; // 每帧像素；决定弦抖动的快慢
const DAMPING = 0.032;
const MAX_HARMONICS = 8;
const MIN_PERIOD_FRAMES = 5; // 周期更短的谐波在 60 Hz 下只会闪烁，不画
const MAX_PLUCKS = 5;
const SILENT_AMPLITUDE = 0.2;

export function createString(ax: number, ay: number, bx: number, by: number, nx: number, ny: number): StringLine {
  return { ax, ay, bx, by, nx, ny, length: Math.hypot(bx - ax, by - ay), plucks: [] };
}

/** pos 为沿弦的距离，amp 为撞击点被推开的像素数。 */
export function pluck(line: StringLine, pos: number, amp: number) {
  const margin = line.length * 0.08;
  line.plucks.push({ pos: Math.max(margin, Math.min(line.length - margin, pos)), amp, age: 0 });
  if (line.plucks.length > MAX_PLUCKS) line.plucks.shift();
}

export function stepString(line: StringLine, frames: number) {
  for (let i = line.plucks.length - 1; i >= 0; i--) {
    const item = line.plucks[i];
    item.age += frames;
    if (Math.abs(item.amp) * Math.exp(-DAMPING * item.age) < SILENT_AMPLITUDE) line.plucks.splice(i, 1);
  }
}

function displacement(line: StringLine, x: number) {
  const L = line.length;
  const harmonics = Math.max(1, Math.min(MAX_HARMONICS, Math.floor((2 * L) / (MIN_PERIOD_FRAMES * WAVE_SPEED))));
  const omega = (Math.PI * WAVE_SPEED) / L;
  let sum = 0;
  for (const { pos, amp, age } of line.plucks) {
    // 在 pos 处拨成三角形的弦，其第 n 次谐波的幅度。
    const shape = (2 * amp * L * L) / (Math.PI * Math.PI * pos * (L - pos));
    for (let n = 1; n <= harmonics; n++) {
      sum += (shape / (n * n)) * Math.sin((n * Math.PI * pos) / L) * Math.sin((n * Math.PI * x) / L)
        * Math.cos(n * omega * age) * Math.exp(-DAMPING * (1 + 0.6 * (n - 1)) * age);
    }
  }
  return sum;
}

/** 把弦从 from 到 to（沿弦的距离）的一段加入当前路径。 */
export function traceString(ctx: CanvasRenderingContext2D, line: StringLine, from = 0, to = line.length) {
  const dx = (line.bx - line.ax) / line.length;
  const dy = (line.by - line.ay) / line.length;
  if (line.plucks.length === 0) {
    ctx.moveTo(line.ax + dx * from, line.ay + dy * from);
    ctx.lineTo(line.ax + dx * to, line.ay + dy * to);
    return;
  }
  const steps = Math.max(2, Math.ceil((to - from) / 10));
  for (let i = 0; i <= steps; i++) {
    const x = from + ((to - from) * i) / steps;
    const offset = displacement(line, x);
    const px = line.ax + dx * x + line.nx * offset;
    const py = line.ay + dy * x + line.ny * offset;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
}
