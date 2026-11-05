import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), request: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('@/modules/nexus/services/public-http', () => ({ requestPublicHttps: mocks.request }));
import { BrowserToolArguments, browserNavigation, browserScriptUrl, loadBrowserPage, loadBrowserScript, runNetworklessBrowser } from '@/modules/nexus/services/browser-agent';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('navegador isolado', () => {
  it('limita navegação HTTPS e preserva os argumentos a aprovar', () => {
    expect(browserNavigation('/search', 'https://example.com/', 'POST', [['query', 'abc']])).toEqual({ url: 'https://example.com/search', method: 'POST', body: 'query=abc' });
    expect(browserNavigation('/x', 'https://example.com/', 'GET', [['q', 'abc']])).toEqual({ url: 'https://example.com/x?q=abc', method: 'GET' });
    expect(() => browserNavigation('http://example.com/')).toThrow();
    expect(() => browserNavigation('https://user:pass@example.com/')).toThrow();
    expect(() => browserNavigation('https://example.com/', undefined, 'POST', [['password', 'x']])).toThrow();
    expect(() => browserNavigation('https://example.com/?access_token=secret')).toThrow();
    expect(browserScriptUrl('/app.js', 'https://example.com/index')).toBe('https://example.com/app.js');
    expect(browserScriptUrl('https://cdn.example/app.js', 'https://example.com/')).toBe('https://cdn.example/app.js');
    expect(() => browserScriptUrl('http://cdn.example/app.js', 'https://example.com/')).toThrow(/HTTPS/);
    expect(() => browserScriptUrl('/app.js?access_token=secret', 'https://example.com/')).toThrow(/protegidos/);
    expect(() => BrowserToolArguments.parse({ action: 'click', selector: 'a', url: 'https://x' })).toThrow();
  });
  it('carrega scripts pelo mesmo executor HTTPS e valida o tipo', async () => {
    mocks.request.mockResolvedValueOnce({ headers: { 'content-type': 'application/javascript' }, body: Buffer.from('console.log(1)') });
    expect(await loadBrowserScript('https://example.com/a.js', new AbortController().signal)).toEqual({ url: 'https://example.com/a.js', content: 'console.log(1)' });
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', maxResponseBytes: 100000 }));
    mocks.request.mockResolvedValueOnce({ headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>') });
    await expect(loadBrowserScript('https://example.com/a.js', new AbortController().signal)).rejects.toThrow(/script/);
  });
  it('usa o executor HTTPS público com limites e rejeita mídia binária', async () => {
    mocks.request.mockResolvedValueOnce({ headers: { 'content-type': 'text/plain' }, body: Buffer.from('<b>literal</b>') });
    expect(await loadBrowserPage({ url: 'https://example.com/', method: 'GET' }, new AbortController().signal)).toMatchObject({ html: '<pre>&lt;b&gt;literal&lt;/b&gt;</pre>' });
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ maxResponseBytes: 300000, timeoutMs: 15000 }));
    mocks.request.mockResolvedValueOnce({ headers: { 'content-type': 'application/pdf' }, body: Buffer.from('x') });
    await expect(loadBrowserPage({ url: 'https://example.com/', method: 'GET' }, new AbortController().signal)).rejects.toThrow(/texto/);
  });
  it('expõe destino de redirecionamento sem segui-lo e rejeita destinos inseguros', async () => {
    mocks.request.mockResolvedValueOnce({ status: 302, headers: { location: '/next' }, body: Buffer.alloc(0) });
    expect(await loadBrowserPage({ url: 'https://example.com/start', method: 'GET' }, new AbortController().signal)).toEqual({ url: 'https://example.com/start', redirect: { url: 'https://example.com/next', status: 302, previousMethod: 'GET' } });
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ allowRedirectResponse: true }));
    mocks.request.mockResolvedValueOnce({ status: 307, headers: { location: 'http://example.com/insecure' }, body: Buffer.alloc(0) });
    await expect(loadBrowserPage({ url: 'https://example.com/start', method: 'POST', body: 'a=b' }, new AbortController().signal)).rejects.toThrow(/HTTPS/);
    mocks.request.mockResolvedValueOnce({ status: 302, headers: { location: '/next?access_token=secret' }, body: Buffer.alloc(0) });
    await expect(loadBrowserPage({ url: 'https://example.com/start', method: 'GET' }, new AbortController().signal)).rejects.toThrow(/protegidos/);
  });
  it('inicia Docker sem rede, sem mounts e com limites de recursos', async () => {
    vi.stubEnv('DIALOGY_AGENT_BROWSER_IMAGE', 'dialogy-agent-browser:local');
    let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => void };
    mocks.spawn.mockImplementationOnce(() => {
      child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      child.stdin.on('data', () => {});
      child.stdin.on('finish', () => { child.stdout.write(JSON.stringify({ text: 'Olá' })); child.emit('close', 0); });
      return child;
    });
    expect(await runNetworklessBrowser({ html: '<p>Olá</p>', action: 'read' }, new AbortController().signal)).toEqual({ text: 'Olá' });
    const args = mocks.spawn.mock.calls[0][1] as string[];
    expect(args).toEqual(expect.arrayContaining(['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=512m', '--pull=never']));
    expect(args).not.toContain('-v'); expect(args).not.toContain('--mount');
  });
});
