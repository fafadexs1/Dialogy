// Fail the image build if bundled workers import packages absent from their
// corresponding reduced runtime image. The esbuild metadata includes dynamic
// imports as well as require(), without executing a worker or touching services.
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { readFile } from 'node:fs/promises';

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const lists = [...dockerfile.matchAll(/const names=\[(.*?)\];/g)].map(match =>
  new Set([...match[1].matchAll(/'([^']+)'/g)].map(item => item[1])),
);
if (lists.length !== 2) throw new Error('Não foi possível verificar as dependências dos dois ambientes de worker.');
const entries = [
  ['src/worker.ts', 0],
  ['src/worker-campaign.ts', 0],
  ['src/worker-meta-relay.ts', 0],
  ['src/worker-google-ads.ts', 0],
  ['src/worker-nexus.ts', 0],
  ['src/worker-ai.ts', 1],
];
// dotenv is only imported by the local development bootstrap. In containers,
// NODE_ENV=production and the environment is supplied by Docker instead.
const developmentOnly = new Set(['dotenv', 'server-only']);
const builtins = new Set(builtinModules);
const problems = [];
for (const [entry, listIndex] of entries) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, metafile: true,
    platform: 'node', format: 'cjs', target: 'node20', packages: 'external',
    tsconfig: 'tsconfig.json', external: ['server-only'], logLevel: 'silent',
  });
  const missing = new Set();
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imported of output.imports) {
      if (!imported.external) continue;
      const name = imported.path;
      if (name.startsWith('.') || name.startsWith('/') || name.startsWith('node:') || builtins.has(name) || developmentOnly.has(name)) continue;
      const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
      if (!developmentOnly.has(packageName) && !lists[listIndex].has(packageName)) missing.add(packageName);
    }
  }
  if (missing.size) problems.push(`${entry}: ${[...missing].sort().join(', ')}`);
}
if (problems.length) throw new Error(`Dependências ausentes nas imagens dos workers:\n${problems.join('\n')}`);
console.log('Dependências externas dos workers presentes nas imagens de runtime.');
