import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:https', () => ({ default: { request: mock.request } }));
vi.mock('@/services/autopilot/automation-rules', () => ({ resolveSafeAutopilotWebhookTarget: async (url: string) => ({ url: new URL(url), addresses: ['93.184.216.34'] }) }));
import { requestPublicHttps } from '@/modules/nexus/services/public-http';

function respondWithRedirect() {
  mock.request.mockImplementation((_url, _options, callback) => {
    const request = Object.assign(new EventEmitter(), { end: () => queueMicrotask(() => {
      const response = Object.assign(new EventEmitter(), { statusCode: 302, headers: { location: 'https://cdn.example/next', 'set-cookie': ['session=secret'] } });
      callback(response); response.emit('end'); request.emit('close');
    }), destroy: vi.fn(), write: vi.fn() });
    return request;
  });
}
const input = () => ({ url: 'https://example.com/start', method: 'GET', headers: {}, timeoutMs: 1000, maxResponseBytes: 1000, signal: new AbortController().signal });
describe('redirecionamento HTTP explícito', () => {
  it('continua recusando respostas 302 por padrão sem seguir o destino', async () => {
    mock.request.mockReset(); respondWithRedirect();
    await expect(requestPublicHttps(input())).rejects.toThrow(/302/);
    expect(mock.request).toHaveBeenCalledOnce();
  });
  it('devolve apenas a resposta quando explicitamente permitido, sem reenviar nem vazar cookies', async () => {
    mock.request.mockReset(); respondWithRedirect();
    const result = await requestPublicHttps({ ...input(), allowRedirectResponse: true });
    expect(result).toMatchObject({ status: 302, headers: { location: 'https://cdn.example/next' } });
    expect(result.headers['set-cookie']).toBeUndefined(); expect(mock.request).toHaveBeenCalledOnce();
  });
  it('fornece o endereço validado tanto para lookup único quanto para all=true', async () => {
    mock.request.mockReset(); respondWithRedirect();
    await requestPublicHttps({ ...input(), allowRedirectResponse: true });
    const options = mock.request.mock.calls[0][1];
    const single = vi.fn(), all = vi.fn();
    options.lookup('example.com', { all: false }, single);
    options.lookup('example.com', { all: true }, all);
    expect(single).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    expect(all).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  });
});
