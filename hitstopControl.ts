export type HitStopControlSnapshot = {
  preVx: number;
  preVy: number;
  postVx: number;
  postVy: number;
  postLen: number;
  blueDx: number;
  blueDy: number;
  baseSpinAbs: number;
  baseSpinSign: number;
  baseSpinMax: number;
};

export type HitStopControlState = {
  active: boolean;
  isAi: boolean;
  adj: number;
  adjVel: number;
  applied: boolean;
  framesLeft: number;
  framesTotal: number;
} & HitStopControlSnapshot;

export function initHitStopControlState(): HitStopControlState {
  return {
    active: false,
    isAi: false,
    adj: 0,
    adjVel: 0,
    applied: false,
    framesLeft: 0,
    framesTotal: 0,
    preVx: 0,
    preVy: 0,
    postVx: 0,
    postVy: 0,
    postLen: 0,
    blueDx: 0,
    blueDy: 0,
    baseSpinAbs: 0,
    baseSpinSign: 1,
    baseSpinMax: 0,
  };
}

export function beginHitStopControl(
  s: HitStopControlState,
  snapshot: HitStopControlSnapshot,
  framesTotal: number,
  isAi: boolean
) {
  Object.assign(s, snapshot);
  s.active = true;
  s.isAi = isAi;
  s.adj = 0;
  s.adjVel = 0;
  s.applied = false;
  s.framesTotal = framesTotal;
  s.framesLeft = framesTotal;
}

export function computeTargetAdjFromMouse(
  mouseX: number,
  mouseY: number,
  p1x: number,
  p1y: number,
  blueDx: number,
  blueDy: number,
  postLen: number
): number {
  const relX = mouseX - p1x;
  const relY = mouseY - p1y;
  const along = -(relX * blueDx + relY * blueDy);
  const perp = relX * -blueDy + relY * blueDx;
  const assist = 1 / (1 + Math.abs(perp) / 120);
  const clampedLen = Math.max(0, Math.min(postLen, along * assist));
  return postLen > 0 ? clampedLen / postLen : 0;
}

export function stepSecondOrderFollow(
  value: number,
  velocity: number,
  target: number,
  stiffness: number,
  damping: number
) {
  const accel = (target - value) * stiffness;
  const nextVel = (velocity + accel) * damping;
  const nextVal = value + nextVel;
  return { value: nextVal, velocity: nextVel };
}

export function spinCeilingFromHit(
  baseSpinAbs: number,
  blueLen: number,
  minSpeed: number,
  maxSpeed: number,
  maxSpin: number
) {
  const spinHeadroom = Math.max(0, Math.min(1, (blueLen - minSpeed) / (maxSpeed - minSpeed)));
  return baseSpinAbs + (maxSpin - baseSpinAbs) * spinHeadroom;
}

export function mapAdjToFinalSpeed(
  adj: number,
  minSpeed: number,
  postLen: number
) {
  const vMax = Math.max(minSpeed, postLen);
  const dv = Math.max(0, vMax - minSpeed);
  const k = 1 - Math.max(0, Math.min(1, adj));
  return minSpeed + dv * k;
}

export function mapAdjToSpinAbs(
  adj: number,
  baseSpinAbs: number,
  baseSpinMax: number,
  maxSpin: number
) {
  const spinCeil = Math.max(baseSpinAbs, Math.min(maxSpin, baseSpinMax));
  return baseSpinAbs + (spinCeil - baseSpinAbs) * Math.max(0, Math.min(1, adj));
}
