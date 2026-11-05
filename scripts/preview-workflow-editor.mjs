import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local synthetic editor, with no execution or persistence adapters. The route
// stays on disk and is enabled only in this process by WORKFLOW_EDITOR_PREVIEW.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = join(root, 'src', 'app', 'workflow-editor-preview', 'page.tsx');
const dist = '.next-workflow-preview';
const production = process.argv.includes('--production');
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? 9014 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use --port com uma porta entre 1024 e 65535.');
if (!existsSync(page)) throw new Error('A página estável workflow-editor-preview/page.tsx não foi encontrada. Restaure-a antes de iniciar a prévia.');
// Prepare the generated type paths before Turbopack opens its watched files on
// Windows. Cleanup removes only these preview-specific entries.
const previewConfigPath = join(root, 'tsconfig.json');
const previewConfig = JSON.parse(readFileSync(previewConfigPath, 'utf8'));
previewConfig.include ||= ['next-env.d.ts', '**/*.ts', '**/*.tsx'];
for (const entry of [`${dist}/types/**/*.ts`, `${dist}/dev/types/**/*.ts`]) {
  if (!previewConfig.include.includes(entry)) previewConfig.include.push(entry);
}
writeFileSync(previewConfigPath, `${JSON.stringify(previewConfig, null, 2)}\n`);
let child;
let stopping = false;
const cleanup = () => {
  const configPath = join(root, 'tsconfig.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (Array.isArray(config.include) && config.include.some((entry) => entry.startsWith(`${dist}/`))) {
    config.include = config.include.filter((entry) => !entry.startsWith(`${dist}/`));
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
  const nextEnvPath = join(root, 'next-env.d.ts');
  if (existsSync(nextEnvPath)) {
    const nextEnv = readFileSync(nextEnvPath, 'utf8');
    const restored = nextEnv.replaceAll(`./${dist}/dev/types/`, './.next/types/').replaceAll(`./${dist}/types/`, './.next/types/');
    if (restored !== nextEnv) writeFileSync(nextEnvPath, restored);
  }
};
const run = (args) => new Promise((accept, reject) => {
  child = spawn(process.execPath, [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), ...args], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, NEXT_DIST_DIR: dist, WORKFLOW_EDITOR_PREVIEW: '1' },
  });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 || stopping ? accept() : reject(new Error(`Next terminou com código ${code}.`)));
});
const stop = () => { stopping = true; child?.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => { if (data.trim() === 'stop') stop(); });
process.on('exit', cleanup);
try {
  if (production) await run(['build']);
  if (!stopping) {
    console.log(`Validação local: http://127.0.0.1:${port}/workflow-editor-preview`);
    await run([production ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', String(port)]);
  }
} finally { cleanup(); process.stdin.pause(); }
