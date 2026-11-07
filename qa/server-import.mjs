// Vite/Vitest can mask native Node ESM failures. Exercise the shared server
// validation module after plain TS transpilation, just as serverless Node does.
import { stripTypeScriptTypes } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve('.cache/server-import-test');
await mkdir(resolve(root, 'src/lib'), { recursive: true });
await mkdir(resolve(root, 'src/data'), { recursive: true });
await writeFile(resolve(root, 'package.json'), '{"type":"module"}');
await copyFile('src/data/vocabulary.json', resolve(root, 'src/data/vocabulary.json'));
for (const name of ['workspace', 'words']) {
  const source = await readFile(`src/lib/${name}.ts`, 'utf8');
  await writeFile(resolve(root, `src/lib/${name}.js`), stripTypeScriptTypes(source, { mode: 'strip' }));
}
const { validateWorkspace } = await import(pathToFileURL(resolve(root, 'src/lib/workspace.js')).href);
const data = { version: 1, words: [], graph: { version: 1, chains: [['NOI0001', 'NOI0003']], positions: {}, extraWords: [] } };
assert.deepEqual(validateWorkspace(data), data);
console.log('SERVER_IMPORT_PASS: native Node ESM loads vocabulary and validates workspace');
