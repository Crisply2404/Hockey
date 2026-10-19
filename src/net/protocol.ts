import { z } from 'zod';

const finite = z.number().finite();
const roomId = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/);
const position = z.object({ x: finite, y: finite });
const paddle = position.extend({ score: z.number().int().min(0).max(7) });
const particle = position.extend({
  vx: finite, vy: finite, life: finite, decay: finite,
  type: z.enum(['spark', 'debris']),
  rotation: finite.optional(), vRot: finite.optional(), length: finite.optional(), radius: finite.optional(),
});

export const playerInputSchema = z.object({
  t: finite,
  keys: z.object({ w: z.boolean(), a: z.boolean(), s: z.boolean(), d: z.boolean() }),
  mouse: z.object({ x: finite.min(0).max(800).nullable(), y: finite.min(0).max(450).nullable() }),
});

export const gameSnapshotSchema = z.object({
  t: finite,
  p1: paddle,
  p2: paddle,
  puck: position.extend({ vx: finite, vy: finite, spin: finite, rotation: finite }),
  leftGoalIntegrity: z.boolean(),
  rightGoalIntegrity: z.boolean(),
  winner: z.union([z.literal(1), z.literal(2)]).nullable(),
  effects: z.object({
    hitStop: finite, hitStopMax: finite, lastImpactNormal: finite, isInversionHit: z.boolean(),
    goalActive: z.boolean(), slowMoFactor: finite, currentSpeedDisplay: finite, shake: finite,
    squash: z.object({ x: finite, y: finite, angle: finite, recovery: finite }),
    shockwaves: z.array(position.extend({ r: finite, alpha: finite })).max(12),
    particles: z.array(particle).max(40),
  }),
});

export const roomSummarySchema = z.object({
  roomId,
  players: z.union([z.literal(1), z.literal(2)]),
  maxPlayers: z.literal(2),
  createdAt: finite,
  hostName: z.string().max(18),
  guestName: z.string().max(18).nullable(),
});

export const wsClientMsgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lobby:hello'), playerName: z.string().trim().min(1).max(18) }),
  z.object({ type: z.literal('lobby:list') }),
  z.object({ type: z.literal('room:create') }),
  z.object({ type: z.literal('room:join'), roomId }),
  z.object({ type: z.literal('room:leave'), roomId }),
  z.object({ type: z.literal('game:input'), roomId, input: playerInputSchema }),
  z.object({ type: z.literal('game:snapshot'), roomId, snapshot: gameSnapshotSchema }),
  z.object({ type: z.literal('ping'), t: finite }),
]);

export const wsServerMsgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lobby:state'), rooms: z.array(roomSummarySchema) }),
  z.object({ type: z.literal('room:created'), room: roomSummarySchema, role: z.literal('host') }),
  z.object({ type: z.literal('room:joined'), room: roomSummarySchema, role: z.enum(['host', 'guest']) }),
  z.object({ type: z.literal('room:left'), roomId }),
  z.object({ type: z.literal('room:closed'), roomId, reason: z.string() }),
  z.object({ type: z.literal('game:input'), roomId, input: playerInputSchema }),
  z.object({ type: z.literal('game:snapshot'), roomId, snapshot: gameSnapshotSchema }),
  z.object({ type: z.literal('pong'), t: finite }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);

export type WsClientMsg = z.infer<typeof wsClientMsgSchema>;
export type WsServerMsg = z.infer<typeof wsServerMsgSchema>;
export type PlayerInput = z.infer<typeof playerInputSchema>;
export type GameSnapshot = z.infer<typeof gameSnapshotSchema>;
export type RoomSummary = z.infer<typeof roomSummarySchema>;
export type OnlineRole = 'host' | 'guest';

export function isWsServerMsg(value: unknown): value is WsServerMsg {
  return wsServerMsgSchema.safeParse(value).success;
}
