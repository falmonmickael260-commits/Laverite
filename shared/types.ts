export type Kind = 'truth' | 'action';
export type Phase = 'lobby' | 'drawing' | 'choosing' | 'prompt' | 'paused' | 'ended';
export type Content = { id: string; kind: Kind; category: string; level: 1 | 2 | 3; text: string; photo?: boolean; gift?: boolean; timer?: number; special?: string };
export type Player = { id: string; name: string; avatar: string; present: boolean; lastSeen: number; left: boolean; token: string };
export type Photo = { id: string; authorId: string; createdAt: number; turnNumber: number; reactions: Record<string, number> };
export type Gift = { id: string; fromId: string; toId: string; type: string; at: number };
export type Reaction = { id: string; playerId: string; emoji: string; at: number; photoId?: string };
export type Room = {
  id: string; code: string; hostId: string; createdAt: number; expiresAt: number; phase: Phase; beforePause?: Phase;
  players: Player[]; cycle: string[]; lastSelected?: string; selectedId?: string; revealAt?: number;
  kind?: Kind; prompt?: Content; usedTruths: string[]; usedActions: string[]; lastCategory?: string;
  truthCount: number; actionCount: number; level: 1 | 2 | 3; sound: boolean; surprises: boolean;
  photos: Photo[]; gifts: Gift[]; reactions: Reaction[]; turnNumber: number;
};
export type PublicRoom = Omit<Room, 'players'> & { players: Omit<Player, 'token'>[] };
