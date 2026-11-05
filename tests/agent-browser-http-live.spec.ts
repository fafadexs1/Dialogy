import { describe, expect, it } from 'vitest';
import { loadBrowserPage, loadBrowserScript } from '@/modules/nexus/services/browser-agent';
import { createStudioMcpFetch } from '@/services/agent-studio/mcp-transport';

describe.skipIf(process.env.DIALOGY_BROWSER_HTTP_LIVE_TEST !== 'true')('HTTPS público do navegador', () => {
  it('recebe redirecionamento sem seguir automaticamente', async () => {
    const page = await loadBrowserPage({ url: 'https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com%2F', method: 'GET' }, AbortSignal.timeout(20000));
    expect(page).toMatchObject({ redirect: { url: 'https://example.com/', status: 302, previousMethod: 'GET' } });
  }, 25000);
  it('baixa script público diretamente de CDN com limites', async () => {
    const script = await loadBrowserScript('https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js', AbortSignal.timeout(20000));
    expect(script.content.length).toBeGreaterThan(100);
  }, 25000);
  it('executa transporte HTTPS fixado usado por MCP com Node atual', async () => {
    const transport = createStudioMcpFetch('https://httpbin.org/get', AbortSignal.timeout(20000));
    const response = await transport('https://httpbin.org/get');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ url: 'https://httpbin.org/get' });
  }, 25000);
});
