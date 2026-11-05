import 'server-only';
import https from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { resolveSafeAutopilotWebhookTarget } from '@/services/autopilot/automation-rules';

/** MCP's SDK keeps its protocol handling; this adapter constrains every HTTP request,
 * including SSE endpoints, to one public HTTPS origin and a pinned validated address. */
export function createStudioMcpFetch(endpoint: string, signal: AbortSignal): typeof fetch {
  const origin = new URL(endpoint).origin;
  let requests = 0;
  return async (input, init) => {
    if (++requests > 12) throw new Error('O MCP excedeu o limite de requisições desta operação.');
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password) throw new Error('O MCP tentou acessar um destino não autorizado.');
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) throw new Error('Método MCP não autorizado.');
    const target = await resolveSafeAutopilotWebhookTarget(request.url);
    const address = target.addresses[0];
    const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
    if (body && body.byteLength > 1_000_000) throw new Error('Os dados enviados ao MCP excedem o limite seguro.');
    const combined = AbortSignal.any([signal, request.signal]);
    combined.throwIfAborted();
    return new Promise<Response>((resolve, reject) => {
      const outgoing = https.request(target.url, {
        method: request.method, headers: Object.fromEntries(request.headers), servername: target.url.hostname,
        lookup: (_host, options, callback) => {
          const family = isIP(address);
          if (options.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        }, signal: combined,
      }, (incoming) => {
        const status = incoming.statusCode || 502;
        if (status >= 300 && status < 400) { incoming.destroy(); reject(new Error('Redirecionamentos MCP não são permitidos.')); return; }
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        let bytes = 0;
        const stream = (Readable.toWeb(incoming) as ReadableStream<Uint8Array>).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > 1_000_000) { incoming.destroy(); controller.error(new Error('A resposta MCP excedeu o limite seguro.')); return; }
            controller.enqueue(chunk);
          },
        }));
        if ([204, 205, 304].includes(status)) { incoming.resume(); resolve(new Response(null, { status, headers })); }
        else resolve(new Response(stream, { status, headers }));
      });
      outgoing.once('error', reject);
      if (body) outgoing.write(body);
      outgoing.end();
    });
  };
}
