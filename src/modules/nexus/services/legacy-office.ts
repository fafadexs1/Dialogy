import 'server-only';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertBoundedSpreadsheetArchive } from './spreadsheet-limits';

/** Converts legacy binary Office documents without granting the parser network or host files. */
export async function convertLegacyOffice(data: Buffer, format: 'doc' | 'xls', signal: AbortSignal = AbortSignal.timeout(45000)): Promise<Buffer> {
  const image = process.env.DIALOGY_LEGACY_OFFICE_IMAGE || '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,240}$/.test(image)) throw new Error('Conversor de documentos Office legados não configurado.');
  if (data.length < 8 || data.length > 2_000_000 || !data.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) throw new Error('Arquivo Office legado inválido ou maior que 2 MB.');
  signal.throwIfAborted();
  const name = `dialogy-office-${randomUUID()}`;
  const args = ['run', '--rm', '--pull=never', '--network=none', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=128m', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=768m', '--cpus=1', '--name', name, '-i', image];
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', done = false;
    const cleanup = () => { const proc = spawn('docker', ['rm', '-f', name], { stdio: 'ignore', windowsHide: true }); proc.on('error', () => {}); proc.unref(); };
    const finish = (error?: Error) => {
      if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) { child.kill(); cleanup(); reject(error); return; }
      try {
        const result = z.object({ format: z.enum(['docx', 'xlsx']), dataBase64: z.string().min(4).max(13_400_000) }).parse(JSON.parse(stdout));
        if (result.format !== (format === 'doc' ? 'docx' : 'xlsx') || result.dataBase64.length % 4 || /[^A-Za-z0-9+/=]/.test(result.dataBase64)) throw new Error('Formato inválido.');
        const bytes = Buffer.from(result.dataBase64, 'base64');
        if (bytes.length > 10_000_000 || bytes.toString('base64') !== result.dataBase64) throw new Error('Conteúdo inválido.');
        assertBoundedSpreadsheetArchive(bytes);
        resolve(bytes);
      } catch { reject(new Error('A conversão Office devolveu um arquivo inválido ou maior que o limite.')); }
    };
    const abort = () => finish(new Error('Conversão Office cancelada.'));
    const timer = setTimeout(() => finish(new Error('Conversão Office excedeu o tempo limite.')), 40000);
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(new Error('Não foi possível iniciar o conversor Office isolado.')));
    child.stdout.on('data', chunk => { stdout += String(chunk); if (stdout.length > 13_500_000) finish(new Error('Arquivo convertido excede o limite.')); });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(0, 500); });
    child.on('close', code => code === 0 ? finish() : finish(new Error(stderr || 'Falha ao converter o documento.')));
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify({ format, dataBase64: data.toString('base64') }));
    if (signal.aborted) abort();
  });
}
