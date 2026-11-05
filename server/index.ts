import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import type { Room, Player, Phase } from '../shared/types.js';
import { addPlayer, addToCycle, createRoom, eligible, newRoomCode, nextPlayer, normalizeName, normalizeRoomCode, pickContent, publicRoom } from './engine.js';
import { deletePhoto, deleteRoom, getPhoto, getRoom, getRoomByCode, reserveRoomCode, savePhoto, saveRoom } from './store.js';

const app = express();
const http = createServer(app);
const io = new Server(http, { maxHttpBufferSize: 3000000, cors: { origin: false } });
const port = Number(process.env.PORT || 3000);
const maxUpload = Number(process.env.MAX_UPLOAD_BYTES || 3000000);
const roomLocks = new Map<string, Promise<unknown>>();
const lastReaction = new Map<string, number>();
const lastGift = new Map<string, number>();
const codeAttempts = new Map<string, { count: number; resetAt: number }>();
const tokens = () => randomBytes(32).toString('base64url');
const allowedAvatars = ['🦊','🐼','🐯','🐸','🦋','🐺','🦄','🐻','🐱','🐙','👻','😎'];
const avatarOf = (v: unknown) => allowedAvatars.includes(String(v)) ? String(v) : '👻';
const fail = (message: string) => ({ ok: false, error: message });
const success = (data: object = {}) => ({ ok: true, ...data });

async function mutate<T>(id: string, fn: (room: Room) => Promise<T> | T): Promise<T> {
  const previous = roomLocks.get(id) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(async () => {
    const room = await getRoom(id);
    if (!room) throw new Error('Salon expiré ou fermé');
    const result = await fn(room);
    if (room.phase === 'ended') await deleteRoom(id, room);
    else await saveRoom(room);
    io.to(id).emit('room', publicRoom(room));
    return result;
  });
  roomLocks.set(id, task);
  task.finally(() => { if (roomLocks.get(id) === task) roomLocks.delete(id); }).catch(() => undefined);
  return task;
}
function authenticated(room: Room, token: string) {
  const player = room.players.find(p => p.token === token && !p.left);
  if (!player) throw new Error('Accès refusé');
  return player;
}
function host(room: Room, player: Player) {
  if (player.id !== room.hostId) throw new Error('Réservé à l’organisateur');
}
function selected(room: Room, player: Player) {
  if (room.selectedId !== player.id) throw new Error('Ce tour appartient à une autre personne');
}
function scheduleReveal(id: string, at: number) {
  setTimeout(() => {
    mutate(id, room => { if (room.phase === 'drawing' && room.revealAt === at) room.phase = 'choosing'; }).catch(() => undefined);
  }, Math.max(0, at - Date.now()));
}
function draw(room: Room) {
  const player = nextPlayer(room);
  room.selectedId = player?.id;
  room.prompt = undefined;
  room.kind = undefined;
  room.reactions = [];
  if (!player) { room.phase = 'paused'; return; }
  room.turnNumber++;
  room.phase = 'drawing';
  room.revealAt = Date.now() + 3600;
  scheduleReveal(room.id, room.revealAt);
}
function endedTurn(room: Room, completed = false) {
  if (completed && room.kind === 'truth' && room.prompt) room.truthCount++;
  if (completed && room.kind === 'action' && room.prompt) room.actionCount++;
  draw(room);
}
function authFromRequest(req: express.Request) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.get('/api/health', async (_req, res) => {
  try { const { redis } = await import('./store.js'); if (redis) await redis.ping(); res.json({ ok: true }); }
  catch { res.status(503).json(fail('Stockage indisponible')); }
});
app.post('/api/rooms', async (req, res) => {
  try {
    const name = normalizeName(req.body.name);
    const hours = Number(req.body.hours || process.env.SESSION_HOURS || 24);
    if (!Number.isInteger(hours) || hours < 1 || hours > 72) throw new Error('Durée invalide');
    const token = tokens();
    const room = createRoom(name, avatarOf(req.body.avatar), hours, token);
    let reserved = false;
    for (let attempt = 0; attempt < 8 && !reserved; attempt++) {
      reserved = await reserveRoomCode(room);
      if (!reserved) room.code = newRoomCode();
    }
    if (!reserved) throw new Error('Création du code impossible, réessayez');
    try { await saveRoom(room); } catch (error) { await deleteRoom(room.id, room); throw error; }
    res.json(success({ roomId: room.id, code: room.code, token, playerId: room.hostId }));
  } catch (e) { res.status(400).json(fail((e as Error).message)); }
});
app.post('/api/rooms/join-code', async (req, res) => {
  try {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const rate = codeAttempts.get(ip);
    const nextRate = rate && rate.resetAt > now ? { count: rate.count + 1, resetAt: rate.resetAt } : { count: 1, resetAt: now + 60000 };
    codeAttempts.set(ip, nextRate);
    if (nextRate.count > 60) throw new Error('Trop de tentatives, réessayez dans une minute');
    setTimeout(() => { if (codeAttempts.get(ip)?.resetAt === nextRate.resetAt) codeAttempts.delete(ip); }, 61000).unref();
    const code = normalizeRoomCode(req.body.code);
    const name = normalizeName(req.body.name);
    const room = await getRoomByCode(code);
    if (!room) throw new Error('Salon introuvable ou expiré');
    const token = tokens();
    const player = await mutate(room.id, current => {
      if (current.code !== code) throw new Error('Salon introuvable ou expiré');
      return addPlayer(current, name, avatarOf(req.body.avatar), token);
    });
    res.json(success({ roomId: room.id, token, playerId: player.id }));
  } catch (e) { res.status(400).json(fail((e as Error).message)); }
});
app.post('/api/rooms/:id/join', async (req, res) => {
  try {
    const id = req.params.id;
    const name = normalizeName(req.body.name);
    const token = tokens();
    const player = await mutate(id, room => addPlayer(room, name, avatarOf(req.body.avatar), token));
    res.json(success({ roomId: id, token, playerId: player.id }));
  } catch (e) { res.status(400).json(fail((e as Error).message)); }
});
app.get('/api/rooms/:id', async (req, res) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room) return res.status(404).json(fail('Salon expiré ou fermé'));
    authenticated(room, authFromRequest(req));
    res.json(success({ room: publicRoom(room) }));
  } catch (e) { res.status(403).json(fail((e as Error).message)); }
});
app.post('/api/rooms/:id/photos', express.raw({ type: ['image/jpeg','image/png','image/webp'], limit: maxUpload }), async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length < 12 || req.body.length > maxUpload) throw new Error('Image invalide');
    const mime = req.headers['content-type']?.split(';')[0] || '';
    const magic = mime === 'image/png' ? req.body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      mime === 'image/jpeg' ? req.body[0] === 255 && req.body[1] === 216 :
      mime === 'image/webp' ? req.body.toString('ascii', 0, 4) === 'RIFF' && req.body.toString('ascii', 8, 12) === 'WEBP' : false;
    if (!magic) throw new Error('Format non reconnu');
    const id = randomUUID();
    await mutate(req.params.id, async room => {
      const player = authenticated(room, authFromRequest(req));
      selected(room, player);
      if (room.phase !== 'prompt' || room.kind !== 'action') throw new Error('Photo indisponible pour ce tour');
      await savePhoto(room, id, req.body, mime);
      room.photos.push({ id, authorId: player.id, createdAt: Date.now(), turnNumber: room.turnNumber, reactions: {} });
    });
    res.json(success({ id }));
  } catch (e) { res.status(400).json(fail((e as Error).message)); }
});
app.get('/api/rooms/:roomId/photos/:photoId', async (req, res) => {
  try {
    const room = await getRoom(req.params.roomId);
    if (!room) throw new Error('Salon fermé');
    authenticated(room, authFromRequest(req));
    if (!room.photos.some(p => p.id === req.params.photoId)) throw new Error('Photo introuvable');
    const photo = await getPhoto(room.id, req.params.photoId);
    if (!photo) throw new Error('Photo introuvable');
    res.set('Cache-Control', 'private, no-store').type(photo.mime).send(photo.data);
  } catch (e) { res.status(404).json(fail((e as Error).message)); }
});
app.delete('/api/rooms/:roomId/photos/:photoId', async (req, res) => {
  try {
    await mutate(req.params.roomId, async room => {
      const player = authenticated(room, authFromRequest(req));
      const photo = room.photos.find(p => p.id === req.params.photoId);
      if (!photo || photo.authorId !== player.id) throw new Error('Suppression refusée');
      await deletePhoto(room.id, photo.id);
      room.photos = room.photos.filter(p => p.id !== photo.id);
    });
    res.json(success());
  } catch (e) { res.status(403).json(fail((e as Error).message)); }
});

io.use(async (socket, next) => {
  try {
    const roomId = String(socket.handshake.auth.roomId || '');
    const token = String(socket.handshake.auth.token || '');
    const room = await getRoom(roomId);
    if (!room) throw new Error('Salon expiré ou fermé');
    const player = authenticated(room, token);
    socket.data.roomId = roomId;
    socket.data.playerId = player.id;
    socket.data.token = token;
    next();
  } catch (e) { next(new Error((e as Error).message)); }
});
io.on('connection', socket => {
  const id = socket.data.roomId as string;
  const playerId = socket.data.playerId as string;
  socket.join(id);
  mutate(id, room => {
    const player = authenticated(room, socket.data.token);
    player.present = true;
    player.lastSeen = Date.now();
    if (room.phase !== 'lobby' && room.selectedId !== player.id) addToCycle(room, player.id);
    if (room.phase === 'drawing' && room.revealAt) scheduleReveal(id, room.revealAt);
  }).catch(() => socket.disconnect(true));
  const on = (event: string, fn: (room: Room, player: Player, data: any) => void | Promise<void>) => {
    socket.on(event, (data: any, ack?: (v: object) => void) => {
      mutate(id, async room => { const player = authenticated(room, socket.data.token); await fn(room, player, data); })
        .then(() => ack?.(success())).catch(e => ack?.(fail((e as Error).message)));
    });
  };
  on('start', (room, player) => { host(room, player); if (room.phase !== 'lobby') throw new Error('Déjà commencé'); draw(room); });
  on('pause', (room, player) => { host(room, player); if (room.phase === 'paused' || room.phase === 'ended') return; room.beforePause = room.phase; room.phase = 'paused'; });
  on('resume', (room, player) => { host(room, player); if (room.phase !== 'paused') return; if (!room.selectedId || !eligible(room).some(p => p.id === room.selectedId)) draw(room); else { room.phase = room.beforePause === 'drawing' ? 'choosing' : (room.beforePause || 'choosing'); } });
  on('end', (room, player) => { host(room, player); room.phase = 'ended'; });
  on('settings', (room, player, data) => {
    host(room, player);
    if (data?.level !== undefined) { if (![1,2,3].includes(data.level)) throw new Error('Niveau invalide'); room.level = data.level; }
    if (typeof data?.sound === 'boolean') room.sound = data.sound;
    if (typeof data?.surprises === 'boolean') room.surprises = data.surprises;
  });
  on('remove', (room, player, data) => {
    host(room, player);
    const target = room.players.find(p => p.id === data?.playerId);
    if (!target || target.id === room.hostId) throw new Error('Joueur introuvable');
    target.left = true; target.present = false;
    room.cycle = room.cycle.filter(x => x !== target.id);
    if (room.selectedId === target.id && room.phase !== 'paused') endedTurn(room);
    io.in(id).fetchSockets().then(sockets => sockets.filter(s => s.data.playerId === target.id).forEach(s => s.disconnect(true)));
  });
  on('choose', (room, player, data) => {
    selected(room, player);
    if (room.phase !== 'choosing') throw new Error('Choix indisponible');
    if (data?.kind !== 'truth' && data?.kind !== 'action') throw new Error('Choix invalide');
    room.kind = data.kind;
    let special: string | undefined;
    if (room.surprises && room.turnNumber > 2 && randomInt(256) < 10) {
      special = data.kind === 'truth' ? ['DOSSIER CONFIDENTIEL','CONFESSION EXPRESS'][randomInt(2)] : ['MISSION IMPOSSIBLE','CADEAU MYSTÈRE'][randomInt(2)];
      if (special === 'CADEAU MYSTÈRE' && eligible(room).length < 2) special = undefined;
    }
    const specialCategories: Record<string, string[]> = {
      'DOSSIER CONFIDENTIEL': ['Confessions et questions embarrassantes','Secrets, mensonges et grosses bêtises'],
      'CONFESSION EXPRESS': ['Confessions et questions embarrassantes','Anecdotes personnelles et souvenirs'],
      'MISSION IMPOSSIBLE': ['Missions spéciales BLACKOPS','Imitations et improvisations'],
      'CADEAU MYSTÈRE': ['Créativité et cadeaux virtuels']
    };
    room.prompt = pickContent(room, data.kind, randomInt, special ? specialCategories[special] : undefined);
    if (special && specialCategories[special].includes(room.prompt.category)) {
      room.prompt = { ...room.prompt, special, timer: special === 'CONFESSION EXPRESS' ? 60 : room.prompt.timer };
      if (special === 'CADEAU MYSTÈRE') {
        const recipients = eligible(room).filter(p => p.id !== player.id);
        room.gifts.push({ id: randomUUID(), fromId: player.id, toId: recipients[randomInt(recipients.length)].id, type: ['👑','🌹','💐','🏆','🥇','❤️','🍅','🎁'][randomInt(8)], at: Date.now() });
      }
    }
    room.phase = 'prompt';
  });
  on('finish', (room, player) => { selected(room, player); if (room.phase !== 'prompt') throw new Error('Tour indisponible'); endedTurn(room, true); });
  on('pass', (room, player) => { selected(room, player); if (room.phase !== 'prompt' && room.phase !== 'choosing') throw new Error('Tour indisponible'); endedTurn(room); });
  on('reaction', (room, player, data) => {
    const emojis = ['😂','😱','👀','❤️','👏','🤯'];
    if (!emojis.includes(data?.emoji) || room.phase !== 'prompt') throw new Error('Réaction invalide');
    const now = Date.now();
    const rateKey = `${room.id}:${player.id}`;
    if (now - (lastReaction.get(rateKey) || 0) < 1200) throw new Error('Patiente un instant');
    const photo = data?.photoId ? room.photos.find(p => p.id === data.photoId) : undefined;
    if (data?.photoId && !photo) throw new Error('Photo introuvable');
    lastReaction.set(rateKey, now);
    setTimeout(() => { if (lastReaction.get(rateKey) === now) lastReaction.delete(rateKey); }, 1500);
    room.reactions.push({ id: randomUUID(), playerId: player.id, emoji: data.emoji, at: now, photoId: photo?.id });
    room.reactions = room.reactions.slice(-24);
    if (photo) photo.reactions[data.emoji] = (photo.reactions[data.emoji] || 0) + 1;
  });
  on('gift', (room, player, data) => {
    const types = ['👑','🌹','💐','🏆','🥇','❤️','🍅','🎁'];
    if (!types.includes(data?.type) || room.phase !== 'prompt') throw new Error('Cadeau indisponible');
    const to = room.players.find(p => p.id === data?.toId && !p.left);
    if (!to) throw new Error('Destinataire introuvable');
    const now = Date.now();
    const rateKey = `${room.id}:${player.id}`;
    if (now - (lastGift.get(rateKey) || 0) < 5000) throw new Error('Patiente un instant');
    lastGift.set(rateKey, now);
    setTimeout(() => { if (lastGift.get(rateKey) === now) lastGift.delete(rateKey); }, 5500);
    room.gifts.push({ id: randomUUID(), fromId: player.id, toId: to.id, type: data.type, at: now });
    room.gifts = room.gifts.slice(-20);
  });
  on('leave', (room, player) => {
    player.left = true; player.present = false;
    room.cycle = room.cycle.filter(x => x !== player.id);
    if (room.selectedId === player.id && room.phase !== 'paused') endedTurn(room);
    if (player.id === room.hostId) {
      const successor = eligible(room)[0];
      if (successor) room.hostId = successor.id; else room.phase = 'ended';
    }
    socket.disconnect(true);
  });
  socket.on('disconnect', async () => {
    const disconnectedAt = Date.now();
    const peers = await io.in(id).fetchSockets();
    if (peers.some(peer => peer.data.playerId === playerId)) return;
    mutate(id, room => {
      const player = room.players.find(p => p.id === playerId);
      if (!player || player.left) return;
      if (player.lastSeen > disconnectedAt) return;
      player.present = false; player.lastSeen = Date.now();
      room.cycle = room.cycle.filter(x => x !== playerId);
      if (room.selectedId === playerId && room.phase !== 'paused') {
        const at = player.lastSeen;
        setTimeout(() => mutate(id, r => {
          const p = r.players.find(x => x.id === playerId);
          if (p && !p.present && p.lastSeen === at && r.selectedId === playerId && r.phase !== 'paused') endedTurn(r);
        }).catch(() => undefined), 15000);
      }
    }).catch(() => undefined);
  });
});

const dist = join(dirname(fileURLToPath(import.meta.url)), '../dist');
app.use(express.static(dist));
app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
http.listen(port, '0.0.0.0', () => console.log(`BLACKOPS sur :${port}`));
