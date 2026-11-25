/** 访客画面上由房主决定的位置：左方球拍与冰球。 */
export type Pose = { p1x: number; p1y: number; puckX: number; puckY: number; rotation: number };

const MAX_FRAME_MS = 34;
const MAX_AHEAD_FRAMES = 3;
const FRAME_MS = 1000 / 60;

/**
 * 房主每秒发送约 20 份快照，访客每秒绘制 60 帧。
 * 每收到一份快照，画面从当前显示的位置出发，在一个快照间隔内移动到快照位置；
 * 下一份快照迟到时，冰球按快照中的速度继续前进，最多三帧。
 */
export function createGuestSmoother(defaultIntervalMs: number) {
  let from: Pose | null = null;
  let target: Pose | null = null;
  let arrivedAt = 0;
  let interval = defaultIntervalMs;

  return {
    /**
     * 在发现新快照的那一帧调用。
     * current 是画面当前显示的位置；jumped 表示冰球被重新放置，画面直接采用快照位置。
     */
    push(time: number, frameMs: number, next: Pose, current: Pose, jumped: boolean) {
      // 快照在上一帧之后到达：把起点时间前移一帧，使到达的这一帧也有位移。
      const arrival = time - Math.min(MAX_FRAME_MS, frameMs);
      if (target) interval = interval * 0.7 + Math.max(30, Math.min(150, arrival - arrivedAt)) * 0.3;
      arrivedAt = arrival;
      from = jumped || !target ? next : current;
      target = next;
    },

    /** velocity 以每帧像素计；传入 null 表示冰球此刻静止，不向前推算。 */
    sample(time: number, velocity: { vx: number; vy: number } | null): Pose | null {
      if (!from || !target) return null;
      const since = time - arrivedAt;
      const a = Math.max(0, Math.min(1, since / interval));
      const mix = (start: number, end: number) => start + (end - start) * a;
      const pose: Pose = {
        p1x: mix(from.p1x, target.p1x),
        p1y: mix(from.p1y, target.p1y),
        puckX: mix(from.puckX, target.puckX),
        puckY: mix(from.puckY, target.puckY),
        rotation: mix(from.rotation, target.rotation),
      };
      if (velocity && since > interval) {
        const ahead = Math.min(MAX_AHEAD_FRAMES, (since - interval) / FRAME_MS);
        pose.puckX += velocity.vx * ahead;
        pose.puckY += velocity.vy * ahead;
      }
      return pose;
    },
  };
}
