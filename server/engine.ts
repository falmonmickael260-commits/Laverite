import { randomInt, randomUUID } from 'node:crypto';
import type { Content, Kind, Room, Player, PublicRoom } from '../shared/types.js';
import { contents } from '../shared/content.js';

export function shuffle<T>(items: T[], random = randomInt): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export const eligible = (room: Room) => room.players.filter(p => !p.left && p.present);
export function nextPlayer(room: Room, random = randomInt): Player | undefined {
  const ids = eligible(room).map(p => p.id);
  if (!ids.length) return undefined;
  room.cycle = room.cycle.filter(id => ids.includes(id));
  if (!room.cycle.length) {
    room.cycle = shuffle(ids, random);
    if (room.cycle.length > 1 && room.cycle[0] === room.lastSelected) {
      const swap = 1 + random(room.cycle.length - 1);
      [room.cycle[0], room.cycle[swap]] = [room.cycle[swap], room.cycle[0]];
    }
  }
  const id = room.cycle.shift()!;
  room.lastSelected = id;
  return room.players.find(p => p.id === id);
}
export function addToCycle(room: Room, id: string, random = randomInt) {
  if (room.phase === 'lobby' || room.cycle.includes(id)) return;
  const at = random(room.cycle.length + 1);
  room.cycle.splice(at, 0, id);
}
export function pickContent(room: Room, kind: Kind, random = randomInt, preferredCategories?: string[]): Content {
  const used = kind === 'truth' ? room.usedTruths : room.usedActions;
  let pool = contents.filter(c => c.kind === kind && c.level <= room.level && !used.includes(c.id));
  if (!pool.length) {
    used.length = 0;
    pool = contents.filter(c => c.kind === kind && c.level <= room.level);
  }
  if (preferredCategories?.length) {
    const preferred = pool.filter(c => preferredCategories.includes(c.category));
    if (preferred.length) pool = preferred;
  }
  const varied = pool.filter(c => c.category !== room.lastCategory);
  const choices = varied.length ? varied : pool;
  const picked = choices[random(choices.length)];
  used.push(picked.id);
  room.lastCategory = picked.category;
  return picked;
}
export function publicRoom(room: Room): PublicRoom {
  return { ...room, players: room.players.map(({ token: _token, ...player }) => player) };
}
export function createRoom(hostName: string, avatar: string, durationHours: number, token: string): Room {
  const now = Date.now();
  const host: Player = { id: randomUUID(), name: hostName, avatar, present: false, lastSeen: now, left: false, token };
  return { id: randomUUID(), hostId: host.id, createdAt: now, expiresAt: now + durationHours * 3600000,
    phase: 'lobby', players: [host], cycle: [], usedTruths: [], usedActions: [], truthCount: 0,
    actionCount: 0, level: 1, sound: false, surprises: true, photos: [], gifts: [], reactions: [], turnNumber: 0 };
}
export function normalizeName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Pseudo invalide');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 24 || /[<>\r\n]/.test(name)) throw new Error('Pseudo de 2 à 24 caractères requis');
  return name;
}
export function addPlayer(room: Room, name: string, avatar: string, token: string) {
  if (room.players.some(p => !p.left && p.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) throw new Error('Ce pseudo est déjà pris');
  const player: Player = { id: randomUUID(), name, avatar, present: false, lastSeen: Date.now(), left: false, token };
  room.players.push(player);
  addToCycle(room, player.id);
  return player;
}
