import 'server-only';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/** Execute only in an operator-provisioned image, never in the application process. */
export async function executeLocalAgentSandbox(input: { language: 'python' | 'javascript' | 'shell'; code: string }, signal: AbortSignal) {
  const image = process.env.DIALOGY_AGENT_SANDBOX_IMAGE || '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,240}$/.test(image)) throw new Error('Imagem do sandbox isolado não configurada.');
  signal.throwIfAborted();
  const name = `dialogy-sandbox-${randomUUID()}`;
  const args = ['run', '--rm', '--pull=never', '--network=none', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=256m', '--cpus=1', '--name', name, '-i', image];
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', done = false;
    const cleanup = () => { const process = spawn('docker', ['rm', '-f', name], { stdio: 'ignore', windowsHide: true }); process.on('error', () => {}); process.unref(); };
    const finish = (error?: Error) => {
      if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) { child.kill(); cleanup(); reject(error); return; }
      try { resolve(z.object({ version: z.literal(1), exitCode: z.number().int().min(-255).max(255), stdout: z.string().max(32000), stderr: z.string().max(32000), timedOut: z.boolean() }).parse(JSON.parse(stdout))); }
      catch { reject(new Error('O sandbox devolveu uma resposta inválida.')); }
    };
    const abort = () => finish(new Error('Execução isolada cancelada.'));
    const timer = setTimeout(() => finish(new Error('O sandbox excedeu o tempo limite.')), 20000);
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(new Error('Não foi possível iniciar o sandbox isolado.')));
    child.stdout.on('data', chunk => { stdout += String(chunk); if (stdout.length > 150000) finish(new Error('Resposta do sandbox excede o limite.')); });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(0, 1000); });
    child.on('close', code => code === 0 ? finish() : finish(new Error(stderr || 'Falha no sandbox isolado.')));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
    if (signal.aborted) abort();
  });
}
