import type { Difficulty, Side } from '../../types';
import { GOAL_ZONE_RADIUS, PADDLE_RADIUS, PUCK_RADIUS, TABLE_HEIGHT, TABLE_WIDTH } from './table';

/**
 * AI 对手。每一帧做三件事：
 * 1. 按延迟后的冰球状态往前推算球路（算上上下边墙的反弹）；
 * 2. 找出最早能赶到的击球位置——站在冰球背对目标的一侧；
 * 3. 赶得到就过去并朝目标挥拍，赶不到就退回球门前的防守位置。
 * 它只通过移动球拍来打球，不改写冰球的速度与旋转。
 *
 * 内部一律按“AI 守右侧球门”计算，控制左方时把坐标左右镜像。
 */

const CONTACT = PADDLE_RADIUS + PUCK_RADIUS;
const HISTORY = 16;

type Level = {
  /** 移动与挥拍的速度，每帧像素。 */
  speed: number; swing: number;
  /** 看到的是几帧之前的冰球。 */
  delay: number;
  /** 往前推算多少帧。 */
  horizon: number;
  /** 瞄准球门时上下偏差的范围。 */
  aimError: number;
};

const LEVELS: Record<Difficulty, Level> = {
  easy: { speed: 7, swing: 11, delay: 12, horizon: 26, aimError: 85 },
  normal: { speed: 11, swing: 17, delay: 7, horizon: 40, aimError: 40 },
  hard: { speed: 16, swing: 25, delay: 3, horizon: 55, aimError: 12 },
};

type PuckState = { x: number; y: number; vx: number; vy: number };

export type AiMemory = { seen: PuckState[]; aim: number; engaged: boolean };

export function createAiMemory(): AiMemory {
  return { seen: [], aim: 0, engaged: false };
}

export function stepAi(
  memory: AiMemory,
  self: { x: number; y: number },
  side: Side,
  puck: PuckState,
  rival: { x: number; y: number },
  difficulty: Difficulty,
  serving: boolean,
  dt: number,
) {
  const level = LEVELS[difficulty];
  const mirror = side === 1;
  const flip = (x: number) => (mirror ? TABLE_WIDTH - x : x);

  memory.seen.push({ x: puck.x, y: puck.y, vx: puck.vx, vy: puck.vy });
  if (memory.seen.length > HISTORY) memory.seen.shift();
  const seen = memory.seen[Math.max(0, memory.seen.length - 1 - level.delay)];

  const me = { x: flip(self.x), y: self.y };
  const now = { x: flip(seen.x), y: seen.y, vx: mirror ? -seen.vx : seen.vx, vy: seen.vy };
  const goal = { x: TABLE_WIDTH, y: TABLE_HEIGHT / 2 };
  const target = { x: 0, y: TABLE_HEIGHT / 2 + memory.aim };

  // 防守位置：球门与冰球的连线上，紧贴禁区外侧。
  const toPuck = Math.hypot(now.x - goal.x, now.y - goal.y) || 1;
  const guard = GOAL_ZONE_RADIUS + PADDLE_RADIUS + 14;
  let goTo = {
    x: Math.max(TABLE_WIDTH / 2 + PADDLE_RADIUS, goal.x + ((now.x - goal.x) / toPuck) * guard),
    y: goal.y + ((now.y - goal.y) / toPuck) * guard,
  };
  let speed = level.speed;
  let engaged = false;

  if (!serving) {
    // 往前推算，找最早能赶到的击球位置。
    const at = { ...now };
    for (let t = 0; t <= level.horizon; t++) {
      if (t > 0) {
        at.x += at.vx; at.y += at.vy;
        if (at.y < PUCK_RADIUS) { at.y = PUCK_RADIUS; at.vy = Math.abs(at.vy) * 0.9; }
        if (at.y > TABLE_HEIGHT - PUCK_RADIUS) { at.y = TABLE_HEIGHT - PUCK_RADIUS; at.vy = -Math.abs(at.vy) * 0.9; }
        if (at.x < PUCK_RADIUS) { at.x = PUCK_RADIUS; at.vx = Math.abs(at.vx) * 0.9; }
        if (at.x > TABLE_WIDTH - PUCK_RADIUS) { at.x = TABLE_WIDTH - PUCK_RADIUS; at.vx = -Math.abs(at.vx) * 0.9; }
      }
      if (at.x < TABLE_WIDTH / 2 + 6) continue;

      // 站位在冰球背对目标的一侧，这样迎上去就是朝目标打。
      const away = Math.hypot(at.x - target.x, at.y - target.y) || 1;
      const behindX = (at.x - target.x) / away;
      const behindY = (at.y - target.y) / away;
      // 贴着边墙或者禁区的球，站位收进球拍能到的范围里，从稍偏的角度去打。
      const stand = {
        x: Math.max(TABLE_WIDTH / 2 + PADDLE_RADIUS, Math.min(TABLE_WIDTH - PADDLE_RADIUS, at.x + behindX * (CONTACT + 4))),
        y: Math.max(PADDLE_RADIUS, Math.min(TABLE_HEIGHT - PADDLE_RADIUS, at.y + behindY * (CONTACT + 4))),
      };
      const fromGoal = Math.hypot(stand.x - goal.x, stand.y - goal.y) || 1;
      const keepOut = GOAL_ZONE_RADIUS + PADDLE_RADIUS;
      if (fromGoal < keepOut) {
        stand.x = goal.x + ((stand.x - goal.x) / fromGoal) * keepOut;
        stand.y = goal.y + ((stand.y - goal.y) / fromGoal) * keepOut;
      }
      if (Math.hypot(stand.x - me.x, stand.y - me.y) > level.speed * (t + 1)) continue;

      engaged = true;
      const gapX = me.x - now.x; const gapY = me.y - now.y;
      const gap = Math.hypot(gapX, gapY);
      const isBehind = gapX * behindX + gapY * behindY > gap * 0.3;
      if (isBehind && gap < CONTACT + level.swing * 1.5) {
        // 已经在冰球后面并且够近：穿过冰球朝目标挥拍。
        const aimLen = Math.hypot(target.x - now.x, target.y - now.y) || 1;
        goTo = { x: now.x + ((target.x - now.x) / aimLen) * 70, y: now.y + ((target.y - now.y) / aimLen) * 70 };
        speed = level.swing;
      } else {
        goTo = stand;
        // 直线过去会先碰到冰球时，从侧面绕到它后面。
        const pathX = stand.x - me.x; const pathY = stand.y - me.y;
        const pathLen = Math.hypot(pathX, pathY);
        if (pathLen > 1) {
          const along = Math.max(0, Math.min(1, ((now.x - me.x) * pathX + (now.y - me.y) * pathY) / (pathLen * pathLen)));
          const offX = now.x - (me.x + pathX * along); const offY = now.y - (me.y + pathY * along);
          if (along > 0.05 && along < 0.95 && Math.hypot(offX, offY) < CONTACT + 6) {
            const sideways = (pathX * (now.y - me.y) - pathY * (now.x - me.x)) >= 0 ? -1 : 1;
            goTo = {
              x: now.x + (-pathY / pathLen) * sideways * (CONTACT + 26),
              y: now.y + (pathX / pathLen) * sideways * (CONTACT + 26),
            };
          }
        }
      }
      break;
    }
  }

  // 每次开始一轮进攻时选一个瞄准点：偏向对方球拍不在的那一侧，再加上这一档的偏差。
  if (engaged && !memory.engaged) {
    const awayFromRival = rival.y > TABLE_HEIGHT / 2 ? -1 : 1;
    memory.aim = awayFromRival * 42 + (Math.random() - 0.5) * 2 * level.aimError;
  }
  memory.engaged = engaged;

  const moveX = flip(goTo.x) - self.x;
  const moveY = goTo.y - self.y;
  const distance = Math.hypot(moveX, moveY);
  if (distance > 0.5) {
    const stride = Math.min(distance, speed * dt);
    self.x += (moveX / distance) * stride;
    self.y += (moveY / distance) * stride;
  }
}
