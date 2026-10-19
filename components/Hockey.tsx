import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { initHitStopControlState } from '../hitstopControl';
import { HockeyRef } from '../types';
import type { GameSnapshot, PlayerInput } from '../src/net/protocol';

interface HockeyProps {
  mode: 'pve' | 'pvp';
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

// --- CONSTANTS (USER TUNED) ---
const LINE_THICKNESS = 3; 
const PADDLE_RADIUS = 30;
const PUCK_RADIUS = 20;
const TABLE_WIDTH = 800;
const TABLE_HEIGHT = 450;
const GOAL_HEIGHT = 160;
const WIN_SCORE = 7; 
const GOAL_ZONE_RADIUS = 85;

// [TUNING] Velocity Accumulation Logic
const MAX_SPEED = 50; 
const MIN_SPEED = 6; 
const AI_SPEED = 20; 
const EXPLOSION_THRESHOLD = 4;
const BARRIER_STRENGTH = 6; 

// [NEW] 线性映射配置 (Linear Scaling)
const MOUSE_SPEED_REQ_FOR_MAX = 60;
const MAX_PADDLE_PHYSICS_SPEED = 25; 
const MAX_PADDLE_IMPACT = 20; 

// --- VISUAL TUNING ---
const ARROW_LEN_SCALE = 6.0; 
const INVERSION_IMPACT_THRESHOLD = 100; 

// --- HIT STOP CONFIG (TUNED) ---
const HIT_STOP_SCALE = 0.5; 
const MAX_HIT_STOP_FRAMES = 35; 
const PADDLE_HIT_COOLDOWN = 20; 

// --- PHYSICS TUNING (TUNED) ---
const VELOCITY_FRICTION = 0.998; 
const SPIN_FRICTION = 0.89;
const SPIN_TRANSFER_FACTOR = 0.012; 
const MAGNUS_POWER = 0.30;       
const MAX_SPIN = 0.7;            
const RESTITUTION = 1.15;   
const MOUSE_RESPONSIVENESS = 1.0; 
const MAX_PADDLE_SPEED = 100; 
const GOAL_SLOW_MO_FACTOR = 0.1;  
const GOAL_CELEBRATION_FRAMES = 60; 
const SPARK_GRAVITY = 0.8;        
const DEBRIS_FRICTION = 0.975;     

// Colors
const COLOR_BG = '#FFFFFF';
const COLOR_INK = '#000000';
const COLOR_BARRIER = '#AAAAAA'; 
const COLOR_VELOCITY = '#0000FF'; 
const COLOR_SPIN = '#FF0000';
const COLOR_CONFETTI = ['#FF0000', '#0000FF', '#00FF00', '#FF00FF', '#FFFF00'];

const Hockey = forwardRef<HockeyRef, HockeyProps>(({ mode, online }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onlineRef = useRef(online);
  onlineRef.current = online;

    // Feature toggle: disable hit-stop pull-back / blue<->red conversion for now.
    const ENABLE_HITSTOP_CONTROL = false;

    // AI spin planning can remain enabled even when player hit-stop control is disabled.
    const ENABLE_AI_SPIN_PLANNING = true;
  
  // Game State
  const state = useRef({
    winner: null as null | 1 | 2, 
    p1: { x: 100, y: TABLE_HEIGHT / 2, prevX: 100, prevY: TABLE_HEIGHT / 2, vx: 0, vy: 0, score: 0, recoilX: 0, recoilY: 0, hitCooldown: 0 },
    p2: { x: TABLE_WIDTH - 100, y: TABLE_HEIGHT / 2, prevX: TABLE_WIDTH - 100, prevY: TABLE_HEIGHT / 2, vx: 0, vy: 0, score: 0, recoilX: 0, recoilY: 0, hitCooldown: 0 },
    puck: { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2, vx: 0, vy: 0, spin: 0, rotation: 0 },
    
    // Logic
    consecutiveHits: 0,
    lastHitPos: { x: 0, y: 0 },
    hitStop: 0,
    hitStopMax: 0, 
    lastImpactNormal: 0, 
    isInversionHit: false, 
    barrierCooldown: 0,
    currentSpeedDisplay: 0, 
    hitIntent: initHitStopControlState(),
    
    // Goal Logic
    goalActive: false,
    goalTimer: 0,
    goalScorer: 0 as 0 | 1 | 2,
    slowMoFactor: 1.0,
    leftGoalIntegrity: true,
    rightGoalIntegrity: true,

    // Visuals
    shake: 0,
    squash: { x: 1, y: 1, angle: 0, recovery: 0.4 }, 
    shockwaves: [] as { x: number, y: number, r: number, alpha: number }[],
    particles: [] as { 
        x: number, y: number, vx: number, vy: number, 
        life: number, decay: number, 
        type: 'spark' | 'debris', 
        rotation?: number, vRot?: number, length?: number, radius?: number
    }[],
    // [NEW] Confetti now has physics properties
    confetti: [] as { x: number, y: number, vx: number, vy: number, color: string, len: number, angle: number, vAngle: number }[], 
  });

  const inputs = useRef({
    w: false, s: false, a: false, d: false,
    up: false, down: false, left: false, right: false,
    mouseX: null as number | null,
        mouseY: null as number | null,
        mouseVX: 0,
        mouseVY: 0,
        prevMouseX: null as number | null,
        prevMouseY: null as number | null,
        hitAdj: {
            active: false,
            baseX: 0,
            baseY: 0,
            pos: 0,
            vel: 0,
        }
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationFrameId: number;
    let lastTime = performance.now();
    let lastNetworkTime = -Infinity;
    let lastGuestSnapshot: GameSnapshot | undefined;

    // --- UTILS ---
    const spawnParticles = (x: number, y: number, angle: number, speed: number, type: 'spark' | 'debris' = 'spark', count: number = 5, debrisLength: number = 10) => {
      const s = state.current;
      for (let i = 0; i < count; i++) {
        const spread = type === 'debris' ? 0.2 : 0.5;
        const decay = type === 'debris' ? 0.01 + Math.random() * 0.02 : 0.05 + Math.random() * 0.05;
        const finalSpeed = type === 'debris' ? speed : speed * (0.5 + Math.random());
        const len = type === 'debris' ? debrisLength : (5 + finalSpeed * 1.5);
        // x,y 代表“喷射末端”（更像是接触点）。粒子从这个点向后拖尾。
        const px = x;
        const py = y;

        s.particles.push({
          x: px, y: py,
          vx: Math.cos(angle + (Math.random()-0.5) * spread) * finalSpeed,
          vy: Math.sin(angle + (Math.random()-0.5) * spread) * finalSpeed,
          life: 1.0, decay: decay, type: type,
          length: type === 'debris' ? debrisLength : undefined,
          rotation: type === 'debris' ? 0 : undefined, 
          vRot: type === 'debris' ? (Math.random() - 0.5) * 0.5 : undefined
        });
      }
    };

    const spawnConfetti = (winner: 1 | 2) => {
        const s = state.current;
        s.confetti = [];
        const isLeft = winner === 1;
        const xMin = isLeft ? 0 : TABLE_WIDTH / 2;
        const xMax = isLeft ? TABLE_WIDTH / 2 : TABLE_WIDTH;
        const centerX = (xMin + xMax) * 0.5;
        const centerY = TABLE_HEIGHT / 2;

        // 彩条沿获胜方半场墙体(外侧+顶/底)向内撒，覆盖整个半场
        for (let i = 0; i < 220; i++) {
            const edgeRand = Math.random();
            let x = xMin, y = 0;

            if (edgeRand < 0.45) {
                // 竖直外墙
                x = isLeft ? 0 : TABLE_WIDTH;
                y = Math.random() * TABLE_HEIGHT;
            } else if (edgeRand < 0.7) {
                // 顶边
                x = xMin + Math.random() * (xMax - xMin);
                y = 0;
            } else {
                // 底边
                x = xMin + Math.random() * (xMax - xMin);
                y = TABLE_HEIGHT;
            }

            // 目标点直接铺满整个半场；速度更“狠”，确保能深入半场
            // 目标点限制在获胜半场内部，并偏向本方深处（避免贴中线 & 越界）
            const u = Math.random();
            const bias = Math.pow(u, 0.65); // 偏向更“深”的区域
            const targetX = isLeft
                ? xMin + bias * (xMax - xMin)
                : xMax - bias * (xMax - xMin);
            const targetY = Math.random() * TABLE_HEIGHT;
            let dirX = targetX - x;
            const dirY = targetY - y;
            const len = Math.hypot(dirX, dirY) || 1;
            const towardCenter = 0.7 + Math.random() * 0.8;
            const baseSpeed = (48 + Math.random() * 34) * towardCenter;
            // 再次确保水平速度朝半场内部（尤其右侧胜利时）
            if (!isLeft) dirX = -Math.abs(dirX);
            else dirX = Math.abs(dirX);
            const inwardVx = (dirX / len) * baseSpeed;
            const inwardVy = (dirY / len) * baseSpeed;
            const jitter = (Math.random() - 0.5) * 2.0;

            s.confetti.push({
                x,
                y,
                vx: inwardVx + jitter,
                vy: inwardVy + jitter,
                angle: Math.random() * Math.PI * 2,
                vAngle: (Math.random() - 0.5) * 0.12,
                color: COLOR_CONFETTI[Math.floor(Math.random() * COLOR_CONFETTI.length)],
                len: 10 + Math.random() * 20
            });
        }
    };

    const triggerGoalEffect = (side: 'left' | 'right', x: number, impactY: number, impactVelocity: number) => {
        const s = state.current;
        s.shake = 25; 
        if (side === 'left') s.leftGoalIntegrity = false;
        else s.rightGoalIntegrity = false;
        
        const startY = TABLE_HEIGHT / 2 - GOAL_HEIGHT / 2;
        const steps = 6;
        const segmentHeight = GOAL_HEIGHT / steps;
        for (let i = 0; i < steps; i++) {
            const py = startY + segmentHeight * i + segmentHeight/2;
            const px = x;
            const dist = Math.abs(py - impactY);
            const force = Math.max(5, impactVelocity * (1 - dist / GOAL_HEIGHT)); 
            const verticalForce = (py - impactY) * 0.05;
            const angle = Math.atan2(verticalForce, side === 'left' ? -1 : 1);
            s.particles.push({
                x: px, y: py,
                vx: Math.cos(angle) * force + (side === 'left' ? -2 : 2),
                vy: Math.sin(angle) * force,
                life: 1.0, decay: 0.01 + Math.random() * 0.01, type: 'debris',
                length: segmentHeight * 0.9, rotation: 0, 
                vRot: (Math.random() - 0.5) * 0.5 + verticalForce * 0.05 
            });
        }
    };

    const triggerImpact = (x: number, y: number, normalAngle: number, force: number = 1, allowSquash: boolean = false) => {
      const s = state.current;
      const intensity = force; 
      if (allowSquash) { 
          s.hitStop = Math.max(4, Math.min(MAX_HIT_STOP_FRAMES, intensity * HIT_STOP_SCALE));
          s.hitStopMax = s.hitStop;
          s.lastImpactNormal = normalAngle;
          s.isInversionHit = intensity > INVERSION_IMPACT_THRESHOLD;
          
          const squashFactor = Math.min(0.6, intensity * 0.025); 
          s.squash.angle = normalAngle;
          s.squash.x = 1 - squashFactor; 
          s.squash.y = 1 + squashFactor; 
          s.squash.recovery = 0.25; 
      }
      
      s.shake = Math.min(20, 3 + intensity);
      s.shockwaves.push({ x, y, r: PUCK_RADIUS, alpha: 1.0 });
      spawnParticles(x, y, normalAngle, 3 + intensity * 0.5, 'spark', 5);
    };

    const resetPuck = (scorer: 1 | 2 | null) => {
      const s = state.current;
      
      // Check for win condition
      if (scorer !== null) {
          if (scorer === 1 && s.p1.score >= WIN_SCORE) { s.winner = 1; spawnConfetti(1); return; }
          if (scorer === 2 && s.p2.score >= WIN_SCORE) { s.winner = 2; spawnConfetti(2); return; }
      }

      s.puck.x = TABLE_WIDTH / 2;
      s.puck.y = TABLE_HEIGHT / 2;
      s.puck.spin = 0;
      s.puck.rotation = 0;
      s.consecutiveHits = 0;
      s.goalActive = false;
      s.goalTimer = 0;
      s.slowMoFactor = 1.0;
      s.leftGoalIntegrity = true;
      s.rightGoalIntegrity = true;
      s.barrierCooldown = 0;
      s.hitStop = 0; 
      s.isInversionHit = false;
      s.squash.x = 1; s.squash.y = 1;

      const dir = scorer === 1 ? -1 : (scorer === 2 ? 1 : (Math.random() > 0.5 ? 1 : -1));
      s.puck.vx = dir * 6;
      s.puck.vy = (Math.random() - 0.5) * 4;

      s.particles = [];
      s.shockwaves = [];
      s.p1.hitCooldown = 0;
      s.p2.hitCooldown = 0;
    };

    const drawWrappedArrow = (
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        vx: number,
        vy: number,
        color: string,
        progress: number
    ) => {
        const speed = Math.sqrt(vx*vx + vy*vy);
        if (speed < 0.1) return;
        const len = speed * ARROW_LEN_SCALE * Math.max(0, Math.min(1, progress));
        const dx = vx / speed; const dy = vy / speed;
        ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath();
        let cx = x; let cy = y; let remainingLen = len; let segments = 0;
        while (remainingLen > 0 && segments < 3) {
            let tMin = remainingLen; let hitWall = false; let wallType = '';
            if (dx > 0) { const t = (TABLE_WIDTH - cx) / dx; if (t >= 0 && t < tMin) { tMin = t; hitWall = true; wallType = 'r'; } }
            if (dx < 0) { const t = (0 - cx) / dx; if (t >= 0 && t < tMin) { tMin = t; hitWall = true; wallType = 'l'; } }
            if (dy > 0) { const t = (TABLE_HEIGHT - cy) / dy; if (t >= 0 && t < tMin) { tMin = t; hitWall = true; wallType = 'b'; } }
            if (dy < 0) { const t = (0 - cy) / dy; if (t >= 0 && t < tMin) { tMin = t; hitWall = true; wallType = 't'; } }
            const ex = cx + dx * tMin; const ey = cy + dy * tMin;
            ctx.moveTo(cx, cy); ctx.lineTo(ex, ey);
            remainingLen -= tMin;
            if (hitWall && remainingLen > 0) {
                if (wallType === 'r') cx = 0; else if (wallType === 'l') cx = TABLE_WIDTH; else if (wallType === 'b') cy = 0; else if (wallType === 't') cy = TABLE_HEIGHT;
                if (wallType === 'l' || wallType === 'r') cy = ey; if (wallType === 't' || wallType === 'b') cx = ex;
                cx += dx * 0.1; cy += dy * 0.1;
            } else {
                const angle = Math.atan2(dy, dx); const headLen = 15;
                ctx.lineTo(ex - Math.cos(angle - Math.PI/6) * headLen, ey - Math.sin(angle - Math.PI/6) * headLen);
                ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(angle + Math.PI/6) * headLen, ey - Math.sin(angle + Math.PI/6) * headLen);
                break;
            }
            segments++;
        }
        ctx.stroke();
    };

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

    resetPuck(null);

    // --- MAIN LOOP ---
    const loop = (time: number) => {
      const online = onlineRef.current;
      const rawDt = (time - lastTime) / 16.666; 
      lastTime = time;
      
            const s = state.current;
      const dt = Math.min(rawDt, 4.0) * s.slowMoFactor;
      const inp = inputs.current;
      const remoteInput = online?.enabled && online.role === 'host' ? online.readRemoteInput() : null;

      if (online?.enabled && online.role === 'guest' && online.ready && time - lastNetworkTime >= 50) {
          lastNetworkTime = time;
          online.onInput({
              t: time,
              keys: { w: inp.w || inp.up, a: inp.a || inp.left, s: inp.s || inp.down, d: inp.d || inp.right },
              mouse: {
                  x: inp.mouseX === null ? null : Math.max(0, Math.min(TABLE_WIDTH, inp.mouseX)),
                  y: inp.mouseY === null ? null : Math.max(0, Math.min(TABLE_HEIGHT, inp.mouseY)),
              },
          });
      }

            // Online guest: apply authoritative snapshot and skip all gameplay simulation.
            if (online?.enabled && online.role === 'guest' && online.snapshot) {
                const snap = online.snapshot;
                s.winner = snap.winner;
                s.p1.x = snap.p1.x; s.p1.y = snap.p1.y; s.p1.score = snap.p1.score;
                s.p2.x = snap.p2.x; s.p2.y = snap.p2.y; s.p2.score = snap.p2.score;
                s.puck.x = snap.puck.x; s.puck.y = snap.puck.y;
                s.puck.vx = snap.puck.vx; s.puck.vy = snap.puck.vy;
                s.puck.spin = snap.puck.spin; s.puck.rotation = snap.puck.rotation;
                s.leftGoalIntegrity = snap.leftGoalIntegrity;
                s.rightGoalIntegrity = snap.rightGoalIntegrity;
                if (lastGuestSnapshot !== snap) {
                    if (snap.winner && lastGuestSnapshot?.winner !== snap.winner) spawnConfetti(snap.winner);
                    if (!snap.winner) s.confetti = [];
                    Object.assign(s, {
                        ...snap.effects,
                        squash: { ...snap.effects.squash },
                        shockwaves: snap.effects.shockwaves.map((wave) => ({ ...wave })),
                        particles: snap.effects.particles.map((particle) => ({ ...particle })),
                    });
                    lastGuestSnapshot = snap;
                }
            }

            // Online host: apply remote input to player2 controls in PVP.
            if (online?.enabled && online.role === 'host' && mode === 'pvp') {
                inp.up = remoteInput?.keys.w ?? false;
                inp.down = remoteInput?.keys.s ?? false;
                inp.left = remoteInput?.keys.a ?? false;
                inp.right = remoteInput?.keys.d ?? false;
            }

    // 计算输入速度（冻结帧也有效：实体不动，但意图仍可捕捉）
      if (inp.mouseX !== null && inp.mouseY !== null) {
          if (inp.prevMouseX !== null && inp.prevMouseY !== null) {
              const inv = 1 / (dt || 1);
              inp.mouseVX = (inp.mouseX - inp.prevMouseX) * inv;
              inp.mouseVY = (inp.mouseY - inp.prevMouseY) * inv;
          }
          inp.prevMouseX = inp.mouseX;
          inp.prevMouseY = inp.mouseY;
      } else {
          inp.mouseVX = 0;
          inp.mouseVY = 0;
          inp.prevMouseX = null;
          inp.prevMouseY = null;
      }

      // 冻结帧期间：改用“位移(距离)”而不是速度来调节卸力
    if (ENABLE_HITSTOP_CONTROL && s.hitStop > 0 && s.hitIntent.active && !s.hitIntent.isAi) {
          if (!inp.hitAdj.active && inp.mouseX !== null && inp.mouseY !== null) {
              inp.hitAdj.active = true;
              inp.hitAdj.baseX = inp.mouseX;
              inp.hitAdj.baseY = inp.mouseY;
              inp.hitAdj.pos = 0;
              inp.hitAdj.vel = 0;
          }
      } else {
          inp.hitAdj.active = false;
      }
      
      const parent = canvas.parentElement;
      if (parent) {
          const { width, height } = parent.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
              canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(1, 0, 0, 1, 0, 0);
          }
      }

      // If game over, just draw confetti and paddle movement, no physics update for puck
      if (s.winner !== null) {
          // Update confetti physics
          for (let i = 0; i < s.confetti.length; i++) {
              const c = s.confetti[i];
              c.x += c.vx * dt;
              c.y += c.vy * dt;

              // 无重力，靠阻力和缓动慢慢停下
              // 前段铺开，后段快速停住（不让飞得太远越过半场）
              const speedNow = Math.hypot(c.vx, c.vy);
              const drag = speedNow > 8 ? 0.975 : 0.90;
              c.vx *= drag;
              c.vy *= drag;
              if (Math.abs(c.vx) < 0.02) c.vx = 0;
              if (Math.abs(c.vy) < 0.02) c.vy = 0;

              // 旋转阻尼直至停止
              c.angle += c.vAngle * dt;
              c.vAngle *= 0.9;
              if (Math.abs(c.vAngle) < 0.01) c.vAngle = 0;

              // 边界内收，确保留在场地平面上
              if (c.x < 0) { c.x = 0; if (c.vx < 0) c.vx = 0; }
              if (c.x > TABLE_WIDTH) { c.x = TABLE_WIDTH; if (c.vx > 0) c.vx = 0; }
              if (c.y < 0) { c.y = 0; if (c.vy < 0) c.vy = 0; }
              if (c.y > TABLE_HEIGHT) { c.y = TABLE_HEIGHT; if (c.vy > 0) c.vy = 0; }
          }

          if (!(online?.enabled && online.role === 'guest')) {
          // Allow paddle movement for fun
          // Player 1
          let moveX = 0; let moveY = 0;
          if (inp.w) moveY -= 1; if (inp.s) moveY += 1; if (inp.a) moveX -= 1; if (inp.d) moveX += 1;
          if (inp.mouseX !== null && moveX === 0 && moveY === 0) {
              const targetX = inp.mouseX; const targetY = inp.mouseY;
              let dx = (targetX - s.p1.x) * MOUSE_RESPONSIVENESS; let dy = (targetY - s.p1.y) * MOUSE_RESPONSIVENESS;
              const dist = Math.sqrt(dx*dx + dy*dy);
              if (dist > MAX_PADDLE_SPEED) { const ratio = MAX_PADDLE_SPEED / dist; dx *= ratio; dy *= ratio; }
              s.p1.x += dx * dt; s.p1.y += dy * dt;
          } else { const speed = 10; s.p1.x += moveX * speed * dt; s.p1.y += moveY * speed * dt; }
          // Player 2
          if (mode === 'pvp') {
              let p2X = 0; let p2Y = 0;
              if (inp.up) p2Y -= 1; if (inp.down) p2Y += 1; if (inp.left) p2X -= 1; if (inp.right) p2X += 1;
              s.p2.x += p2X * 10 * dt; s.p2.y += p2Y * 10 * dt;
          }
          // Clamping
          s.p1.x = Math.max(PADDLE_RADIUS, Math.min(TABLE_WIDTH/2 - PADDLE_RADIUS, s.p1.x));
          s.p1.y = Math.max(PADDLE_RADIUS, Math.min(TABLE_HEIGHT - PADDLE_RADIUS, s.p1.y));
          s.p2.x = Math.max(TABLE_WIDTH/2 + PADDLE_RADIUS, Math.min(TABLE_WIDTH - PADDLE_RADIUS, s.p2.x));
          s.p2.y = Math.max(PADDLE_RADIUS, Math.min(TABLE_HEIGHT - PADDLE_RADIUS, s.p2.y));
          }
      }

    if (s.winner === null && (!online?.enabled || (online.role === 'host' && online.ready))) {
        // --- LOGIC ---
        s.p1.recoilX *= (0.85 * dt + (1-dt)); s.p1.recoilY *= (0.85 * dt + (1-dt));
        s.p2.recoilX *= (0.85 * dt + (1-dt)); s.p2.recoilY *= (0.85 * dt + (1-dt));

        if (s.goalActive) s.hitStop = 0;
            if (s.hitStop > 0) s.hitStop -= 1 * dt;
            if (ENABLE_HITSTOP_CONTROL && s.hitIntent.framesLeft > 0) s.hitIntent.framesLeft -= 1 * dt;
            // hitStop 结束后隐藏调节显示
            // Hide arrows immediately when hitStop ends.
            if (s.hitStop <= 0.01) s.hitIntent.active = false;
        
        if (s.hitStop <= 0) {
            if (s.p1.hitCooldown > 0) s.p1.hitCooldown -= 1 * dt;
            if (s.p2.hitCooldown > 0) s.p2.hitCooldown -= 1 * dt;
            if (s.barrierCooldown > 0) s.barrierCooldown -= 1 * dt;

            // Player 1
            let moveX = 0; let moveY = 0;
            if (inp.w) moveY -= 1; if (inp.s) moveY += 1; if (inp.a) moveX -= 1; if (inp.d) moveX += 1;

            if (inp.mouseX !== null && moveX === 0 && moveY === 0) {
                const targetX = inp.mouseX; const targetY = inp.mouseY;
                let dx = (targetX - s.p1.x) * MOUSE_RESPONSIVENESS;
                let dy = (targetY - s.p1.y) * MOUSE_RESPONSIVENESS;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist > MAX_PADDLE_SPEED) { const ratio = MAX_PADDLE_SPEED / dist; dx *= ratio; dy *= ratio; }
                s.p1.x += dx * dt; s.p1.y += dy * dt;
            } else {
                const speed = 10; s.p1.x += moveX * speed * dt; s.p1.y += moveY * speed * dt;
            }
            
            s.p1.x += s.p1.recoilX * dt; s.p1.y += s.p1.recoilY * dt;
            s.p1.x = Math.max(PADDLE_RADIUS, Math.min(TABLE_WIDTH/2 - PADDLE_RADIUS, s.p1.x));
            s.p1.y = Math.max(PADDLE_RADIUS, Math.min(TABLE_HEIGHT - PADDLE_RADIUS, s.p1.y));

            // Anti-camping: forbid entering the goal semicircle (left side)
            {
                const gx = 0;
                const gy = TABLE_HEIGHT / 2;
                const dx = s.p1.x - gx;
                const dy = s.p1.y - gy;
                const dist = Math.hypot(dx, dy) || 1;
                const minDist = GOAL_ZONE_RADIUS + PADDLE_RADIUS;
                if (s.p1.x < gx + minDist && dist < minDist) {
                    s.p1.x = gx + (dx / dist) * minDist;
                    s.p1.y = gy + (dy / dist) * minDist;
                }
            }
            s.p1.vx = (s.p1.x - s.p1.prevX) / (dt || 1); s.p1.vy = (s.p1.y - s.p1.prevY) / (dt || 1);

            // Player 2
            if (mode === 'pvp') {
                let p2X = 0; let p2Y = 0;
                if (inp.up) p2Y -= 1; if (inp.down) p2Y += 1; if (inp.left) p2X -= 1; if (inp.right) p2X += 1;
                if (remoteInput?.mouse.x !== null && remoteInput?.mouse.y !== null && remoteInput && p2X === 0 && p2Y === 0) {
                    let dx = remoteInput.mouse.x - s.p2.x;
                    let dy = remoteInput.mouse.y - s.p2.y;
                    const distance = Math.hypot(dx, dy);
                    if (distance > MAX_PADDLE_SPEED) { dx *= MAX_PADDLE_SPEED / distance; dy *= MAX_PADDLE_SPEED / distance; }
                    s.p2.x += dx * dt;
                    s.p2.y += dy * dt;
                } else {
                    s.p2.x += p2X * 10 * dt; s.p2.y += p2Y * 10 * dt;
                }
            } else {
                // --- AGGRESSIVE AI LOGIC ---
                const puck = s.puck;
                let targetY = puck.y;
                let targetX = TABLE_WIDTH - 60; // Base Position
                
                const isIncoming = puck.vx > 0;
                const inAiTerritory = puck.x > TABLE_WIDTH * 0.45;
                const isStalled = Math.abs(puck.vx) < 5; 
                
                if (inAiTerritory && (isIncoming || isStalled)) {
                    const attackOffsetX = 25;
                    const desiredX = puck.x - attackOffsetX;
                    targetX = Math.min(TABLE_WIDTH - PADDLE_RADIUS, desiredX);
                    const timeToIntercept = Math.abs(s.p2.x - puck.x) / (Math.abs(puck.vx) + 1);
                    targetY = puck.y + puck.vy * timeToIntercept * 0.5; 
                    targetY = Math.max(0, Math.min(TABLE_HEIGHT, targetY));
                } else {
                    targetY = TABLE_HEIGHT / 2 + (puck.y - TABLE_HEIGHT/2) * 0.4;
                }

                const dx = targetX - s.p2.x;
                const dy = targetY - s.p2.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                const shouldSprint = (inAiTerritory && (isIncoming || isStalled));
                const currentAiSpeed = shouldSprint ? AI_SPEED * 1.5 : AI_SPEED;
                
                if (dist > 1) {
                    const moveDist = Math.min(dist, currentAiSpeed * dt);
                    s.p2.x += (dx / dist) * moveDist;
                    s.p2.y += (dy / dist) * moveDist;
                }
            }
            
            s.p2.x += s.p2.recoilX * dt; s.p2.y += s.p2.recoilY * dt;
            s.p2.x = Math.max(TABLE_WIDTH/2 + PADDLE_RADIUS, Math.min(TABLE_WIDTH - PADDLE_RADIUS, s.p2.x));
            s.p2.y = Math.max(PADDLE_RADIUS, Math.min(TABLE_HEIGHT - PADDLE_RADIUS, s.p2.y));

            // Anti-camping: forbid entering the goal semicircle (right side)
            {
                const gx = TABLE_WIDTH;
                const gy = TABLE_HEIGHT / 2;
                const dx = s.p2.x - gx;
                const dy = s.p2.y - gy;
                const dist = Math.hypot(dx, dy) || 1;
                const minDist = GOAL_ZONE_RADIUS + PADDLE_RADIUS;
                if (s.p2.x > gx - minDist && dist < minDist) {
                    s.p2.x = gx + (dx / dist) * minDist;
                    s.p2.y = gy + (dy / dist) * minDist;
                }
            }
            s.p2.vx = (s.p2.x - s.p2.prevX) / (dt || 1); s.p2.vy = (s.p2.y - s.p2.prevY) / (dt || 1);

            // Physics Substepping
            const puckSpeed = Math.sqrt(s.puck.vx**2 + s.puck.vy**2);
            const p1Speed = Math.sqrt(s.p1.vx**2 + s.p1.vy**2);
            const p2Speed = Math.sqrt(s.p2.vx**2 + s.p2.vy**2);
            const maxEntitySpeed = puckSpeed + Math.max(p1Speed, p2Speed) + 10;
            // High precision CCD: use smaller substeps to reduce tunneling at extreme speeds.
            // 0.5 px target is more robust than 1 px while still being cheap for this game.
            const steps = Math.max(1, Math.ceil((maxEntitySpeed * dt) / 0.5));

            for(let step = 0; step < steps; step++) {
                let barrierBrokeThisStep = false;
                const stepVx = (s.puck.vx * dt) / steps;
                const stepVy = (s.puck.vy * dt) / steps;
                const spinEffect = (s.puck.spin * dt) / steps;

                if (Math.abs(s.puck.spin) > 0.01) {
                    const magnusScale = (dt / steps) * MAGNUS_POWER;
                    const vx0 = s.puck.vx;
                    const vy0 = s.puck.vy;
                    // Use the pre-update velocity for both components to avoid artificial energy loss/lock-in.
                    s.puck.vx = vx0 - s.puck.spin * vy0 * magnusScale;
                    s.puck.vy = vy0 + s.puck.spin * vx0 * magnusScale;
                }

                const stepStartPuckX = s.puck.x;
                const stepStartPuckY = s.puck.y;
                s.puck.x += stepVx; s.puck.y += stepVy; s.puck.rotation += spinEffect;

                if (!s.goalActive) {
                    if (s.puck.x < -PUCK_RADIUS && !s.leftGoalIntegrity) { s.goalActive = true; s.goalScorer = 2; s.slowMoFactor = GOAL_SLOW_MO_FACTOR; s.goalTimer = GOAL_CELEBRATION_FRAMES; } 
                    else if (s.puck.x > TABLE_WIDTH + PUCK_RADIUS && !s.rightGoalIntegrity) { s.goalActive = true; s.goalScorer = 1; s.slowMoFactor = GOAL_SLOW_MO_FACTOR; s.goalTimer = GOAL_CELEBRATION_FRAMES; }
                }

                if (!s.goalActive) {
                    const insideTableHorizontally = s.puck.x > 0 && s.puck.x < TABLE_WIDTH;
                    if (insideTableHorizontally && s.puck.y < PUCK_RADIUS) { s.puck.y = PUCK_RADIUS; if (s.puck.vy < 0) { s.puck.vy *= -0.9; triggerImpact(s.puck.x, 0, Math.PI/2, Math.abs(s.puck.vy), false); } }
                    if (insideTableHorizontally && s.puck.y > TABLE_HEIGHT - PUCK_RADIUS) { s.puck.y = TABLE_HEIGHT - PUCK_RADIUS; if (s.puck.vy > 0) { s.puck.vy *= -0.9; triggerImpact(s.puck.x, TABLE_HEIGHT, -Math.PI/2, Math.abs(s.puck.vy), false); } }

                    const generousGoalMargin = GOAL_HEIGHT / 2 + 20; 
                    const goalCenterY = TABLE_HEIGHT / 2;
                    const inGenerousGoalZone = Math.abs(s.puck.y - goalCenterY) < generousGoalMargin;

                    if (s.puck.x < PUCK_RADIUS) { if (!s.leftGoalIntegrity && inGenerousGoalZone) {} else { s.puck.x = PUCK_RADIUS; if (s.puck.vx < 0) { s.puck.vx *= -0.9; triggerImpact(0, s.puck.y, 0, Math.abs(s.puck.vx), false); } } }
                    if (s.puck.x > TABLE_WIDTH - PUCK_RADIUS) { if (!s.rightGoalIntegrity && inGenerousGoalZone) {} else { s.puck.x = TABLE_WIDTH - PUCK_RADIUS; if (s.puck.vx > 0) { s.puck.vx *= -0.9; triggerImpact(TABLE_WIDTH, s.puck.y, Math.PI, Math.abs(s.puck.vx), false); } } }
                }

                const checkBarrier = (side: 'left' | 'right') => {
                    if (s.barrierCooldown > 0) return;
                    const bx = side === 'left' ? 0 : TABLE_WIDTH;
                    const active = side === 'left' ? s.leftGoalIntegrity : s.rightGoalIntegrity;
                    const goalTop = TABLE_HEIGHT / 2 - GOAL_HEIGHT / 2;
                    const goalBot = TABLE_HEIGHT / 2 + GOAL_HEIGHT / 2;
                    if (!active) return;
                    if (s.puck.y > goalTop && s.puck.y < goalBot) {
                        const edgeMargin = PUCK_RADIUS * 1.2;
                        if (Math.abs(s.puck.y - goalTop) < edgeMargin || Math.abs(s.puck.y - goalBot) < edgeMargin) {
                            if (Math.abs(s.puck.x - bx) < PUCK_RADIUS + 5) {
                                s.puck.x = bx + (side === 'left' ? PUCK_RADIUS + 2 : -PUCK_RADIUS - 2); s.puck.vx *= -0.8;
                                triggerImpact(s.puck.x, s.puck.y, side === 'left' ? 0 : Math.PI, Math.abs(s.puck.vx), false); s.barrierCooldown = 10; return;
                            }
                        }
                        if (Math.abs(s.puck.x - bx) < PUCK_RADIUS + 5) {
                            const movingTowards = side === 'left' ? s.puck.vx < 0 : s.puck.vx > 0;
                            const normalForce = Math.abs(s.puck.vx); 
                            if (movingTowards && normalForce >= BARRIER_STRENGTH) { triggerGoalEffect(side, bx, s.puck.y, normalForce); barrierBrokeThisStep = true; } 
                            else { s.puck.x = bx + (side === 'left' ? PUCK_RADIUS + 2 : -PUCK_RADIUS - 2); s.puck.vx *= -0.8; triggerImpact(s.puck.x, s.puck.y, side === 'left' ? 0 : Math.PI, Math.abs(s.puck.vx), false); }
                            s.barrierCooldown = 10;
                        }
                    }
                };
                if (!s.goalActive) { checkBarrier('left'); checkBarrier('right'); }

                const checkCorner = (cx: number, cy: number) => {
                    const dx = s.puck.x - cx; const dy = s.puck.y - cy; const dist = Math.sqrt(dx*dx + dy*dy);
                    if (dist < PUCK_RADIUS) {
                        const nx = dx / dist; const ny = dy / dist;
                        s.puck.x = cx + nx * PUCK_RADIUS; s.puck.y = cy + ny * PUCK_RADIUS;
                        const vDot = s.puck.vx * nx + s.puck.vy * ny;
                        s.puck.vx -= 2 * vDot * nx; s.puck.vy -= 2 * vDot * ny;
                        triggerImpact(s.puck.x, s.puck.y, Math.atan2(ny, nx), 5, false);
                    }
                }
                if (!barrierBrokeThisStep) {
                    const goalTop = TABLE_HEIGHT / 2 - GOAL_HEIGHT / 2;
                    const goalBot = TABLE_HEIGHT / 2 + GOAL_HEIGHT / 2;
                    checkCorner(0, goalTop); checkCorner(0, goalBot); checkCorner(TABLE_WIDTH, goalTop); checkCorner(TABLE_WIDTH, goalBot);
                }

                if (!s.goalActive) {
                    if (s.puck.x < -100) { s.p2.score++; resetPuck(2); break; }
                    if (s.puck.x > TABLE_WIDTH + 100) { s.p1.score++; resetPuck(1); break; }
                }

                const t = (step + 1) / steps;
                let hitPaddle = false;
                [s.p1, s.p2].forEach(p => {
                    if (hitPaddle || p.hitCooldown > 0) return;
                    const pX = p.prevX + (p.x - p.prevX) * t;
                    const pY = p.prevY + (p.y - p.prevY) * t;

                    const minDist = PADDLE_RADIUS + PUCK_RADIUS;
                    const minDistSq = minDist * minDist;
                    const segX = s.puck.x - stepStartPuckX; const segY = s.puck.y - stepStartPuckY;
                    const segLenSq = segX*segX + segY*segY;
                    const pVecX = pX - stepStartPuckX; const pVecY = pY - stepStartPuckY;

                    let t_proj = 0;
                    if (segLenSq > 0.000001) { t_proj = (pVecX * segX + pVecY * segY) / segLenSq; t_proj = Math.max(0, Math.min(1, t_proj)); }
                    const closestX = stepStartPuckX + segX * t_proj; const closestY = stepStartPuckY + segY * t_proj;
                    const dx = closestX - pX; const dy = closestY - pY; const distSq = dx*dx + dy*dy;

                    if (distSq < minDistSq) {
                        hitPaddle = true;
                        p.hitCooldown = PADDLE_HIT_COOLDOWN;

                        const preHitVx = s.puck.vx;
                        const preHitVy = s.puck.vy;
                        const dist = Math.sqrt(distSq);
                        const nx = dx / (dist || 1); const ny = dy / (dist || 1);
                        s.puck.x = pX + nx * minDist; s.puck.y = pY + ny * minDist;

                        // 轻触：玩家几乎不动/动作幅度很小时，取消这一击的冻结帧与旋转（避免无意义的停顿与乱转）
                        const pSpeedRaw = Math.hypot(p.vx, p.vy);
                        const pMoveRaw = Math.hypot(p.x - p.prevX, p.y - p.prevY);
                        const isSoftTouch = p === s.p1 && pSpeedRaw < 2.0 && pMoveRaw < 1.5;

                        const distFromLastHit = Math.hypot(s.puck.x - s.lastHitPos.x, s.puck.y - s.lastHitPos.y);
                        if (distFromLastHit < 100) s.consecutiveHits++; else s.consecutiveHits = 1;
                        s.lastHitPos = {x: s.puck.x, y: s.puck.y};

                        if (s.consecutiveHits >= EXPLOSION_THRESHOLD) {
                            const angle = Math.random() * Math.PI * 2;
                            s.puck.vx = Math.cos(angle) * 50; s.puck.vy = Math.sin(angle) * 50;
                            p.recoilX = -Math.cos(angle) * 80; p.recoilY = -Math.sin(angle) * 80;
                            triggerImpact(s.puck.x, s.puck.y, angle, 30, true); s.consecutiveHits = 0; return;
                        }

                        let pVx = p.vx; let pVy = p.vy;
                        const pSpeed = Math.sqrt(pVx*pVx + pVy*pVy);
                        
                        // Apply Linear Mapping to Paddle Speed for physics calculation
                        const inputIntensity = Math.min(1.0, pSpeed / MOUSE_SPEED_REQ_FOR_MAX);
                        const allowedSpeed = inputIntensity * MAX_PADDLE_PHYSICS_SPEED;
                        if (pSpeed > 0.1) {
                            const scale = allowedSpeed / pSpeed;
                            pVx *= scale; pVy *= scale;
                        }
                        
                        const relVx = s.puck.vx - pVx; const relVy = s.puck.vy - pVy;
                        const velNormal = relVx * nx + relVy * ny; // This determines impact strength naturally
                        const tx = -ny; const ty = nx;
                        const velTangent = relVx * tx + relVy * ty;
                        
                        if (!isSoftTouch) {
                            s.puck.spin += velTangent * SPIN_TRANSFER_FACTOR;
                            s.puck.spin = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, s.puck.spin));
                        }

                        if (velNormal < 0) {
                            // [NEW] NATURAL DAMPENING LOGIC
                            // We use pure impulse physics. If velNormal is small (because paddle is retreating),
                            // the resulting impulse J will be small, naturally dampening the ball.
                            const j = -(1 + RESTITUTION) * velNormal;
                            s.puck.vx += j * nx; s.puck.vy += j * ny;
                            
                            // [NEW] DIRECTIONAL POWER BOOST
                            // Only add the "Magical Game Feel Force" if the paddle is actually moving TOWARDS the ball.
                            // This allows players to "Cushion" the ball by pulling back (no extra force added).
                            const paddleNormalVel = pVx * nx + pVy * ny; // Project paddle velocity onto collision normal
                            
                            if (paddleNormalVel > 0) {
                                // Hitting INTO the ball -> Add Juice
                                const impactForce = inputIntensity * MAX_PADDLE_IMPACT;
                                s.puck.vx += nx * impactForce;
                                s.puck.vy += ny * impactForce;
                            }

                            const projectedNormalVel = s.puck.vx * nx + s.puck.vy * ny;
                            // 只有“主动击打”(paddleNormalVel>0) 才启用法向最低速度保底；回拉接球允许真实卸力。
                            // 这条保底会让球在某些情况下被额外加速（即使你之后把蓝回拉到 0）。
                            // 让它跟随 MIN_SPEED，避免“停球到 MIN_SPEED”时仍被这条逻辑顶高。
                            if (paddleNormalVel > 0 && projectedNormalVel < MIN_SPEED) {
                                const boost = MIN_SPEED - projectedNormalVel;
                                s.puck.vx += nx * boost;
                                s.puck.vy += ny * boost;
                            }

                            // 冻结帧内的“回拉/推回”意图捕捉：允许在前 5 帧内调节卸力量
                            if (ENABLE_HITSTOP_CONTROL && (p === s.p1 || (mode === 'pve' && p === s.p2))) {
                                const blueVx = s.puck.vx;
                                const blueVy = s.puck.vy;
                                const blueLen = Math.hypot(blueVx, blueVy);
                                const invBlueLen = 1 / (blueLen || 1);
                                s.hitIntent.active = true;
                                s.hitIntent.preVx = preHitVx;
                                s.hitIntent.preVy = preHitVy;
                                s.hitIntent.blueDx = blueVx * invBlueLen;
                                s.hitIntent.blueDy = blueVy * invBlueLen;
                                s.hitIntent.postVx = blueVx;
                                s.hitIntent.postVy = blueVy;
                                s.hitIntent.postLen = blueLen;
                                s.hitIntent.adj = 0;
                                s.hitIntent.adjVel = 0;
                                s.hitIntent.baseSpinAbs = Math.abs(s.puck.spin);
                                s.hitIntent.baseSpinSign = Math.sign(s.puck.spin) || 1;
                                // Per-hit spin ceiling: stronger hits can reach closer to MAX_SPIN.
                                // Weak hits should not be able to max out red even at full conversion.
                                const spinHeadroom = Math.max(0, Math.min(1, (blueLen - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)));
                                s.hitIntent.baseSpinMax = s.hitIntent.baseSpinAbs + (MAX_SPIN - s.hitIntent.baseSpinAbs) * spinHeadroom;
                                s.hitIntent.framesTotal = 30;
                                s.hitIntent.framesLeft = 30;
                                s.hitIntent.applied = false;
                                s.hitIntent.active = true;
                                s.hitIntent.isAi = (p === s.p2);
                            }

                            // AI spin planning (no hit-stop UI): adjust spin immediately after contact
                            // to steer the puck away from its own goal and toward the player side.
                            if (ENABLE_AI_SPIN_PLANNING && mode === 'pve' && p === s.p2) {
                                // Candidate spins within the physically reachable range for THIS hit.
                                // We should never plan a red value that the contact couldn't have produced.
                                const baseSpin = s.puck.spin;
                                const prevSpin = baseSpin;
                                const plannedSpinCap = Math.max(Math.abs(prevSpin), Math.min(MAX_SPIN, Math.abs(prevSpin) + Math.abs(velTangent) * SPIN_TRANSFER_FACTOR));
                                const candMax = Math.max(0, plannedSpinCap);
                                const coarse = [-candMax, -candMax * 0.6, 0, candMax * 0.6, candMax];

                                const targetX = 0; // shoot toward player goal (left)
                                const goalTop = TABLE_HEIGHT / 2 - GOAL_HEIGHT / 2;
                                const goalBot = TABLE_HEIGHT / 2 + GOAL_HEIGHT / 2;

                                const predict = (vx0: number, vy0: number, spin0: number) => {
                                    let x = s.puck.x;
                                    let y = s.puck.y;
                                    let vx = vx0;
                                    let vy = vy0;
                                    let spin = spin0;
                                    const dtSim = 0.12;
                                    let crossedLeft = false;
                                    let yAtLeft = y;
                                    let reachedRight = false;
                                    let bounces = 0;
                                    // Adaptive budget: if we're already moving toward the player goal, a shorter horizon is enough.
                                    // If we're drifting rightward, allow a longer horizon to find aggressive bend/back shots.
                                    const maxIter = (vx0 < -8) ? 520 : 920;
                                    for (let i = 0; i < maxIter; i++) {
                                        // Approximate the same damping as the main sim.
                                        // (We don't need full fidelity, just enough so AI doesn't over-trust spin.)
                                        spin *= Math.pow(SPIN_FRICTION, dtSim);
                                        const frictionScalar = Math.pow(VELOCITY_FRICTION, dtSim);
                                        vx *= frictionScalar;
                                        vy *= frictionScalar;

                                        // Apply the same MAX_SPEED clamp used in the main sim.
                                        const vSq = vx * vx + vy * vy;
                                        if (vSq > MAX_SPEED * MAX_SPEED) {
                                            vx *= 0.95;
                                            vy *= 0.95;
                                        }

                                        if (Math.abs(spin) > 0.01) {
                                            const m = MAGNUS_POWER * dtSim;
                                            const vxPrev = vx;
                                            const vyPrev = vy;
                                            vx = vxPrev - spin * vyPrev * m;
                                            vy = vyPrev + spin * vxPrev * m;
                                        }
                                        x += vx * dtSim;
                                        y += vy * dtSim;

                                        // reflect top/bottom (same style as main sim)
                                        if (y < PUCK_RADIUS) {
                                            y = PUCK_RADIUS;
                                            if (vy < 0) vy *= -0.9;
                                            bounces++;
                                        }
                                        if (y > TABLE_HEIGHT - PUCK_RADIUS) {
                                            y = TABLE_HEIGHT - PUCK_RADIUS;
                                            if (vy > 0) vy *= -0.9;
                                            bounces++;
                                        }

                                        // Approximate left/right walls with a goal opening so AI can consider bank shots.
                                        const goalTopSim = TABLE_HEIGHT / 2 - GOAL_HEIGHT / 2;
                                        const goalBotSim = TABLE_HEIGHT / 2 + GOAL_HEIGHT / 2;
                                        const inGoalMouth = y >= goalTopSim && y <= goalBotSim;

                                        if (x < PUCK_RADIUS) {
                                            if (inGoalMouth) { crossedLeft = true; yAtLeft = y; break; }
                                            x = PUCK_RADIUS;
                                            if (vx < 0) vx *= -0.9;
                                            bounces++;
                                        }
                                        if (x > TABLE_WIDTH - PUCK_RADIUS) {
                                            x = TABLE_WIDTH - PUCK_RADIUS;
                                            if (vx > 0) vx *= -0.9;
                                            bounces++;
                                        }

                                        // Early-out when energy is mostly gone after many bounces.
                                        if (bounces >= 10 && (vx * vx + vy * vy) < (MIN_SPEED * MIN_SPEED * 1.2)) break;

                                        // Stop if we cross either goal line.
                                        if (x <= 0) { crossedLeft = true; yAtLeft = y; break; }
                                        if (x >= TABLE_WIDTH) { reachedRight = true; break; }
                                    }
                                    return { crossedLeft, reachedRight, yAtLeft, x, y, vx, vy, bounces };
                                };

                                const scoreSpin = (sCand: number) => {
                                    const out = predict(s.puck.vx, s.puck.vy, sCand);

                                    // Hard reject: reaching the AI's own goal line is unacceptable.
                                    if (out.reachedRight) return { cost: Number.POSITIVE_INFINITY, out };

                                    // Primary objective: actually score on the left goal opening.
                                    const inGoal = out.crossedLeft && out.yAtLeft >= goalTop && out.yAtLeft <= goalBot;
                                    if (inGoal) {
                                        // Aggressive: prefer harder-to-block placements away from player.
                                        // Also prefer faster arrivals so the player has less time to react.
                                        const avoidY = s.p1.y;
                                        const awayFromPlayer = Math.abs(out.yAtLeft - avoidY);
                                        const placementCost = 260 / (awayFromPlayer + 22);

                                        // Lower bounces is generally better (more "direct" threats), but allow a couple.
                                        const bounceCost = Math.max(0, out.bounces - 1) * 55;

                                        // Prefer higher residual speed at the moment we reach the goal line.
                                        const speedAtGoal = Math.hypot(out.vx, out.vy);
                                        const speedBonus = Math.min(900, speedAtGoal * 55);
                                        return { cost: placementCost + bounceCost - speedBonus, out };
                                    }

                                    // If not scoring, estimate how close the final y is to the goal band (bank shots may still be valuable).
                                    const distToGoalBand = out.crossedLeft
                                        ? (out.yAtLeft < goalTop ? (goalTop - out.yAtLeft) : (out.yAtLeft > goalBot ? (out.yAtLeft - goalBot) : 0))
                                        : 1200;

                                    // Aggressive bias: allow larger spin changes when it helps progress toward scoring.
                                    // Still keep a mild regularization so we don't thrash spin for no reason.
                                    const regularize = Math.abs(sCand - baseSpin) * 140;
                                    const bounceHint = out.crossedLeft ? (out.bounces * 10) : 0;

                                    // Strongly prefer going left.
                                    const directionPenalty = out.vx > 0 ? 2200 : 0;
                                    return { cost: distToGoalBand + regularize + bounceHint + directionPenalty, out };
                                };

                                // Two-stage search: coarse scan then refine around the best candidate.
                                let bestSpin = baseSpin;
                                let bestCost = Number.POSITIVE_INFINITY;

                                for (const sCand of coarse) {
                                    const { cost } = scoreSpin(sCand);
                                    if (cost < bestCost) { bestCost = cost; bestSpin = sCand; }
                                }

                                const refineSpan = Math.max(candMax * 0.22, 0.06);
                                const refined = [bestSpin - refineSpan, bestSpin - refineSpan * 0.5, bestSpin, bestSpin + refineSpan * 0.5, bestSpin + refineSpan]
                                    .map(v => Math.max(-candMax, Math.min(candMax, v)));

                                for (const sCand of refined) {
                                    const { cost } = scoreSpin(sCand);
                                    if (cost < bestCost) { bestCost = cost; bestSpin = sCand; }
                                }

                                // Local hill-climb: a few cheap iterations around the current best.
                                // This improves goal-hit reliability without exploding compute.
                                {
                                    let step = Math.max(candMax * 0.12, 0.04);
                                    for (let iter = 0; iter < 3; iter++) {
                                        const left = Math.max(-candMax, bestSpin - step);
                                        const right = Math.min(candMax, bestSpin + step);
                                        const c0 = scoreSpin(bestSpin).cost;
                                        const cL = scoreSpin(left).cost;
                                        const cR = scoreSpin(right).cost;
                                        if (cL < c0 && cL <= cR) { bestSpin = left; bestCost = cL; }
                                        else if (cR < c0) { bestSpin = right; bestCost = cR; }
                                        step *= 0.5;
                                    }
                                }

                                // Apply immediately (before any red arrow UI) so AI can "pre-bend" the shot.
                                s.puck.spin = Math.max(-candMax, Math.min(candMax, bestSpin));
                            }
                        }
                        // 让 spark 从“被挤压后的接触点”喷出：以球心为基准沿法线方向使用当前压缩半径
                        const contactRadius = PUCK_RADIUS * Math.min(s.squash.x, s.squash.y);
                        triggerImpact(s.puck.x - nx * contactRadius, s.puck.y - ny * contactRadius, Math.atan2(ny, nx), Math.sqrt(s.puck.vx**2 + s.puck.vy**2), !isSoftTouch);
                    }
                });
            }

            if (s.goalActive) { s.goalTimer--; if (s.goalTimer <= 0) { if (s.goalScorer === 1) s.p1.score++; else s.p2.score++; resetPuck(s.goalScorer as 1 | 2); } }

            s.p1.prevX = s.p1.x; s.p1.prevY = s.p1.y; s.p2.prevX = s.p2.x; s.p2.prevY = s.p2.y;
            const frictionScalar = Math.pow(VELOCITY_FRICTION, dt);
            s.puck.spin *= Math.pow(SPIN_FRICTION, dt);
            s.puck.vx *= frictionScalar; s.puck.vy *= frictionScalar;
            const vSq = s.puck.vx**2 + s.puck.vy**2;
            s.currentSpeedDisplay = s.currentSpeedDisplay * 0.9 + Math.sqrt(vSq) * 0.1;
            if (vSq < MIN_SPEED**2 && vSq > 0.01) { const boost = MIN_SPEED / Math.sqrt(vSq); s.puck.vx *= boost; s.puck.vy *= boost; }
            if (vSq > MAX_SPEED**2) { s.puck.vx *= 0.95; s.puck.vy *= 0.95; }
        }
      }

            // Online host: emit snapshot after simulation step (authoritative state only).
            if (online?.enabled && online.role === 'host' && online.ready && time - lastNetworkTime >= 50) {
                lastNetworkTime = time;
                online.onSnapshot({
                    t: time,
                    p1: { x: s.p1.x, y: s.p1.y, score: s.p1.score },
                    p2: { x: s.p2.x, y: s.p2.y, score: s.p2.score },
                    puck: {
                        x: s.puck.x,
                        y: s.puck.y,
                        vx: s.puck.vx,
                        vy: s.puck.vy,
                        spin: s.puck.spin,
                        rotation: s.puck.rotation,
                    },
                    leftGoalIntegrity: s.leftGoalIntegrity,
                    rightGoalIntegrity: s.rightGoalIntegrity,
                    winner: s.winner,
                    effects: {
                        hitStop: s.hitStop, hitStopMax: s.hitStopMax, lastImpactNormal: s.lastImpactNormal,
                        isInversionHit: s.isInversionHit, goalActive: s.goalActive, slowMoFactor: s.slowMoFactor,
                        currentSpeedDisplay: s.currentSpeedDisplay, shake: s.shake, squash: { ...s.squash },
                        shockwaves: s.shockwaves.slice(-12).map((wave) => ({ ...wave })),
                        particles: s.particles.slice(-40).map((particle) => ({ ...particle })),
                    },
                });
            }

      ctx.setTransform(1, 0, 0, 1, 0, 0); 
      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const dpr = window.devicePixelRatio || 1;
      const scale = Math.min(canvas.width / dpr / TABLE_WIDTH, canvas.height / dpr / TABLE_HEIGHT) * 0.95;
      const baseX = (canvas.width / dpr - TABLE_WIDTH * scale) / 2;
      const baseY = (canvas.height / dpr - TABLE_HEIGHT * scale) / 2;
      let offsetX = 0, offsetY = 0;
      if (s.shake > 0) { offsetX = (Math.random() - 0.5) * s.shake; offsetY = (Math.random() - 0.5) * s.shake; if (s.hitStop <= 0) s.shake *= (0.9 * dt + (1-dt)); }
      ctx.translate((baseX + offsetX) * dpr, (baseY + offsetY) * dpr);
      ctx.scale(scale * dpr, scale * dpr);

      const goalTop = TABLE_HEIGHT / 2 - GOAL_HEIGHT / 2;
      const goalBot = TABLE_HEIGHT / 2 + GOAL_HEIGHT / 2;

    // Anti-camping semicircles (visual guide)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 2;
    ctx.arc(0, TABLE_HEIGHT/2, GOAL_ZONE_RADIUS, -Math.PI/2, Math.PI/2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(TABLE_WIDTH, TABLE_HEIGHT/2, GOAL_ZONE_RADIUS, Math.PI/2, -Math.PI/2);
    ctx.stroke();

      ctx.lineWidth = LINE_THICKNESS; ctx.strokeStyle = COLOR_INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(TABLE_WIDTH, 0); ctx.moveTo(0, TABLE_HEIGHT); ctx.lineTo(TABLE_WIDTH, TABLE_HEIGHT);
      ctx.moveTo(0, 0); ctx.lineTo(0, goalTop); ctx.moveTo(0, goalBot); ctx.lineTo(0, TABLE_HEIGHT);
      ctx.moveTo(TABLE_WIDTH, 0); ctx.lineTo(TABLE_WIDTH, goalTop); ctx.moveTo(TABLE_WIDTH, goalBot); ctx.lineTo(TABLE_WIDTH, TABLE_HEIGHT); ctx.stroke();
      ctx.beginPath(); ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.moveTo(TABLE_WIDTH / 2, 0); ctx.lineTo(TABLE_WIDTH / 2, TABLE_HEIGHT); ctx.stroke();
      ctx.beginPath(); ctx.arc(TABLE_WIDTH / 2, TABLE_HEIGHT / 2, 60, 0, Math.PI * 2); ctx.stroke();
      ctx.font = 'bold 160px Helvetica Neue, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(0,0,0,0.03)';
      ctx.fillText(s.p1.score.toString(), TABLE_WIDTH * 0.25, TABLE_HEIGHT / 2); ctx.fillText(s.p2.score.toString(), TABLE_WIDTH * 0.75, TABLE_HEIGHT / 2);

      // Confetti
      if (s.winner !== null && s.confetti.length > 0) {
          s.confetti.forEach(c => {
              ctx.strokeStyle = c.color;
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.moveTo(c.x, c.y);
              ctx.lineTo(c.x + Math.cos(c.angle) * c.len, c.y + Math.sin(c.angle) * c.len);
              ctx.stroke();
          });
          
          ctx.font = 'bold 80px Helvetica Neue, Arial';
          ctx.fillStyle = 'black';
          ctx.textAlign = 'center';
          ctx.fillText(`PLAYER ${s.winner} WINS`, TABLE_WIDTH/2, TABLE_HEIGHT/2);
      }

      const speedVal = Math.round(s.currentSpeedDisplay * 3.0); 
      const centerX = TABLE_WIDTH / 2; const centerY = TABLE_HEIGHT - 30;
      ctx.font = 'italic bold 28px "Times New Roman", serif'; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.textAlign = 'right'; ctx.fillText('v', centerX - 5, centerY);
      ctx.font = 'bold 28px "Times New Roman", serif'; ctx.textAlign = 'left'; ctx.fillText(`= ${speedVal}`, centerX, centerY);

      ctx.lineWidth = LINE_THICKNESS; ctx.strokeStyle = COLOR_BARRIER; ctx.beginPath();
      if (s.leftGoalIntegrity) { ctx.moveTo(0, goalTop); ctx.lineTo(0, goalBot); }
      if (s.rightGoalIntegrity) { ctx.moveTo(TABLE_WIDTH, goalTop); ctx.lineTo(TABLE_WIDTH, goalBot); }
      ctx.stroke();

      for (let i = s.shockwaves.length - 1; i >= 0; i--) {
          const sw = s.shockwaves[i]; ctx.beginPath(); ctx.strokeStyle = `rgba(0,0,0,${sw.alpha})`; ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2); ctx.stroke();
          sw.r += 4 * dt; sw.alpha -= 0.05 * dt; if (sw.alpha <= 0) s.shockwaves.splice(i, 1);
      }

      for (let i = s.particles.length - 1; i >= 0; i--) {
          const p = s.particles[i];
          if (s.hitStop <= 0) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= p.decay * dt; if (p.type === 'spark') p.vy += SPARK_GRAVITY * dt; else { p.vx *= DEBRIS_FRICTION; p.vy *= DEBRIS_FRICTION; } if (p.rotation !== undefined && p.vRot !== undefined) p.rotation += p.vRot * dt; }
          if (p.life > 0) {
              ctx.strokeStyle = COLOR_BARRIER; ctx.beginPath();
              if (p.type === 'debris') { const len = p.length || 8; const angle = p.rotation || 0; ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - Math.cos(angle) * len, p.y - Math.sin(angle) * len); } 
              else { const speed = Math.sqrt(p.vx**2 + p.vy**2); const len = 5 + speed * 1.5; const angle = Math.atan2(p.vy, p.vx); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(angle) * len, p.y + Math.sin(angle) * len); }
              ctx.stroke();
          } else { s.particles.splice(i, 1); }
      }

      ctx.lineWidth = LINE_THICKNESS; ctx.strokeStyle = COLOR_INK;
      const drawPaddle = (x: number, y: number) => { ctx.beginPath(); ctx.fillStyle = '#FFFFFF'; ctx.arc(x, y, PADDLE_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
      drawPaddle(s.p1.x, s.p1.y); drawPaddle(s.p2.x, s.p2.y);

      // [TUNED] Changed lerp speed from 0.25 to 0.45 for faster squash recovery visually
      if (s.hitStop <= 0) { const lerpSpeed = 0.45 * dt; s.squash.x += (1 - s.squash.x) * lerpSpeed; s.squash.y += (1 - s.squash.y) * lerpSpeed; }
      ctx.save(); ctx.translate(s.puck.x, s.puck.y); ctx.rotate(s.squash.angle); ctx.scale(s.squash.x, s.squash.y); ctx.rotate(-s.squash.angle); ctx.rotate(s.puck.rotation);
      ctx.beginPath(); ctx.fillStyle = '#FFFFFF'; ctx.arc(0, 0, PUCK_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -PUCK_RADIUS + 4); ctx.lineTo(0, PUCK_RADIUS - 4); ctx.moveTo(-PUCK_RADIUS + 4, 0); ctx.lineTo(PUCK_RADIUS - 4, 0); ctx.stroke(); ctx.restore();

      if ((s.hitStop > 0) && s.isInversionHit) {
          ctx.save(); ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = 'white';
          const progress = 1 - (s.hitStop / s.hitStopMax); const maxRadius = 500; const radius = PUCK_RADIUS + (maxRadius * Math.pow(progress, 0.4));
          ctx.beginPath(); ctx.arc(s.puck.x, s.puck.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }

      if (s.hitStop > 0) {
          const p = 1 - (s.hitStop / (s.hitStopMax || 1));

          // 蓝色：冻结帧期间锁定在“触发冻结的那一刻”的速度增量方向，只显示长度可被回拉/推回
          const blueP = easeOutCubic(Math.min(1, p * 2.6));
          // Blue arrow: during hit-stop show adjusted *magnitude* only, but keep the locked direction.
          // This avoids direction flipping when preV and postV are not collinear.
          if (ENABLE_HITSTOP_CONTROL && s.hitIntent.active) {
              const adj = s.hitIntent.adj;
              const dx = s.hitIntent.blueDx;
              const dy = s.hitIntent.blueDy;

              // 0..1: shrink blue to 0, but 0 means the puck ends up at MIN_SPEED (not "no change")
              const k = 1 - Math.max(0, Math.min(1, adj));

              // Match the render to the actual energy-conserving mapping used for settlement.
              const baseSpinAbs = s.hitIntent.baseSpinAbs;
              const postLen = s.hitIntent.postLen;
              const vMax = Math.max(MIN_SPEED, postLen);
              const dv = Math.max(0, vMax - MIN_SPEED);

              // Blue render matches settlement: shrinking blue reduces speed linearly (toward MIN_SPEED).
              // Spin is a linear "percentage transfer" capped by per-hit ceiling, but does not affect speed.
              const mag = dv * k;
              const bVx = dx * mag;
              const bVy = dy * mag;
              drawWrappedArrow(ctx, s.puck.x, s.puck.y, bVx, bVy, COLOR_VELOCITY, blueP);
          } else {
              drawWrappedArrow(ctx, s.puck.x, s.puck.y, s.puck.vx, s.puck.vy, COLOR_VELOCITY, blueP);
          }

          // 冻结帧内：调节 adj（不画绿箭头、不做反向刹车）。
          // adj 的意义：把“这次击球的速度增量(postLen)”按比例转移到旋转(spin)上，保持能量守恒。
          if (ENABLE_HITSTOP_CONTROL && s.hitIntent.active && !s.hitIntent.isAi) {
              const blueDx = s.hitIntent.blueDx;
              const blueDy = s.hitIntent.blueDy;

              let targetAdj = s.hitIntent.adj;
              if (inp.hitAdj.active && inp.mouseX !== null && inp.mouseY !== null) {
                  const relX = inp.mouseX - s.p1.x;
                  const relY = inp.mouseY - s.p1.y;
                  const along = -(relX * blueDx + relY * blueDy);
                  const perp = (relX * -blueDy + relY * blueDx);
                  const assist = 1 / (1 + Math.abs(perp) / 120);

                  const baseLen = s.hitIntent.postLen;
                  const clampedLen = Math.max(0, Math.min(baseLen, along * assist));
                  targetAdj = baseLen > 0 ? (clampedLen / baseLen) : 0;
              }

              if (!s.hitIntent.isAi) {
                  const stiffness = 0.22;
                  const damping = 0.78;
                  const accel = (targetAdj - s.hitIntent.adj) * stiffness;
                  s.hitIntent.adjVel = (s.hitIntent.adjVel + accel) * damping;
                  s.hitIntent.adj += s.hitIntent.adjVel;
                  s.hitIntent.adj = Math.max(0, Math.min(1, s.hitIntent.adj));
              }

              // Mapping (not strict energy conservation):
              // - Blue speed magnitude maps linearly in [MIN_SPEED, post-hit speed]
              // - Red spin magnitude maps linearly as the same percentage, but is capped by per-hit ceiling
              const adj = s.hitIntent.adj;
              const k = 1 - adj;

              const baseSpinAbs2 = s.hitIntent.baseSpinAbs;
              const baseSpinSign = s.hitIntent.baseSpinSign;
              // Speed range is defined by the hit result: we map uniformly from MIN_SPEED up to the
              // *post-hit* speed magnitude (the blue arrow at impact).
              const postLen = s.hitIntent.postLen;
              const vMax = Math.max(MIN_SPEED, postLen);
              const dv = Math.max(0, vMax - MIN_SPEED);

              const spinCeil = Math.max(baseSpinAbs2, Math.min(MAX_SPIN, s.hitIntent.baseSpinMax || baseSpinAbs2));
              const spinAbsTarget = baseSpinAbs2 + (spinCeil - baseSpinAbs2) * adj;
              // Not strictly energy conserving anymore: speed is controlled purely by k (blue length),
              // and spin follows the same percentage, capped by a per-hit ceiling.
              const spinNow = baseSpinSign * spinAbsTarget;

              // Preview spin during hit-stop so red arrow length tracks blue adjustment 1:1.
              // For AI, this happens after it chooses adj (see AI block below).
              if (!s.hitIntent.isAi) {
                  s.puck.spin = spinNow;
              }

              // Apply once when hit-stop ends.
              if (!s.hitIntent.applied && s.hitStop <= 0.01 && !s.hitIntent.isAi) {
                  // adj=1 -> MIN_SPEED; adj=0 -> vMax (post-hit speed).
                  // IMPORTANT: regardless of how we map energy to spin, the final speed magnitude must
                  // obey this range mapping so pulling blue to 0 never results in extra acceleration.
                  const finalSpeed = MIN_SPEED + dv * k;
                  s.puck.vx = blueDx * finalSpeed;
                  s.puck.vy = blueDy * finalSpeed;
                  s.puck.spin = spinNow;

                  // Safety net for numerical edges
                  const vSq2 = s.puck.vx * s.puck.vx + s.puck.vy * s.puck.vy;
                  if (vSq2 < MIN_SPEED * MIN_SPEED) {
                      s.puck.vx = blueDx * MIN_SPEED;
                      s.puck.vy = blueDy * MIN_SPEED;
                  }

                  s.hitIntent.applied = true;
              }

              // No need to mutate framesLeft; the applied flag prevents repeats.
          }

          // AI: during hit-stop decide how much to convert speed -> spin.
          // Goal: choose adj to steer the puck toward the opponent goal line using a simple forward prediction.
          if (ENABLE_HITSTOP_CONTROL && s.hitIntent.active && s.hitIntent.isAi && mode === 'pve') {
              const blueDx = s.hitIntent.blueDx;
              const blueDy = s.hitIntent.blueDy;

              // Predict where puck Y will be when it reaches the opponent goal line.
              // We simulate with current v and candidate spin affecting curvature (Magnus).
              const predictYAtX = (vx0: number, vy0: number, spin0: number, targetX: number) => {
                  let x = s.puck.x;
                  let y = s.puck.y;
                  let vx = vx0;
                  let vy = vy0;
                  let spin = spin0;
                  const dtSim = 0.4;
                  for (let i = 0; i < 240; i++) {
                      // Magnus curvature (same sign convention as main sim)
                      if (Math.abs(spin) > 0.01) {
                          const m = MAGNUS_POWER * dtSim;
                          vx -= spin * vy * m;
                          vy += spin * vx * m;
                      }

                      x += vx * dtSim;
                      y += vy * dtSim;

                                        // reflect top/bottom (same idea as main sim)
                                        if (y < PUCK_RADIUS) {
                                            y = PUCK_RADIUS;
                                            if (vy < 0) vy *= -0.9;
                                        }
                                        if (y > TABLE_HEIGHT - PUCK_RADIUS) {
                                            y = TABLE_HEIGHT - PUCK_RADIUS;
                                            if (vy > 0) vy *= -0.9;
                                        }

                      // stop once we cross the target x
                      if ((targetX >= x && vx >= 0 && x >= targetX) || (targetX <= x && vx <= 0 && x <= targetX)) break;
                  }
                  return y;
              };

              // Candidate search over adj: more adj -> more spin, less speed.
              const baseSpinAbs = s.hitIntent.baseSpinAbs;
              const baseSpinSign = s.hitIntent.baseSpinSign;
              const vMax = Math.max(MIN_SPEED, s.hitIntent.postLen);
              const dv = Math.max(0, vMax - MIN_SPEED);

              const goalCenterY = TABLE_HEIGHT / 2;
              const targetX = 0; // AI shoots toward player1 goal (left)

              let bestAdj = 0;
              let bestScore = Number.POSITIVE_INFINITY;
              for (let step = 0; step <= 8; step++) {
                  const candAdj = step / 8;
                  const k = 1 - candAdj;
                  const spinAbsTarget = baseSpinAbs + (MAX_SPIN - baseSpinAbs) * candAdj;

                  const eSpin0 = baseSpinAbs * baseSpinAbs;
                  const eSpin = spinAbsTarget * spinAbsTarget;
                  const eAvail = dv * dv;
                  const used = Math.max(0, Math.min(1, (eSpin - eSpin0) / (eAvail || 1)));
                  const kEnergy = Math.sqrt(1 - used);
                  const kEff = (spinAbsTarget >= MAX_SPIN - 1e-6) ? 0 : (k * kEnergy);

                  const finalSpeed = MIN_SPEED + dv * kEff;
                  const vx0 = blueDx * finalSpeed;
                  const vy0 = blueDy * finalSpeed;
                  const spin0 = baseSpinSign * spinAbsTarget;

                  const yHit = predictYAtX(vx0, vy0, spin0, targetX);
                  const score = Math.abs(yHit - goalCenterY);
                  if (score < bestScore) {
                      bestScore = score;
                      bestAdj = candAdj;
                  }
              }

              // Apply with some inertia so it feels like a decision, not a snap.
              const stiffness = 0.18;
              const damping = 0.80;
              const accel = (bestAdj - s.hitIntent.adj) * stiffness;
              s.hitIntent.adjVel = (s.hitIntent.adjVel + accel) * damping;
              s.hitIntent.adj += s.hitIntent.adjVel;
              s.hitIntent.adj = Math.max(0, Math.min(1, s.hitIntent.adj));

              // Preview spin for the red arrow during hit-stop.
              const spinAbsTarget = baseSpinAbs + (MAX_SPIN - baseSpinAbs) * s.hitIntent.adj;
              s.puck.spin = baseSpinSign * spinAbsTarget;

              // Apply settlement at the end of hit-stop using AI-chosen adj.
              if (s.hitStop <= 0.01) {
                  const adj = s.hitIntent.adj;
                  const k = 1 - adj;
                  const vMax = Math.max(MIN_SPEED, s.hitIntent.postLen);
                  const dv = Math.max(0, vMax - MIN_SPEED);

                  const spinAbsTarget2 = baseSpinAbs + (MAX_SPIN - baseSpinAbs) * adj;
                  const eSpin0 = baseSpinAbs * baseSpinAbs;
                  const eSpin = spinAbsTarget2 * spinAbsTarget2;
                  const eAvail = dv * dv;
                  const used = Math.max(0, Math.min(1, (eSpin - eSpin0) / (eAvail || 1)));
                  const kEnergy = Math.sqrt(1 - used);
                  const kEff = (spinAbsTarget2 >= MAX_SPIN - 1e-6) ? 0 : (k * kEnergy);

                  const finalSpeed = MIN_SPEED + dv * kEff;
                  s.puck.vx = blueDx * finalSpeed;
                  s.puck.vy = blueDy * finalSpeed;
                  s.puck.spin = baseSpinSign * spinAbsTarget2;
              }
          }

             // 红色：旋转方向与强度（围着圆环轻微 swing，有漂浮感；冻结帧里唯一会动的东西）
          if (Math.abs(s.puck.spin) > 0.05) {
             const radius = PUCK_RADIUS + 15;
             const spinDir = Math.sign(s.puck.spin);
             const baseAngle = s.lastImpactNormal;
             const arcLength = Math.min(Math.PI * 1.5, Math.abs(s.puck.spin) * 6);

             const redP = easeOutCubic(Math.min(1, p * 2.6));
                 // 红色：中幅“一次性”摆动（慢-快-慢），同时伸长。冻结帧里它仍会动。
                 const swingProg = easeOutCubic(Math.min(1, p * 1.1));
                 const swingShape = Math.sin(swingProg * Math.PI); // 0->1->0（两端慢）
                 const swing = swingShape * 0.55 * spinDir;
                 const swingAngle = baseAngle + swing;

             const startAngle = swingAngle - (arcLength * 0.5 * spinDir);
             const endAngle = startAngle + arcLength * spinDir * redP;

             ctx.strokeStyle = COLOR_SPIN;
             ctx.lineWidth = 3;
             ctx.beginPath();
             ctx.arc(s.puck.x, s.puck.y, radius, startAngle, endAngle, spinDir < 0);

             const arrowX = s.puck.x + Math.cos(endAngle) * radius;
             const arrowY = s.puck.y + Math.sin(endAngle) * radius;
             const tangent = endAngle + (spinDir * Math.PI / 2);
             ctx.moveTo(arrowX, arrowY);
             ctx.lineTo(arrowX - Math.cos(tangent - Math.PI/6) * 10, arrowY - Math.sin(tangent - Math.PI/6) * 10);
             ctx.moveTo(arrowX, arrowY);
             ctx.lineTo(arrowX - Math.cos(tangent + Math.PI/6) * 10, arrowY - Math.sin(tangent + Math.PI/6) * 10);
             ctx.stroke();
          }
      }

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    const handleKeyDown = (e: KeyboardEvent) => { const k = e.key.toLowerCase(); if(k==='w') inputs.current.w=true; if(k==='s') inputs.current.s=true; if(k==='a') inputs.current.a=true; if(k==='d') inputs.current.d=true; if(k==='arrowup') inputs.current.up=true; if(k==='arrowdown') inputs.current.down=true; if(k==='arrowleft') inputs.current.left=true; if(k==='arrowright') inputs.current.right=true; };
    const handleKeyUp = (e: KeyboardEvent) => { const k = e.key.toLowerCase(); if(k==='w') inputs.current.w=false; if(k==='s') inputs.current.s=false; if(k==='a') inputs.current.a=false; if(k==='d') inputs.current.d=false; if(k==='arrowup') inputs.current.up=false; if(k==='arrowdown') inputs.current.down=false; if(k==='arrowleft') inputs.current.left=false; if(k==='arrowright') inputs.current.right=false; };
    const handleMouseMove = (e: MouseEvent) => { if (!canvas) return; const dpr = window.devicePixelRatio || 1; const scale = Math.min(canvas.width / dpr / TABLE_WIDTH, canvas.height / dpr / TABLE_HEIGHT) * 0.95; const baseX = (canvas.width / dpr - TABLE_WIDTH * scale) / 2; const baseY = (canvas.height / dpr - TABLE_HEIGHT * scale) / 2; const rect = canvas.getBoundingClientRect(); const x = (e.clientX - rect.left) * dpr; const y = (e.clientY - rect.top) * dpr; inputs.current.mouseX = (x / dpr - baseX) / scale; inputs.current.mouseY = (y / dpr - baseY) / scale; };
    const handleTouchMove = (e: TouchEvent) => { e.preventDefault(); if (!canvas || !e.touches[0]) return; const t = e.touches[0]; const dpr = window.devicePixelRatio || 1; const scale = Math.min(canvas.width / dpr / TABLE_WIDTH, canvas.height / dpr / TABLE_HEIGHT) * 0.95; const baseX = (canvas.width / dpr - TABLE_WIDTH * scale) / 2; const baseY = (canvas.height / dpr - TABLE_HEIGHT * scale) / 2; const rect = canvas.getBoundingClientRect(); const x = (t.clientX - rect.left) * dpr; const y = (t.clientY - rect.top) * dpr; inputs.current.mouseX = (x / dpr - baseX) / scale; inputs.current.mouseY = (y / dpr - baseY) / scale; };

    const clearInput = () => {
      Object.assign(inputs.current, { w: false, a: false, s: false, d: false, up: false, down: false, left: false, right: false, mouseX: null, mouseY: null });
    };
    window.addEventListener('blur', clearInput);
    window.addEventListener('keydown', handleKeyDown); window.addEventListener('keyup', handleKeyUp); window.addEventListener('mousemove', handleMouseMove); canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => { window.removeEventListener('blur', clearInput); window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); window.removeEventListener('mousemove', handleMouseMove); canvas.removeEventListener('touchmove', handleTouchMove); cancelAnimationFrame(animationFrameId); };

  }, [mode]);

  useImperativeHandle(ref, () => ({
    updateState: (data) => {},
    resetGame: () => {
        state.current.p1.score = 0; 
        state.current.p2.score = 0; 
        state.current.winner = null; 
        state.current.puck.x = TABLE_WIDTH/2; 
        state.current.puck.y = TABLE_HEIGHT/2; 
        state.current.puck.vx = (Math.random() > 0.5 ? 1 : -1) * 6; 
        state.current.puck.vy = 0;
        state.current.confetti = [];
        Object.assign(state.current.p1, { x: 100, y: TABLE_HEIGHT / 2, prevX: 100, prevY: TABLE_HEIGHT / 2, vx: 0, vy: 0, recoilX: 0, recoilY: 0, hitCooldown: 0 });
        Object.assign(state.current.p2, { x: TABLE_WIDTH - 100, y: TABLE_HEIGHT / 2, prevX: TABLE_WIDTH - 100, prevY: TABLE_HEIGHT / 2, vx: 0, vy: 0, recoilX: 0, recoilY: 0, hitCooldown: 0 });
        Object.assign(state.current.puck, { spin: 0, rotation: 0 });
        Object.assign(state.current, {
          consecutiveHits: 0, hitStop: 0, hitStopMax: 0, barrierCooldown: 0, currentSpeedDisplay: 0,
          goalActive: false, goalTimer: 0, goalScorer: 0, slowMoFactor: 1,
          leftGoalIntegrity: true, rightGoalIntegrity: true, shake: 0, isInversionHit: false,
          particles: [], shockwaves: [], hitIntent: initHitStopControlState(),
          squash: { x: 1, y: 1, angle: 0, recovery: 0.4 },
        });
    }
  }));

  return <canvas ref={canvasRef} className="w-full h-full block touch-none" />;
});

export default Hockey;
