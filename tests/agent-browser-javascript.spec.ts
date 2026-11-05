import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNetworklessBrowser } from '@/modules/nexus/services/browser-agent';

const testImage = process.env.DIALOGY_BROWSER_TEST_IMAGE;
afterEach(() => vi.unstubAllEnvs());
describe.skipIf(!testImage)('JavaScript no navegador isolado real', () => {
  it('executa script inline e atualiza apenas o DOM', async () => {
    vi.stubEnv('DIALOGY_AGENT_BROWSER_IMAGE', testImage!);
    const html = '<p id="value">antes</p><script>document.querySelector("#value").textContent="pronto"</script>';
    const output = await runNetworklessBrowser({ html, baseUrl: 'https://example.com/', action: 'read', javascript: true }, new AbortController().signal);
    expect(output.text).toContain('pronto');
  }, 30000);
  it('carrega apenas script explicitamente fornecido e permite clique local', async () => {
    vi.stubEnv('DIALOGY_AGENT_BROWSER_IMAGE', testImage!);
    const html = '<button id="go">Abrir</button><p id="result">antes</p><script src="/app.js"></script>';
    const scripts = [{ url: 'https://example.com/app.js', content: 'document.querySelector("#go").onclick=()=>document.querySelector("#result").textContent="alterado";' }];
    const output = await runNetworklessBrowser({ html, baseUrl: 'https://example.com/', action: 'click', selector: '#go', javascript: true, scripts }, new AbortController().signal);
    expect(output.clicked).toBe(true); expect(output.html).toContain('alterado');
  }, 30000);
  it('executa código de CDN somente quando fornecido à sessão aprovada', async () => {
    vi.stubEnv('DIALOGY_AGENT_BROWSER_IMAGE', testImage!);
    const html = '<p id="result">original</p><script src="https://cdn.example/app.js"></script>';
    const scripts = [{ url: 'https://cdn.example/app.js', content: 'document.querySelector("#result").textContent="carregado"' }];
    const output = await runNetworklessBrowser({ html, baseUrl: 'https://example.com/', action: 'read', javascript: true, scripts }, new AbortController().signal);
    expect(output.text).toContain('carregado');
  }, 30000);
  it('intercepta rede iniciada pelo clique sem enviar pedido à rede local', async () => {
    vi.stubEnv('DIALOGY_AGENT_BROWSER_IMAGE', testImage!);
    const html = '<button id="go" onclick="fetch(\'http://127.0.0.1:1234/private\').catch(()=>{})">Abrir</button>';
    const output = await runNetworklessBrowser({ html, baseUrl: 'https://example.com/', action: 'click', selector: '#go', javascript: true }, new AbortController().signal);
    expect(output.networkIntent).toMatchObject({ target: 'http://127.0.0.1:1234/private', method: 'GET' });
  }, 30000);
  it('não executa script externo que não tenha sido carregado e aprovado', async () => {
    vi.stubEnv('DIALOGY_AGENT_BROWSER_IMAGE', testImage!);
    const html = '<p id="result">original</p><script src="https://example.com/app.js"></script>';
    const output = await runNetworklessBrowser({ html, baseUrl: 'https://example.com/', action: 'read', javascript: true }, new AbortController().signal);
    expect(output.text).toContain('original');
  }, 30000);
  it('rejeita clique que dispara várias solicitações em vez de escolher uma', async () => {
    vi.stubEnv('DIALOGY_AGENT_BROWSER_IMAGE', testImage!);
    const html = '<button id="go" onclick="fetch(\'https://example.com/a\').catch(()=>{}); fetch(\'https://example.com/b\').catch(()=>{})">Abrir</button>';
    await expect(runNetworklessBrowser({ html, baseUrl: 'https://example.com/', action: 'click', selector: '#go', javascript: true }, new AbortController().signal)).rejects.toThrow(/várias operações/);
  }, 30000);
});
