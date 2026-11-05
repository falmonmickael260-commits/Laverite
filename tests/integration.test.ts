import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import type { PublicRoom } from '../shared/types.js';

const port = 38000 + Math.floor(Math.random() * 20000);
const origin = `http://127.0.0.1:${port}`;
let child: ChildProcess;
const sockets: Socket[] = [];
async function request(path: string, method = 'GET', data?: object, token?: string) {
  const response = await fetch(origin + path, {
    method, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined
  });
  return { status: response.status, body: await response.json() };
}
async function connect(roomId: string, token: string) {
  const socket = io(origin, { auth: { roomId, token }, reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
function event(socket: Socket, name: string, data: object = {}) {
  return new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
    socket.timeout(7000).emit(name, data, (error: Error | null, response: { ok: boolean; error?: string }) => error ? reject(error) : resolve(response));
  });
}
async function state(roomId: string, token: string): Promise<PublicRoom> {
  const response = await request(`/api/rooms/${roomId}`, 'GET', undefined, token);
  expect(response.status).toBe(200);
  return response.body.room;
}
async function waitFor(roomId: string, token: string, test: (room: PublicRoom) => boolean) {
  for (let i = 0; i < 80; i++) {
    const room = await state(roomId, token);
    if (test(room)) return room;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('État attendu non atteint');
}

beforeAll(async () => {
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port), REDIS_URL: '', NODE_ENV: 'test' }, stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(origin + '/api/health')).ok) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Serveur non démarré');
}, 15000);
afterAll(() => { sockets.forEach(socket => socket.disconnect()); child?.kill(); });

describe('salon multijoueur réel', () => {
  it('accepte 30 connexions simultanées dans un même salon', async () => {
    const created = await request('/api/rooms', 'POST', { name: 'Organisateur', hours: 1 });
    const roomId = created.body.roomId as string;
    const guests = await Promise.all(Array.from({ length: 29 }, (_, i) => request(`/api/rooms/${roomId}/join`, 'POST', { name: `Invité ${i + 1}` })));
    expect(guests.every(guest => guest.status === 200)).toBe(true);
    await Promise.all([connect(roomId, created.body.token), ...guests.map(guest => connect(roomId, guest.body.token))]);
    const room = await waitFor(roomId, created.body.token, r => r.players.filter(p => p.present).length === 30);
    expect(room.players).toHaveLength(30);
    expect((await event(sockets.at(-30)!, 'end')).ok).toBe(true);
  }, 30000);
  it('synchronise les tours et protège les commandes', async () => {
    const created = await request('/api/rooms', 'POST', { name: 'Alice', avatar: '🦊', hours: 1 });
    expect(created.status).toBe(200);
    const { roomId, token: hostToken, playerId: hostId } = created.body;
    const joined = await request(`/api/rooms/${roomId}/join`, 'POST', { name: 'Bob', avatar: '🐼' });
    expect(joined.status).toBe(200);
    const { token: guestToken, playerId: guestId } = joined.body;
    expect((await request(`/api/rooms/${roomId}/join`, 'POST', { name: 'alice' })).status).toBe(400);
    expect((await request(`/api/rooms/${roomId}`)).status).toBe(403);
    const host = await connect(roomId, hostToken);
    const guest = await connect(roomId, guestToken);
    await waitFor(roomId, hostToken, room => room.players.filter(p => p.present).length === 2);
    expect((await event(guest, 'start')).ok).toBe(false);
    expect((await event(host, 'start')).ok).toBe(true);
    let room = await waitFor(roomId, hostToken, r => r.phase === 'choosing');
    expect(room.selectedId).toBeTruthy();
    const current = room.selectedId === hostId ? host : guest;
    const other = current === host ? guest : host;
    expect((await event(other, 'choose', { kind: 'action' })).ok).toBe(false);
    expect((await event(current, 'choose', { kind: 'truth' })).ok).toBe(true);
    room = await state(roomId, guestToken);
    expect(room.phase).toBe('prompt');
    expect(room.prompt?.kind).toBe('truth');
    expect((await event(other, 'reaction', { emoji: '😂' })).ok).toBe(true);
    expect((await event(other, 'reaction', { emoji: '😂' })).ok).toBe(false);
    expect((await event(other, 'gift', { type: '👑', toId: room.selectedId })).ok).toBe(true);
    expect((await event(guest, 'pause')).ok).toBe(false);
    expect((await event(host, 'pause')).ok).toBe(true);
    expect((await state(roomId, hostToken)).phase).toBe('paused');
    expect((await event(host, 'resume')).ok).toBe(true);
    expect((await event(current, 'finish')).ok).toBe(true);
    room = await waitFor(roomId, hostToken, r => r.phase === 'choosing' && r.turnNumber === 2);
    expect(room.selectedId).not.toBe(current === host ? hostId : guestId);
    const second = room.selectedId === hostId ? host : guest;
    expect((await event(second, 'choose', { kind: 'action' })).ok).toBe(true);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
    const selectedToken = second === host ? hostToken : guestToken;
    const uploaded = await fetch(origin + `/api/rooms/${roomId}/photos`, { method: 'POST', headers: { Authorization: `Bearer ${selectedToken}`, 'Content-Type': 'image/png' }, body: png });
    expect(uploaded.status).toBe(200);
    const photoId = (await uploaded.json()).id;
    expect((await fetch(origin + `/api/rooms/${roomId}/photos/${photoId}`)).status).toBe(404);
    expect((await fetch(origin + `/api/rooms/${roomId}/photos/${photoId}`, { headers: { Authorization: `Bearer ${guestToken}` } })).status).toBe(200);
    expect((await event(second === host ? guest : host, 'reaction', { emoji: '👏', photoId })).ok).toBe(true);
    const deleted = await fetch(origin + `/api/rooms/${roomId}/photos/${photoId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${selectedToken}` } });
    expect(deleted.status).toBe(200);
    const late = await request(`/api/rooms/${roomId}/join`, 'POST', { name: 'Chloé' });
    expect(late.status).toBe(200);
    const lateSocket = await connect(roomId, late.body.token);
    await waitFor(roomId, hostToken, r => r.players.some(p => p.name === 'Chloé' && p.present));
    lateSocket.disconnect();
    const reconnect = await connect(roomId, late.body.token);
    await waitFor(roomId, hostToken, r => r.players.find(p => p.name === 'Chloé')?.present === true);
    expect((await event(reconnect, 'end')).ok).toBe(false);
    expect((await event(host, 'end')).ok).toBe(true);
    expect((await request(`/api/rooms/${roomId}`, 'GET', undefined, hostToken)).status).toBe(404);
  }, 30000);
});
