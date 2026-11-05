import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, type Socket } from 'socket.io-client';
import type { PublicRoom, Photo } from '../../shared/types';
import './style.css';
import './code.css';

type Identity = { roomId: string; token: string; playerId: string };
const STORAGE = 'blackops-identity';
const avatars = ['🦊','🐼','🐯','🐸','🦋','🐺','🦄','🐻','🐱','🐙','👻','😎'];
const emojis = ['😂','😱','👀','❤️','👏','🤯'];
const giftTypes = ['👑','🌹','💐','🏆','🥇','❤️','🍅','🎁'];
const api = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(path, options);
  const json = await response.json();
  if (!response.ok || !json.ok) throw new Error(json.error || 'Erreur réseau');
  return json;
};
const jsonOptions = (data: object) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

function PhotoCard({ roomId, token, photo, own, onDelete, onReaction }: { roomId: string; token: string; photo: Photo; own: boolean; onDelete: () => void; onReaction: (emoji: string) => void }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true; let url = '';
    fetch(`/api/rooms/${roomId}/photos/${photo.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error(); return r.blob(); })
      .then(blob => { url = URL.createObjectURL(blob); if (alive) setSrc(url); else URL.revokeObjectURL(url); })
      .catch(() => undefined);
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [roomId, token, photo.id]);
  return <div className="photo-card">
    {src ? <img src={src} alt="Photo partagée pour le défi" /> : <div className="photo-loading">Chargement de la photo…</div>}
    <div className="photo-footer">
      <div className="photo-reactions">{emojis.map(e => <button key={e} onClick={() => onReaction(e)} aria-label={`Réagir ${e}`}>{e} {photo.reactions[e] || ''}</button>)}</div>
      {own && <button className="text-button" onClick={onDelete}>Supprimer</button>}
    </div>
  </div>;
}

function App() {
  const initial = useMemo(() => { try { return JSON.parse(localStorage.getItem(STORAGE) || 'null') as Identity | null; } catch { return null; } }, []);
  const [identity, setIdentity] = useState<Identity | null>(initial);
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('👻');
  const [entryMode, setEntryMode] = useState<'create' | 'code' | 'link' | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [hours, setHours] = useState(24);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [reduced, setReduced] = useState(localStorage.getItem('blackops-reduced') === 'yes');
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [rolling, setRolling] = useState('');
  const [giftTarget, setGiftTarget] = useState('');
  const [giftType, setGiftType] = useState('👑');
  const [toast, setToast] = useState('');
  const [seconds, setSeconds] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const lastEvent = useRef('');
  const audioRef = useRef<AudioContext | null>(null);
  const params = new URLSearchParams(location.search);
  const inviteId = params.get('room');
  const me = room?.players.find(p => p.id === identity?.playerId);
  const isHost = !!room && room.hostId === identity?.playerId;
  const isSelected = !!room && room.selectedId === identity?.playerId;
  const selected = room?.players.find(p => p.id === room.selectedId);
  const active = room?.players.filter(p => p.present && !p.left) || [];
  const latestGift = room?.gifts.at(-1);

  useEffect(() => {
    if (!identity) return;
    let active = true;
    api(`/api/rooms/${identity.roomId}`, { headers: { Authorization: `Bearer ${identity.token}` } })
      .then(data => { if (active) setRoom(data.room); })
      .catch(() => { if (active) { localStorage.removeItem(STORAGE); setIdentity(null); setRoom(null); } });
    const socket = io({ auth: { roomId: identity.roomId, token: identity.token }, reconnection: true });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (e: Error) => { setError(e.message); setConnected(false); });
    socket.on('room', (next: PublicRoom) => { if (active) setRoom(next); });
    return () => { active = false; socket.disconnect(); socketRef.current = null; };
  }, [identity]);

  useEffect(() => {
    if (!room || room.phase !== 'drawing' || reduced) return;
    const names = room.players.filter(p => p.present && !p.left).map(p => p.name);
    if (!names.length) return;
    let i = 0;
    const interval = setInterval(() => { setRolling(names[i++ % names.length]); }, 85);
    return () => clearInterval(interval);
  }, [room?.phase, room?.turnNumber, room?.players.length, reduced]);

  useEffect(() => {
    if (!room) return;
    const event = `${room.turnNumber}:${room.phase}:${room.prompt?.id || ''}:${room.gifts.at(-1)?.id || ''}`;
    if (lastEvent.current && event !== lastEvent.current && soundEnabled && room.sound && room.phase !== 'drawing') {
      try {
        const audio = audioRef.current || new AudioContext();
        audioRef.current = audio;
        const oscillator = audio.createOscillator(); const gain = audio.createGain();
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(room.phase === 'prompt' ? 540 : 390, audio.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(780, audio.currentTime + .16);
        gain.gain.setValueAtTime(.06, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .25);
        oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .26);
      } catch { /* optional audio */ }
    }
    lastEvent.current = event;
  }, [room, soundEnabled]);

  useEffect(() => {
    if (seconds === null || seconds <= 0) return;
    const timer = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const url = entryMode === 'create' ? '/api/rooms' : entryMode === 'code' ? '/api/rooms/join-code' : `/api/rooms/${inviteId}/join`;
      const data = await api(url, jsonOptions({ name, avatar, ...(entryMode === 'create' ? { hours } : {}), ...(entryMode === 'code' ? { code: roomCode } : {}) }));
      const next = { roomId: data.roomId, token: data.token, playerId: data.playerId };
      localStorage.setItem(STORAGE, JSON.stringify(next)); setIdentity(next);
      history.replaceState(null, '', `/?room=${next.roomId}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const emit = (event: string, data: object = {}) => {
    socketRef.current?.timeout(7000).emit(event, data, (err: Error | null, response: { ok: boolean; error?: string }) => {
      if (err) setError('Connexion momentanément indisponible');
      else if (!response?.ok) setError(response?.error || 'Action refusée');
      else setError('');
    });
  };
  const leave = () => { emit('leave'); localStorage.removeItem(STORAGE); setIdentity(null); setRoom(null); history.replaceState(null, '', '/'); };
  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/?room=${identity?.roomId}`); setToast('Lien copié, prêt à partager'); }
    catch { setToast('Copie indisponible sur cet appareil'); }
  };
  const copyCode = async () => {
    if (!room?.code) return;
    try { await navigator.clipboard.writeText(room.code); setToast('Code copié, prêt à partager'); }
    catch { setToast('Copie indisponible sur cet appareil'); }
  };
  const upload = async (file?: File) => {
    if (!file || !identity) return;
    setBusy(true); setError('');
    try {
      let image: Blob = file;
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 3000000) {
        const bitmap = await createImageBitmap(file);
        const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
        canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Conversion de la photo impossible')), 'image/jpeg', .8));
      }
      if (image.size > 3000000) throw new Error('Photo trop volumineuse (3 Mo maximum)');
      await api(`/api/rooms/${identity.roomId}/photos`, { method: 'POST', headers: { Authorization: `Bearer ${identity.token}`, 'Content-Type': image.type }, body: image });
      setToast('Photo partagée avec le salon');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const deleteImage = async (id: string) => {
    if (!identity) return;
    try { await api(`/api/rooms/${identity.roomId}/photos/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${identity.token}` } }); }
    catch (e) { setError((e as Error).message); }
  };
  const toggleSound = () => {
    if (!soundEnabled) {
      audioRef.current ||= new AudioContext();
      audioRef.current.resume().catch(() => undefined);
    }
    setSoundEnabled(!soundEnabled);
  };

  if (!identity) return <main className="landing">
    <div className="orb orb-one" /><div className="orb orb-two" />
    <div className="landing-shell">
      <div className="topline"><span className="brand-mark">✦</span><span>BLACKOPS</span><span className="edition">ÉDITION PRIVÉE</span></div>
      <div className="hero">
        <div className="eyebrow"><span className="dot" /> UNE SOIRÉE. MILLE HISTOIRES.</div>
        <h1>ACTION <em>OU</em><br /><span>VÉRITÉ</span></h1>
        <p className="tagline">Ce soir, les secrets ne sont plus à l’abri.</p>
        <p className="hero-copy">Des défis, des confidences et des rencontres inattendues. Le sort choisit. À vous de jouer.</p>
        {!entryMode ? <div className="hero-actions">
          <button className="primary-button" onClick={() => setEntryMode(inviteId ? 'link' : 'create')}>{inviteId ? 'REJOINDRE LA SOIRÉE' : 'CRÉER UNE SOIRÉE'} <span>↗</span></button>
          {!inviteId && <button className="code-entry-button" onClick={() => setEntryMode('code')}>J’AI UN CODE DE SALON <span>→</span></button>}
          {!inviteId && <p className="microcopy">Créez un salon ou rejoignez celui d’un ami avec son code.</p>}
        </div> : <section className="entry-panel">
          <div className="panel-kicker">{entryMode === 'link' ? 'VOTRE INVITATION' : entryMode === 'code' ? 'CODE D’ACCÈS' : 'NOUVELLE SOIRÉE'}</div>
          <h2>{entryMode === 'create' ? 'Lancez la soirée' : 'Entrez dans le salon'}</h2>
          {entryMode === 'code' && <label>Code du salon<input className="code-input" value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 6))} maxLength={6} autoCapitalize="characters" autoComplete="off" placeholder="ABC234" autoFocus /></label>}
          <label>Votre prénom ou pseudo<input value={name} onChange={e => setName(e.target.value)} maxLength={24} placeholder="Comment doit-on vous appeler ?" autoFocus={entryMode !== 'code'} /></label>
          <div className="field-label">Choisissez votre avatar</div>
          <div className="avatar-picker">{avatars.map(a => <button key={a} className={avatar === a ? 'chosen' : ''} onClick={() => setAvatar(a)} aria-label={`Avatar ${a}`}>{a}</button>)}</div>
          {entryMode === 'create' && <label>Durée du salon<select value={hours} onChange={e => setHours(Number(e.target.value))}><option value={6}>6 heures</option><option value={12}>12 heures</option><option value={24}>24 heures</option><option value={48}>48 heures</option><option value={72}>72 heures</option></select></label>}
          {error && <div className="error" role="alert">{error}</div>}
          <button className="primary-button wide" disabled={busy || name.trim().length < 2 || (entryMode === 'code' && roomCode.length !== 6)} onClick={submit}>{busy ? 'UN INSTANT…' : entryMode === 'create' ? 'CRÉER MON SALON' : 'ENTRER DANS LE SALON'} <span>↗</span></button>
          <button className="back-button" onClick={() => { setEntryMode(null); setError(''); }}>← Retour</button>
        </section>}
      </div>
      <div className="hero-footer"><span>✦ TIRAGE ÉQUITABLE</span><span>✦ VÉRITÉS INATTENDUES</span><span>✦ DÉFIS À DISTANCE</span></div>
    </div>
  </main>;

  if (!room) return <main className="loading"><span className="brand-mark">✦</span><p>Connexion au salon…</p>{error && <div className="error">{error}</div>}</main>;

  const currentPhotos = room.photos.filter(p => p.turnNumber === room.turnNumber);
  return <main className={`game ${reduced ? 'reduced' : ''}`}>
    <div className="ambient ambient-left" /><div className="ambient ambient-right" />
    <header className="game-header">
      <div className="header-brand"><span className="brand-mark">✦</span><div><strong>BLACKOPS</strong><small>ACTION OU VÉRITÉ</small></div></div>
      <div className="header-actions"><span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'EN DIRECT' : 'RECONNEXION'}</span><button className="icon-button" onClick={copyInvite} title="Inviter">↗</button><button className="icon-button" onClick={leave} title="Quitter">⎋</button></div>
    </header>
    <div className="game-layout">
      <aside className="side-panel">
        <div className="side-head"><span>LE SALON</span><strong>{active.length} EN LIGNE</strong></div>
        {room.code && <div className="room-code"><span>CODE DU SALON</span><strong>{room.code}</strong><button onClick={copyCode}>COPIER LE CODE ↗</button></div>}
        <div className="participants">{room.players.filter(p => !p.left).map(p => <div className={`participant ${p.id === room.selectedId ? 'current' : ''} ${p.present ? '' : 'away'}`} key={p.id}>
          <span className="participant-avatar">{p.avatar}</span><span className="participant-name">{p.name}{p.id === room.hostId && <small> ★</small>}</span><span className="participant-status">{p.id === room.selectedId ? 'À TOI' : p.present ? '●' : '○'}</span>
          {isHost && p.id !== room.hostId && <button className="remove-button" onClick={() => emit('remove', { playerId: p.id })} title={`Retirer ${p.name}`}>×</button>}
        </div>)}</div>
        <button className="invite-button" onClick={copyInvite}><span>＋</span> COPIER LE LIEN D’INVITATION</button>
        <div className="stats"><div><strong>{room.truthCount}</strong><span>VÉRITÉS<br />RÉVÉLÉES</span></div><div><strong>{room.actionCount}</strong><span>ACTIONS<br />RÉALISÉES</span></div></div>
        <div className="settings-row"><button onClick={() => { setReduced(!reduced); localStorage.setItem('blackops-reduced', reduced ? 'no' : 'yes'); }}>{reduced ? '✓' : '○'} Animations réduites</button><button onClick={toggleSound}>{soundEnabled ? '♫' : '♪'} Son local</button></div>
      </aside>
      <section className="stage">
        <div className="stage-top"><span>SOIRÉE PRIVÉE · TOUR {room.turnNumber || '00'}</span><span>NIVEAU {room.level} / 3</span></div>
        {room.phase === 'lobby' && <div className="stage-content lobby-card">
          <div className="stage-emblem">✦</div><div className="stage-kicker">LE CALME AVANT LES RÉVÉLATIONS</div><h2>La soirée se prépare<span>.</span></h2>
          <p>Partagez le code avec vos invités. Ils peuvent aussi rejoindre une partie déjà commencée.</p>
          {room.code && <button className="lobby-code" onClick={copyCode}><span>CODE DU SALON</span><strong>{room.code}</strong><small>TOUCHER POUR COPIER ↗</small></button>}
          <div className="lobby-count"><span>{active.length}</span> participant{active.length > 1 ? 's' : ''} dans le salon</div>
          {isHost ? <button className="primary-button" disabled={active.length < 1} onClick={() => emit('start')}>LANCER LA SOIRÉE <span>→</span></button> : <div className="waiting">EN ATTENTE DE L’ORGANISATEUR <span className="pulse">●</span></div>}
        </div>}
        {room.phase === 'drawing' && <div className="stage-content draw-card">
          <div className="orbit orbit-a" /><div className="orbit orbit-b" />
          <div className="stage-kicker">LE HASARD PREND LA MAIN</div><h2>Qui sera<br /><em>le prochain ?</em></h2>
          <div className="roll-window"><span>{reduced ? selected?.name : rolling || selected?.name || '…'}</span></div>
          <div className="draw-bars"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><p>Le sort choisit parmi les participants actifs</p>
        </div>}
        {room.phase === 'choosing' && <div className="stage-content choice-card">
          <div className="stage-kicker">LE SORT A CHOISI…</div><h2 className="reveal-name">{selected?.name.toUpperCase()}<span> !</span></h2>
          <p>{isSelected ? 'À toi de choisir la suite.' : `Au tour de ${selected?.name} de choisir.`}</p>
          <div className="choice-grid"><button className="choice truth" disabled={!isSelected} onClick={() => emit('choose', { kind: 'truth' })}><span className="choice-symbol">✦</span><strong>VÉRITÉ</strong><small>OSE NOUS RACONTER</small><b>↗</b></button><button className="choice action" disabled={!isSelected} onClick={() => emit('choose', { kind: 'action' })}><span className="choice-symbol">⚡</span><strong>ACTION</strong><small>RELÈVE LE DÉFI</small><b>↗</b></button></div>
          {isSelected && <button className="pass-link" onClick={() => emit('pass')}>Je passe ce tour</button>}
        </div>}
        {room.phase === 'prompt' && <div className="stage-content prompt-card">
          <div className={`prompt-badge ${room.kind}`}>{room.prompt?.special ? '✦ ' + room.prompt.special : room.kind === 'truth' ? '✦ VÉRITÉ' : '⚡ ACTION'}</div>
          <div className="player-pill"><span>{selected?.avatar}</span> {selected?.name}</div>
          <h2 key={room.prompt?.id}>{room.prompt?.text}</h2>
          <div className="prompt-meta"><span>{room.prompt?.category}</span><span>● NIVEAU {room.prompt?.level}</span></div>
          {room.prompt?.timer && <div className="timer"><button onClick={() => setSeconds(room.prompt?.timer || 60)}>Lancer le chrono facultatif</button>{seconds !== null && <strong>{seconds}s</strong>}</div>}
          {isSelected && room.kind === 'action' && <label className="upload-button">📷 PARTAGER UNE PHOTO<input type="file" accept="image/*" disabled={busy} onChange={e => upload(e.target.files?.[0])} /></label>}
          <div className="prompt-actions">{isSelected ? <><button className="primary-button" onClick={() => emit('finish')}>{room.kind === 'truth' ? 'J’AI RÉPONDU' : 'DÉFI TERMINÉ'} <span>✓</span></button><button className="secondary-button" onClick={() => emit('pass')}>JE PASSE</button><button className="pass-link" onClick={() => emit('finish')}>Terminer mon tour</button></> : <span>Laissons {selected?.name} raconter son histoire…</span>}</div>
          {currentPhotos.map(photo => <PhotoCard key={photo.id} roomId={identity.roomId} token={identity.token} photo={photo} own={photo.authorId === identity.playerId} onDelete={() => deleteImage(photo.id)} onReaction={emoji => emit('reaction', { emoji, photoId: photo.id })} />)}
        </div>}
        {room.phase === 'paused' && <div className="stage-content pause-card"><div className="stage-emblem">Ⅱ</div><div className="stage-kicker">ENTRACTE</div><h2>On reprend<br /><em>dans un instant.</em></h2><p>Les histoires peuvent attendre. Le salon reste ouvert.</p>{isHost && <button className="primary-button" onClick={() => emit('resume')}>REPRENDRE <span>→</span></button>}</div>}
        {room.phase === 'ended' && <div className="stage-content pause-card"><div className="stage-emblem">✦</div><h2>La soirée est terminée.</h2><p>Merci d’avoir joué.</p></div>}
        {room.phase === 'prompt' && <div className="reaction-bar"><span>RÉAGIR EN DIRECT</span><div>{emojis.map(emoji => <button key={emoji} onClick={() => emit('reaction', { emoji })} aria-label={`Réagir ${emoji}`}>{emoji}</button>)}</div></div>}
      </section>
      <aside className="right-panel">
        <div className="panel-title">EN DIRECT <span>✦</span></div>
        <p className="right-intro">Les réactions font partie de l’histoire.</p>
        <div className="reaction-stream">{room.reactions.slice(-8).reverse().map(r => <div key={r.id}><span>{r.emoji}</span><strong>{room.players.find(p => p.id === r.playerId)?.name || 'Un joueur'}</strong> a réagi</div>)}</div>
        {latestGift && <div className="latest-gift" key={latestGift.id}><span>{latestGift.type}</span><p><strong>{room.players.find(p => p.id === latestGift.fromId)?.name}</strong> a offert un cadeau à <strong>{room.players.find(p => p.id === latestGift.toId)?.name}</strong></p></div>}
        {room.phase === 'prompt' && <div className="gift-box"><div className="panel-title">OFFRIR UN CADEAU</div><select value={giftTarget} onChange={e => setGiftTarget(e.target.value)}><option value="">À qui ?</option>{room.players.filter(p => !p.left && p.id !== identity.playerId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="gift-grid">{giftTypes.map(g => <button className={giftType === g ? 'active' : ''} key={g} onClick={() => setGiftType(g)}>{g}</button>)}</div><button className="gift-send" disabled={!giftTarget} onClick={() => emit('gift', { type: giftType, toId: giftTarget })}>OFFRIR <span>↗</span></button></div>}
        {isHost && <div className="host-box"><div className="panel-title">ORGANISATEUR <span>★</span></div><label>Intensité<select value={room.level} onChange={e => emit('settings', { level: Number(e.target.value) })}><option value={1}>1 · Premières confidences</option><option value={2}>2 · Vérités piquantes</option><option value={3}>3 · Dossiers BLACKOPS</option></select></label><button onClick={() => emit('settings', { sound: !room.sound })}>{room.sound ? '✓' : '○'} Sons autorisés</button><button onClick={() => emit('settings', { surprises: !room.surprises })}>{room.surprises ? '✓' : '○'} Missions surprises</button><div className="host-controls">{room.phase === 'paused' ? <button onClick={() => emit('resume')}>Reprendre</button> : room.phase !== 'lobby' && <button onClick={() => emit('pause')}>Pause</button>}<button className="danger" onClick={() => { if (window.confirm('Fermer définitivement ce salon ?')) emit('end'); }}>Terminer</button></div></div>}
      </aside>
    </div>
    {error && <div className="floating-error" role="alert" onClick={() => setError('')}>{error} ×</div>}
    {toast && <div className="toast">{toast}</div>}
    <footer className="game-footer">BLACKOPS <span>✦</span> LA SOIRÉE OÙ LES VÉRITÉS ÉCLATENT</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
