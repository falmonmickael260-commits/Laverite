import { describe, expect, it } from 'vitest';
import { addPlayer, createRoom, nextPlayer, normalizeRoomCode, pickContent, publicRoom } from '../server/engine.js';
import { deleteRoom, getRoom, getRoomByCode, reserveRoomCode, saveRoom } from '../server/store.js';

describe('rotation et contenus', () => {
  const random = (n: number) => n - 1;
  const setup = () => {
    const room = createRoom('Hôte', '👻', 24, 'host-token');
    room.players[0].present = true;
    for (const name of ['Alice','Bob','Chloé','David']) {
      const player = addPlayer(room, name, '🦊', name);
      player.present = true;
    }
    room.phase = 'choosing';
    return room;
  };
  it('sélectionne tous les joueurs une fois par cycle et évite un doublon à la frontière', () => {
    const room = setup();
    const first = Array.from({ length: 5 }, () => nextPlayer(room, random)!.id);
    expect(new Set(first).size).toBe(5);
    expect(nextPlayer(room, random)!.id).not.toBe(first[4]);
  });
  it('retire immédiatement un joueur parti', () => {
    const room = setup();
    nextPlayer(room, random);
    const leaving = room.cycle[0];
    room.players.find(p => p.id === leaving)!.left = true;
    const rest = Array.from({ length: 4 }, () => nextPlayer(room, random)?.id);
    expect(rest).not.toContain(leaving);
  });
  it('ne répète pas un contenu avant épuisement et garde les jetons privés', () => {
    const room = setup(); room.level = 1;
    const ids = Array.from({ length: 50 }, () => pickContent(room, 'truth', random).id);
    expect(new Set(ids).size).toBe(50);
    expect(JSON.stringify(publicRoom(room))).not.toContain('host-token');
  });
  it('empêche les pseudos simultanément identiques', () => {
    const room = setup();
    expect(() => addPlayer(room, 'alice', '👻', 'other')).toThrow('déjà pris');
  });
  it('fait tourner équitablement 30 joueurs simultanés', () => {
    const room = createRoom('Hôte', '👻', 24, 'host-token');
    room.players[0].present = true;
    for (let i = 1; i < 30; i++) addPlayer(room, `Joueur ${i}`, '👻', `token-${i}`).present = true;
    const cycle = Array.from({ length: 30 }, () => nextPlayer(room, random)!.id);
    expect(new Set(cycle).size).toBe(30);
    expect(nextPlayer(room, random)!.id).not.toBe(cycle.at(-1));
  });
  it('invalide la session à expiration', async () => {
    const room = createRoom('Hôte', '👻', 1, 'host-token');
    room.expiresAt = Date.now() + 5;
    await saveRoom(room);
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(await getRoom(room.id)).toBeUndefined();
  });
  it('réserve un code court et l’invalide à la fermeture du salon', async () => {
    const room = createRoom('Hôte', '👻', 1, 'host-token');
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(normalizeRoomCode(room.code.toLowerCase())).toBe(room.code);
    expect(await reserveRoomCode(room)).toBe(true);
    await saveRoom(room);
    expect((await getRoomByCode(room.code))?.id).toBe(room.id);
    await deleteRoom(room.id, room);
    expect(await getRoomByCode(room.code)).toBeUndefined();
  });
});
