import Redis from 'ioredis';
import type { Room } from '../shared/types.js';

const redisUrl = process.env.REDIS_URL;
if (process.env.NODE_ENV === 'production' && !redisUrl) throw new Error('REDIS_URL est obligatoire en production');
export const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 2 }) : undefined;
const memory = new Map<string, Room>();
const files = new Map<string, { data: Buffer; mime: string; expiresAt: number }>();
const key = (id: string) => `blackops:room:${id}`;
const photoKey = (roomId: string, id: string) => `blackops:photo:${roomId}:${id}`;

export async function getRoom(id: string): Promise<Room | undefined> {
  const raw = redis ? await redis.get(key(id)) : undefined;
  const room = raw ? JSON.parse(raw) as Room : memory.get(id);
  if (!room) return undefined;
  if (Date.now() >= room.expiresAt || room.phase === 'ended') { await deleteRoom(id, room); return undefined; }
  return room;
}
export async function saveRoom(room: Room) {
  if (redis) await redis.set(key(room.id), JSON.stringify(room), 'PXAT', room.expiresAt);
  else memory.set(room.id, room);
}
export async function deleteRoom(id: string, room?: Room) {
  if (redis) {
    const keys = room?.photos.map(p => photoKey(id, p.id)) ?? [];
    await redis.del(key(id), ...keys);
  } else {
    memory.delete(id);
    for (const p of room?.photos ?? []) files.delete(photoKey(id, p.id));
  }
}
export async function savePhoto(room: Room, id: string, data: Buffer, mime: string) {
  const value = Buffer.concat([Buffer.from(mime + '\n'), data]);
  if (redis) await redis.set(photoKey(room.id, id), value, 'PXAT', room.expiresAt);
  else files.set(photoKey(room.id, id), { data, mime, expiresAt: room.expiresAt });
}
export async function getPhoto(roomId: string, id: string) {
  if (redis) {
    const raw = await redis.getBuffer(photoKey(roomId, id));
    if (!raw) return undefined;
    const split = raw.indexOf(10);
    return { mime: raw.subarray(0, split).toString(), data: raw.subarray(split + 1) };
  }
  const file = files.get(photoKey(roomId, id));
  return file && file.expiresAt > Date.now() ? file : undefined;
}
export async function deletePhoto(roomId: string, id: string) {
  if (redis) await redis.del(photoKey(roomId, id)); else files.delete(photoKey(roomId, id));
}
