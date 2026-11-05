import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mock = vi.hoisted(() => ({ request: vi.fn(), resolve: vi.fn() }));
vi.mock('node:https', () => ({ default: { request: mock.request } }));
vi.mock('@/services/autopilot/automation-rules', () => ({ resolveSafeAutopilotWebhookTarget: mock.resolve }));
import { createStudioMcpFetch } from '@/services/agent-studio/mcp-transport';

beforeEach(() => {
  vi.resetAllMocks();
  mock.resolve.mockImplementation(async (url: string) => ({ url: new URL(url), addresses: ['93.184.216.34'] }));
  mock.request.mockImplementation((_url, _options, callback) => {
    const request = Object.assign(new EventEmitter(), { write: vi.fn(), end: () => {
      const response = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-type': 'application/json' } });
      callback(response); response.end('{"ok":true}');
    } }); return request;
  });
});
describe('Studio MCP public HTTPS boundary', () => {
  it('pins the validated address and preserves protocol response streaming', async () => {
    const fetch = createStudioMcpFetch('https://mcp.example/protocol', new AbortController().signal);
    expect(await (await fetch('https://mcp.example/protocol', { method: 'POST', body: '{}' })).json()).toEqual({ ok: true });
    const callback = vi.fn(); mock.request.mock.calls[0][1].lookup('mcp.example', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    const all = vi.fn(); mock.request.mock.calls[0][1].lookup('mcp.example', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  });
  it.each(['https://evil.example', 'http://mcp.example/protocol', 'https://user:secret@mcp.example/protocol'])('blocks an unauthorized destination %s before any request', async (url) => {
    await expect(createStudioMcpFetch('https://mcp.example/protocol', new AbortController().signal)(url)).rejects.toThrow();
    expect(mock.request).not.toHaveBeenCalled();
  });
  it('does not follow a server redirect', async () => {
    mock.request.mockImplementation((_url, _options, callback) => Object.assign(new EventEmitter(), { end: () => callback(Object.assign(new PassThrough(), { statusCode: 302, headers: { location: 'https://evil.example' } })) }));
    await expect(createStudioMcpFetch('https://mcp.example', new AbortController().signal)('https://mcp.example')).rejects.toThrow('Redirecionamentos');
    expect(mock.request).toHaveBeenCalledOnce();
  });
  it('does not dispatch after cancellation during DNS resolution', async () => {
    const abort = new AbortController();
    mock.resolve.mockImplementation(async (url: string) => { abort.abort(); return { url: new URL(url), addresses: ['93.184.216.34'] }; });
    await expect(createStudioMcpFetch('https://mcp.example', abort.signal)('https://mcp.example')).rejects.toThrow();
    expect(mock.request).not.toHaveBeenCalled();
  });
  it('rejects private DNS resolutions and oversized responses', async () => {
    mock.resolve.mockRejectedValueOnce(new Error('Rede privada bloqueada'));
    const fetch = createStudioMcpFetch('https://mcp.example', new AbortController().signal);
    await expect(fetch('https://mcp.example')).rejects.toThrow('privada'); expect(mock.request).not.toHaveBeenCalled();
    mock.request.mockImplementation((_url, _options, callback) => Object.assign(new EventEmitter(), { end: () => {
      const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} }); callback(response); response.end(Buffer.alloc(1_000_001));
    } }));
    await expect((await fetch('https://mcp.example')).text()).rejects.toThrow('limite');
  });
});
