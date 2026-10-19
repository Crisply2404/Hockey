import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, test } from 'node:test';
import WebSocket from 'ws';
import { LobbyClient } from '../src/net/lobbyClient';
import type { GameSnapshot } from '../src/net/protocol';

globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
const endpoint = process.env.HOCKEY_TEST_WS_URL ?? 'ws://127.0.0.1:8796/ws';
const sockets: WebSocket[] = [];
const clients: LobbyClient[] = [];

async function connectPlayer() {
  const socket = new WebSocket(endpoint, { origin: 'http://127.0.0.1:3016' });
  const messages: any[] = [];
  const updates = new Set<() => void>();
  socket.on('message', (data) => {
    messages.push(JSON.parse(data.toString()));
    for (const update of [...updates]) update();
  });
  sockets.push(socket);
  await once(socket, 'open');
  return {
    socket,
    send(message: unknown) { socket.send(JSON.stringify(message)); },
    next(type: string) {
      return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          updates.delete(check);
          reject(new Error(`未收到 ${type}`));
        }, 3000);
        const check = () => {
          const index = messages.findIndex((message) => message.type === type);
          if (index < 0) return;
          clearTimeout(timer);
          updates.delete(check);
          resolve(messages.splice(index, 1)[0]);
        };
        updates.add(check);
        check();
      });
    },
  };
}

after(() => {
  for (const client of clients) client.disconnect();
  for (const socket of sockets) socket.terminate();
});

test('连接建立期间提交的加入请求能够进入实际房间', async () => {
  const host = await connectPlayer();
  host.send({ type: 'room:create' });
  const created = await host.next('room:created');
  const joined = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('连接建立前提交的房间加入请求未完成')), 3000);
    const client = new LobbyClient({
      url: endpoint,
      onRoomJoined: (room, role) => {
        clearTimeout(timer);
        resolve({ room, role });
      },
    });
    clients.push(client);
    client.connect('Guest');
    client.joinRoom(created.room.roomId);
  });
  const result = await joined;
  assert.equal(result.room.roomId, created.room.roomId);
  assert.equal(result.role, 'guest');
  assert.equal(result.room.players, 2);
});

test('房间支持人数限制、访客离开、再次加入与房主关闭', async () => {
  const host = await connectPlayer();
  const guest = await connectPlayer();
  const visitor = await connectPlayer();
  host.send({ type: 'lobby:hello', playerName: 'Host' });
  host.send({ type: 'room:create' });
  const { room } = await host.next('room:created');
  assert.equal(room.hostName, 'Host');
  guest.send({ type: 'room:join', roomId: room.roomId.toLowerCase() });
  assert.equal((await guest.next('room:joined')).room.players, 2);
  visitor.send({ type: 'room:join', roomId: room.roomId });
  assert.equal((await visitor.next('error')).code, 'room_full');
  guest.send({ type: 'room:leave', roomId: room.roomId });
  assert.equal((await guest.next('room:left')).roomId, room.roomId);
  visitor.send({ type: 'room:join', roomId: room.roomId });
  assert.equal((await visitor.next('room:joined')).role, 'guest');
  host.send({ type: 'room:leave', roomId: room.roomId });
  assert.equal((await visitor.next('room:closed')).roomId, room.roomId);
  visitor.send({ type: 'room:join', roomId: room.roomId });
  assert.equal((await visitor.next('error')).code, 'room_not_found');
  // 房间关闭后，同一连接可以立即创建自己的房间。
  visitor.send({ type: 'room:create' });
  assert.equal((await visitor.next('room:created')).role, 'host');
});

test('Worker 转发实际输入与比赛状态，并检查房间成员和角色', async () => {
  const host = await connectPlayer();
  const guest = await connectPlayer();
  const visitor = await connectPlayer();
  host.send({ type: 'room:create' });
  const { room } = await host.next('room:created');
  guest.send({ type: 'room:join', roomId: room.roomId });
  await guest.next('room:joined');
  const input = { t: 100, keys: { w: true, a: false, s: false, d: false }, mouse: { x: 650, y: 100 } };
  guest.send({ type: 'game:input', roomId: room.roomId, input });
  assert.deepEqual((await host.next('game:input')).input, input);
  visitor.send({ type: 'game:input', roomId: room.roomId, input });
  assert.equal((await visitor.next('error')).code, 'not_in_room');
  host.send({ type: 'game:input', roomId: room.roomId, input });
  assert.equal((await host.next('error')).code, 'wrong_role');

  const snapshot: GameSnapshot = {
    t: 200,
    p1: { x: 100, y: 225, score: 3 },
    p2: { x: 650, y: 100, score: 2 },
    puck: { x: 500, y: 200, vx: 20, vy: 5, spin: 0.2, rotation: 1 },
    leftGoalIntegrity: true, rightGoalIntegrity: false, winner: null,
    effects: {
      hitStop: 10, hitStopMax: 15, lastImpactNormal: 1, isInversionHit: false,
      goalActive: false, slowMoFactor: 1, currentSpeedDisplay: 20, shake: 5,
      squash: { x: 0.8, y: 1.2, angle: 1, recovery: 0.25 },
      shockwaves: [{ x: 490, y: 200, r: 25, alpha: 0.8 }],
      particles: [{ x: 490, y: 200, vx: 2, vy: 3, life: 0.8, decay: 0.1, type: 'spark' }],
    },
  };
  host.send({ type: 'game:snapshot', roomId: room.roomId, snapshot });
  assert.deepEqual((await guest.next('game:snapshot')).snapshot, snapshot);
  guest.send({ type: 'game:snapshot', roomId: room.roomId, snapshot });
  assert.equal((await guest.next('error')).code, 'wrong_role');
  guest.send({ type: 'game:input', roomId: room.roomId, input: { ...input, mouse: { x: 5000, y: 100 } } });
  assert.equal((await guest.next('error')).code, 'invalid_message');
  host.send({ type: 'ping', t: 1234 });
  assert.equal((await host.next('pong')).t, 1234);
});

test('Worker 限定允许的网页来源并拒绝无效消息', async () => {
  const response = await fetch(endpoint.replace(/^ws/, 'http').replace('/ws', '/health'));
  assert.deepEqual(await response.json(), { ok: true, service: 'hockey-lobby' });

  const denied = new WebSocket(endpoint, { origin: 'https://unknown.example' });
  await new Promise<void>((resolve, reject) => {
    denied.once('unexpected-response', (_request, response) => {
      assert.equal(response.statusCode, 403);
      denied.terminate();
      resolve();
    });
    denied.once('open', () => reject(new Error('服务允许了未配置的网页来源')));
    denied.once('error', () => {});
  });

  const host = await connectPlayer();
  host.socket.send('{');
  assert.equal((await host.next('error')).code, 'bad_json');
  host.send({ type: 'room:create' });
  const { room } = await host.next('room:created');
  host.send({ type: 'room:leave', roomId: 'ZZZZZZ' });
  assert.equal((await host.next('error')).code, 'not_in_room');
  host.send({ type: 'room:leave', roomId: room.roomId });
  assert.equal((await host.next('room:left')).roomId, room.roomId);
});
