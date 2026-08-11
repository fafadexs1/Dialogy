import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchSafeRemote,
  isPrivateIpAddress,
  readResponseBodyLimited,
  validateRemoteUrl,
} from '@/lib/security/safe-remote-url';

describe('safe remote URL guard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    '127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1',
    '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',
  ])('rejects private or local address %s', (address) => {
    expect(isPrivateIpAddress(address)).toBe(true);
  });

  it('accepts a public IP address', () => {
    expect(isPrivateIpAddress('8.8.8.8')).toBe(false);
    expect(isPrivateIpAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('rejects hosts outside the explicit allowlist', async () => {
    await expect(validateRemoteUrl('https://93.184.216.34/file', { allowedHosts: ['cdn.example.com'] }))
      .rejects.toThrow('not allowed');
  });

  it('accepts any public host when allowlist contains "*"', async () => {
    await expect(validateRemoteUrl('https://93.184.216.34/file', { allowedHosts: ['*'] }))
      .resolves.toBeDefined();
  });

  it('revalidates redirects and rejects a redirect to a private IP', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/admin' },
    })));

    await expect(fetchSafeRemote('https://93.184.216.34/file')).rejects.toThrow('Private IP');
  });

  it('stops reading when the byte budget is exceeded', async () => {
    const response = new Response(new Uint8Array(11));
    await expect(readResponseBodyLimited(response, 10)).rejects.toThrow('size limit');
  });
});
