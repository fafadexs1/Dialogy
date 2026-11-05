import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_REDIRECTS = 3;

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    a >= 224
  );
}

export function isPrivateIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  const family = isIP(normalized);
  if (family === 4) return isPrivateIpv4(normalized);
  if (family !== 6) return true;

  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true;

  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

function hostnameMatchesAllowlist(hostname: string, allowedHosts: readonly string[]): boolean {
  const normalized = hostname.toLowerCase();
  return allowedHosts.some((entry) => {
    const allowed = entry.trim().toLowerCase();
    return allowed !== '' && (allowed === '*' || normalized === allowed || normalized.endsWith(`.${allowed}`));
  });
}

export async function validateRemoteUrl(
  input: string | URL,
  options: { allowedHosts?: readonly string[] } = {},
): Promise<URL> {
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported remote URL protocol.');
  if (url.username || url.password) throw new Error('Credentials in remote URLs are not allowed.');

  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('Private hosts are not allowed.');
  }
  if (options.allowedHosts?.length && !hostnameMatchesAllowlist(hostname, options.allowedHosts)) {
    throw new Error('Remote host is not allowed.');
  }

  if (isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) throw new Error('Private IP addresses are not allowed.');
    return url;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIpAddress(address))) {
    throw new Error('Remote hostname resolves to a private or invalid address.');
  }
  return url;
}

export async function fetchSafeRemote(
  input: string | URL,
  init: RequestInit = {},
  options: { allowedHosts?: readonly string[]; timeoutMs?: number; maxRedirects?: number } = {},
): Promise<Response> {
  let current = await validateRemoteUrl(input, { allowedHosts: options.allowedHosts });
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(current, { ...init, redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location || redirects === maxRedirects) throw new Error('Too many or invalid remote redirects.');
    current = await validateRemoteUrl(new URL(location, current), { allowedHosts: options.allowedHosts });
  }

  throw new Error('Too many remote redirects.');
}

export async function readResponseBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > maxBytes) throw new Error('Remote response exceeds the size limit.');

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Remote response has no body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Remote response exceeds the size limit.');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
