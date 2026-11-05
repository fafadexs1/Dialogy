import https from 'node:https';
import { isIP } from 'node:net';
import { resolveSafeAutopilotWebhookTarget } from '@/services/autopilot/automation-rules';

export type PublicHttpRequest = { url: string; method: string; headers: Record<string, string>; body?: string | Buffer; timeoutMs: number; maxResponseBytes: number; signal: AbortSignal; allowRedirectResponse?: boolean };
export type PublicHttpResponse = { status: number; headers: Record<string, string | string[]>; body: Buffer };

/** Public HTTPS only, pinned DNS, no redirects, bounded stream and caller cancellation. */
export async function requestPublicHttps(input: PublicHttpRequest): Promise<PublicHttpResponse> {
  input.signal.throwIfAborted();
  const target = await resolveSafeAutopilotWebhookTarget(input.url);
  const address = target.addresses[0]!;
  return new Promise((resolve, reject) => {
    const request = https.request(target.url, {
      method: input.method, headers: input.headers, servername: target.url.hostname,
      lookup: (_hostname, options, callback) => {
        const family = isIP(address);
        if (options.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Resposta HTTP interrompida.')));
      response.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > input.maxResponseBytes) { reject(new Error('A resposta HTTP excedeu o limite configurado.')); response.destroy(); request.destroy(); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks), status = response.statusCode || 0;
        if ((status < 200 || status >= 300) && !(input.allowRedirectResponse && [301, 302, 303, 307, 308].includes(status))) {
          reject(Object.assign(new Error(`A API respondeu com status ${status}.`), {
            code: status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'HTTP_REQUEST_FAILED',
            retryable: status === 429 || status >= 500,
            details: { status },
          }));
          return;
        }
        // Authentication/session headers must not leak into workflow results.
        const headers = Object.fromEntries(Object.entries(response.headers).filter(([name, value]) => value !== undefined && !['set-cookie', 'authorization', 'proxy-authenticate'].includes(name))) as Record<string, string | string[]>;
        resolve({ status, headers, body });
      });
    });
    const timer = setTimeout(() => request.destroy(Object.assign(new Error('A requisição HTTP excedeu o tempo limite.'), { code: 'TIMEOUT', retryable: true })), input.timeoutMs);
    request.on('error', reject);
    const abort = () => request.destroy(input.signal.reason instanceof Error ? input.signal.reason : new Error('Requisição cancelada.'));
    input.signal.addEventListener('abort', abort, { once: true });
    request.on('close', () => { clearTimeout(timer); input.signal.removeEventListener('abort', abort); });
    if (input.signal.aborted) { abort(); return; }
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}
