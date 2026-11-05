import { contents, expectedCounts } from '../shared/content.js';

const errors: string[] = [];
const normalized = new Map<string, string>();
const ids = new Set<string>();
const shingles = (value: string) => {
  const words = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/);
  return new Set(Array.from({ length: Math.max(0, words.length - 2) }, (_, i) => words.slice(i, i + 3).join(' ')));
};
const forbidden = [
  { pattern: /\bfamille\b/i, reason: 'mot interdit' },
  { pattern: /\b(sexe|sexuel|sexuelle|nudit[eé]|d[eé]shabille|embrasse|baiser)\b/i, reason: 'contenu sexuel' },
  { pattern: /\b(adresse|num[eé]ro de t[eé]l[eé]phone|mot de passe|carte bancaire|dossier m[eé]dical)\b/i, reason: 'information sensible' },
  { pattern: /\b(ach[eè]te|paie|d[eé]pense|conduis|saute par la fen[eê]tre|bouscule|frappe quelqu’un)\b/i, reason: 'défi dangereux ou payant' }
];
for (const row of contents) {
  if (ids.has(row.id)) errors.push(`Identifiant dupliqué : ${row.id}`);
  ids.add(row.id);
  if (!row.text.trim()) errors.push(`Contenu vide : ${row.id}`);
  if (!row.category || ![1,2,3].includes(row.level)) errors.push(`Métadonnées invalides : ${row.id}`);
  const key = row.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (normalized.has(key)) errors.push(`Répétition exacte : ${normalized.get(key)} et ${row.id}`);
  normalized.set(key, row.id);
  for (const rule of forbidden) if (rule.pattern.test(row.text)) errors.push(`${rule.reason} : ${row.id}`);
}
for (const spec of expectedCounts) {
  const group = contents.filter(row => row.kind === spec.kind && row.category === spec.category);
  const actual = group.length;
  if (actual !== spec.count) errors.push(`${spec.category}: ${actual}/${spec.count}`);
  const sets = group.map(row => shingles(row.text));
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const common = [...sets[i]].filter(part => sets[j].has(part)).length;
    const score = common / (sets[i].size + sets[j].size - common || 1);
    if (score >= .78) errors.push(`Formulations trop proches : ${group[i].id} et ${group[j].id} (${score.toFixed(2)})`);
  }
}
for (const [kind, min] of [['truth', 1000], ['action', 500]] as const) {
  const actual = contents.filter(row => row.kind === kind).length;
  if (actual < min) errors.push(`${kind}: ${actual}/${min}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Contenus valides : ${contents.filter(c => c.kind === 'truth').length} vérités et ${contents.filter(c => c.kind === 'action').length} actions.`);
