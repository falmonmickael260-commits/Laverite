import { writeFileSync } from 'node:fs';
process.env.CONTENT_EXPORT = '1';
const { generatedContents } = await import('../shared/content.js');
writeFileSync(new URL('../shared/content.generated.json', import.meta.url), JSON.stringify(generatedContents, null, 2) + '\n');
console.log(`Exporté : ${generatedContents.length} contenus.`);
