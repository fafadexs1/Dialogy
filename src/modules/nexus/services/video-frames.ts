import 'server-only';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/** FFmpeg processes untrusted bytes only in an ephemeral networkless container. */
export type ExtractedVideoFrames = { frames: Buffer[]; estimatedDurationSeconds: number | null; sampleTimesSeconds: number[]; coverage: 'distributed' | 'partial' | 'initial' };
export async function extractVideoFrames(data: Buffer, signal: AbortSignal): Promise<ExtractedVideoFrames> {
  const image = process.env.DIALOGY_AGENT_VIDEO_IMAGE || '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,240}$/.test(image)) throw new Error('Imagem do analisador de vídeo não configurada.');
  if (!data.length || data.length > 5_000_000) throw new Error('Use um vídeo de até 5 MB.');
  signal.throwIfAborted();
  const name = `dialogy-video-${randomUUID()}`;
  const args = ['run', '--rm', '--pull=never', '--network=none', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=256m', '--cpus=1', '--name', name, '-i', image];
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', done = false;
    const cleanup = () => { const process = spawn('docker', ['rm', '-f', name], { stdio: 'ignore', windowsHide: true }); process.on('error', () => {}); process.unref(); };
    const finish = (error?: Error) => {
      if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) { child.kill(); cleanup(); reject(error); return; }
      try {
        const result = z.object({ frames: z.array(z.string().min(4).max(1_000_000)).min(1).max(6), estimatedDurationSeconds: z.number().positive().max(21600).nullable(), sampleTimesSeconds: z.array(z.number().nonnegative().max(21600)).max(6), coverage: z.enum(['distributed', 'partial', 'initial']) }).strict().parse(JSON.parse(stdout));
        if (result.coverage !== 'initial' && (result.estimatedDurationSeconds === null || result.sampleTimesSeconds.length !== result.frames.length || result.sampleTimesSeconds.some((time, index) => time > result.estimatedDurationSeconds! || (index > 0 && time <= result.sampleTimesSeconds[index - 1])))) throw new Error('Cobertura inválida.');
        if (result.coverage === 'initial' && (result.estimatedDurationSeconds !== null || result.sampleTimesSeconds.length)) throw new Error('Cobertura inválida.');
        const frames = result.frames.map(frame => {
          if (frame.length % 4 || /[^A-Za-z0-9+/=]/.test(frame)) throw new Error('Base64 inválido.');
          const bytes = Buffer.from(frame, 'base64');
          if (bytes.toString('base64') !== frame || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error('Quadro inválido.');
          return bytes;
        });
        resolve({ ...result, frames });
      } catch { reject(new Error('O analisador devolveu quadros inválidos.')); }
    };
    const abort = () => finish(new Error('Análise de vídeo cancelada.'));
    const timer = setTimeout(() => finish(new Error('A extração de quadros excedeu o tempo limite.')), 25000);
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(new Error('Não foi possível iniciar o analisador de vídeo isolado.')));
    child.stdout.on('data', chunk => { stdout += String(chunk); if (stdout.length > 2_700_000) finish(new Error('Quadros excedem o limite.')); });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(0, 500); });
    child.on('close', code => code === 0 ? finish() : finish(new Error(stderr || 'Falha ao analisar o vídeo.')));
    child.stdin.on('error', () => {}); child.stdin.end(data);
    if (signal.aborted) abort();
  });
}
