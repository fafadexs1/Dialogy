import 'server-only';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requestPublicHttps } from './public-http';

export const BrowserToolArguments = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), url: z.string().url().max(8192) }).strict(),
  z.object({ action: z.literal('read') }).strict(),
  z.object({ action: z.literal('scripts') }).strict(),
  z.object({ action: z.literal('load_script'), url: z.string().url().max(8192) }).strict(),
  z.object({ action: z.literal('fill'), selector: z.string().min(1).max(500), value: z.string().max(4000) }).strict(),
  z.object({ action: z.literal('click'), selector: z.string().min(1).max(500) }).strict(),
]);
export const browserToolJsonSchema = { type: 'object', properties: { action: { type: 'string', enum: ['open', 'read', 'scripts', 'load_script', 'fill', 'click'] }, url: { type: 'string' }, selector: { type: 'string' }, value: { type: 'string' } }, required: ['action'], additionalProperties: false };
export type BrowserState = { url: string; html: string; scripts?: Array<{ url: string; content: string }> };
export type BrowserRequest = { url: string; method: 'GET' | 'POST'; body?: string };
export type BrowserPageResult = BrowserState | { url: string; redirect: { url: string; status: number; previousMethod: 'GET' | 'POST' } };

export function browserNavigation(target: string, base?: string, method = 'GET', fields: Array<[string, string]> = []): BrowserRequest {
  const url = base ? new URL(target || base, base) : new URL(target);
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 8192) throw new Error('A navegação exige uma URL HTTPS pública sem credenciais.');
  if ([...url.searchParams.keys()].some(key => /password|passwd|token|secret|senha|cvv|card|cartao/i.test(key))) throw new Error('A URL contém parâmetros protegidos.');
  url.hash = '';
  if (!['GET', 'POST'].includes(method) || fields.length > 100 || fields.some(([key, value]) => key.length > 200 || value.length > 4000 || /password|passwd|token|secret|senha|cvv|card|cartao/i.test(key))) throw new Error('O formulário não pode ser enviado.');
  const body = new URLSearchParams(fields).toString();
  if (body.length > 16000) throw new Error('O formulário excede o limite.');
  if (method === 'GET') { for (const [key, value] of fields) url.searchParams.append(key, value); if (url.href.length > 8192) throw new Error('A URL excede o limite.'); }
  return { url: url.href, method: method as 'GET' | 'POST', ...(method === 'POST' ? { body } : {}) };
}

export function browserScriptUrl(target: string, pageUrl: string): string {
  const page = new URL(pageUrl); const script = new URL(target, page);
  if (page.protocol !== 'https:' || script.protocol !== 'https:' || script.username || script.password || script.href.length > 8192) throw new Error('O script exige uma URL HTTPS sem credenciais.');
  if ([...script.searchParams.keys()].some(key => /password|passwd|token|secret|senha|cvv|card|cartao/i.test(key))) throw new Error('A URL do script contém parâmetros protegidos.');
  script.hash = '';
  return script.href;
}

/** Browser process has no network, mounts, elevated privileges or host environment. */
export async function runNetworklessBrowser(input: { html: string; action: 'read' | 'scripts' | 'fill' | 'click'; selector?: string; value?: string; baseUrl?: string; javascript?: boolean; scripts?: Array<{ url: string; content: string }> }, signal: AbortSignal): Promise<Record<string, unknown>> {
  const image = process.env.DIALOGY_AGENT_BROWSER_IMAGE || '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,240}$/.test(image)) throw new Error('Imagem do navegador isolado não configurada.');
  signal.throwIfAborted();
  const name = `dialogy-browser-${randomUUID()}`;
  const args = ['run', '--rm', '--pull=never', '--network=none', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=512m', '--cpus=1', '--name', name, '-i', image];
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', done = false;
    const cleanupContainer = () => { const cleanup = spawn('docker', ['rm', '-f', name], { stdio: 'ignore', windowsHide: true }); cleanup.on('error', () => {}); cleanup.unref(); };
    const finish = (error?: Error) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); if (error) { child.kill(); cleanupContainer(); reject(error); return; } try { const parsed = JSON.parse(stdout); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Resultado inválido.'); resolve(parsed); } catch { reject(new Error('O navegador isolado devolveu uma resposta inválida.')); } };
    const abort = () => finish(new Error('Navegador cancelado.'));
    const timer = setTimeout(() => finish(new Error('Navegador excedeu o tempo limite.')), 15000);
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(new Error('Não foi possível iniciar o navegador isolado.')));
    child.stdout.on('data', chunk => { stdout += String(chunk); if (stdout.length > 600000) finish(new Error('A página excedeu o limite.')); });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(0, 1000); });
    child.on('close', code => code === 0 ? finish() : finish(new Error(stderr.slice(0, 1000) || 'Falha no navegador isolado.')));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
    if (signal.aborted) abort();
  });
}

export async function loadBrowserScript(url: string, signal: AbortSignal): Promise<{ url: string; content: string }> {
  const result = await requestPublicHttps({ url, method: 'GET', headers: { Accept: 'text/javascript,application/javascript,text/plain' }, timeoutMs: 15000, maxResponseBytes: 100000, signal });
  const type = String(result.headers['content-type'] || '').toLowerCase();
  if (!/^(text\/javascript|application\/javascript|application\/x-javascript|text\/plain)(?:\s*;|$)/.test(type)) throw new Error('A resposta não é um script JavaScript compatível.');
  return { url, content: result.body.toString('utf8') };
}

export async function loadBrowserPage(request: BrowserRequest, signal: AbortSignal): Promise<BrowserPageResult> {
  const result = await requestPublicHttps({ ...request, headers: { Accept: 'text/html,text/plain', ...(request.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, timeoutMs: 15000, maxResponseBytes: 300000, signal, allowRedirectResponse: true });
  if ([301, 302, 303, 307, 308].includes(result.status)) {
    const location = result.headers.location;
    if (typeof location !== 'string' || !location || location.length > 8192) throw new Error('Redirecionamento sem destino válido.');
    const target = browserNavigation(location, request.url);
    return { url: request.url, redirect: { url: target.url, status: result.status, previousMethod: request.method } };
  }
  const type = String(result.headers['content-type'] || '').toLowerCase();
  if (!/^(text\/html|text\/plain)(?:\s*;|$)/.test(type)) throw new Error('O navegador suporta apenas páginas de texto ou HTML.');
  const text = result.body.toString('utf8');
  const html = type.startsWith('text/plain') ? `<pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>` : text;
  return { url: request.url, html };
}
