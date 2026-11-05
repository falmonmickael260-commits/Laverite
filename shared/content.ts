import type { Content } from './types.js';
import data from './content.generated.json' with { type: 'json' };
import actions from './actions.json' with { type: 'json' };
import { confessions } from './truths/confessions.js';
import { secrets } from './truths/secrets.js';
import { anecdotes } from './truths/anecdotes.js';
import { people } from './truths/people.js';
import { friendships } from './truths/friendships.js';
import { personality } from './truths/personality.js';
import { unexpected } from './truths/unexpected.js';

const truthGroups = [
  { category: 'Confessions et questions embarrassantes', prompts: confessions, count: 200 },
  { category: 'Secrets, mensonges et grosses bêtises', prompts: secrets, count: 150 },
  { category: 'Anecdotes personnelles et souvenirs', prompts: anecdotes, count: 150 },
  { category: 'Attirance, curiosité et personnes présentes', prompts: people, count: 200 },
  { category: 'Amitiés, affinités et premières impressions', prompts: friendships, count: 100 },
  { category: 'Personnalité, habitudes et caractère', prompts: personality, count: 100 },
  { category: 'Questions inattendues et provocantes', prompts: unexpected, count: 100 }
] as const;

const truths: Content[] = truthGroups.flatMap((group, categoryIndex) => {
  let index = 0;
  const rows = ([1, 2, 3] as const).flatMap(level => group.prompts[level].map(text => ({
    id: `t-${categoryIndex + 1}-${String(++index).padStart(3, '0')}`,
    kind: 'truth' as const,
    category: group.category,
    level,
    text,
    photo: false,
    gift: false,
    minTurn: categoryIndex === 3 && /(?:réponse|anecdote|confession|histoire|réplique|remarque|échange|conversation) (?:entendue?|racontée?|de ce soir)|depuis le début de la soirée|depuis ton arrivée|après avoir|tour de quelqu’un/i.test(text) ? 3 : undefined
  })));
  if (rows.length !== group.count) throw new Error(`Contenu insuffisant : ${group.category} (${rows.length}/${group.count})`);
  return rows;
});

export const generatedContents: Content[] = [...truths, ...(actions as Content[])];
if (process.env.CONTENT_EXPORT !== '1' && JSON.stringify(generatedContents) !== JSON.stringify(data)) {
  throw new Error('Catalogue JSON désynchronisé : exécuter npm run export:content');
}
export const contents: Content[] = data as Content[];
export const expectedCounts = [
  ...truthGroups.map(({ category, count }) => ({ category, kind: 'truth' as const, count })),
  ...[
    ['Défis drôles et embarrassants', 100],
    ['Défis photo et objets', 100],
    ['Imitations et improvisations', 100],
    ['Découverte de la personnalité', 75],
    ['Missions spéciales BLACKOPS', 75],
    ['Créativité et cadeaux virtuels', 50]
  ].map(([category, count]) => ({ category: String(category), kind: 'action' as const, count: Number(count) }))
];
