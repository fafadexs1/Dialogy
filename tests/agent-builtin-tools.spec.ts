import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/modules/nexus/services/public-http', () => ({ requestPublicHttps: request }));
import { calculateDecimal, executeBuiltinAgentTool } from '@/modules/nexus/services/builtin-agent-tools';
import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import { createNexusToolRegistry } from '@/modules/nexus/services/tool-registry';

describe('ferramentas nativas do agente', () => {
  beforeEach(() => { vi.stubEnv('PARALLEL_API_KEY', ''); vi.stubEnv('DIALOGY_AGENT_SANDBOX_IMAGE', ''); });
  afterEach(() => { vi.unstubAllEnvs(); request.mockReset(); });
  it('calcula em precisão racional sem executar código', () => {
    expect(calculateDecimal('0.1 + 0.2')).toMatchObject({ value: '0.3', exact: true, fraction: '3/10' });
    expect(calculateDecimal('(20-5)*3/7')).toMatchObject({ exact: false, fraction: '45/7' });
    expect(() => calculateDecimal('1/0')).toThrow(/zero/);
    expect(() => calculateDecimal('process.exit()')).toThrow();
    expect(() => calculateDecimal('('.repeat(65) + '1' + ')'.repeat(65))).toThrow();
  });
  it('retorna horário com fuso válido e rejeita um inválido', async () => {
    const signal = new AbortController().signal;
    expect(await executeBuiltinAgentTool('tool.clock', { timezone: 'America/Sao_Paulo' }, signal, new Date('2026-11-04T12:00:00Z'))).toMatchObject({ isoUtc: '2026-11-04T12:00:00.000Z', timezone: 'America/Sao_Paulo' });
    await expect(executeBuiltinAgentTool('tool.clock', { timezone: 'Invalid/Foo' }, signal)).rejects.toThrow(/Fuso/);
  });
  it('lê apenas conteúdo textual com limites e remove scripts', async () => {
    request.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from('<h1>Olá</h1><script>secreto()</script><p>Mundo &amp; Cia</p>') });
    const signal = new AbortController().signal;
    expect(await executeBuiltinAgentTool('tool.read_url', { url: 'https://example.com/' }, signal)).toMatchObject({ text: 'Olá Mundo & Cia', truncated: false });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ maxResponseBytes: 1000000, method: 'GET' }));
    await expect(executeBuiltinAgentTool('tool.read_url', { url: 'http://example.com' }, signal)).rejects.toThrow(/HTTPS/);
    request.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'application/pdf' }, body: Buffer.from('pdf') });
    await expect(executeBuiltinAgentTool('tool.read_url', { url: 'https://example.com/a.pdf' }, signal)).rejects.toThrow(/texto/);
  });
  it('disponibiliza somente ferramentas conectadas ao registro', () => {
    const clock = createWorkflowNode('tool.clock', { id: 'clock', position: { x: 0, y: 0 } });
    const registry = createNexusToolRegistry({ workspaceId: 'workspace', toolNodes: [clock] });
    expect(registry.list().map(tool => tool.name)).toEqual(['current_time']);
    expect(clock.outputPorts[0].connectionType).toBe('tool');
  });
  it('pesquisa usando somente o endpoint configurado pelo operador', async () => {
    const signal = new AbortController().signal;
    vi.stubEnv('DIALOGY_AGENT_SEARCH_ENDPOINT', '');
    vi.stubEnv('DIALOGY_AGENT_SEARCH_TOKEN', '');
    await expect(executeBuiltinAgentTool('tool.web_search', { query: 'previsão' }, signal)).rejects.toThrow(/não configurado/);
    vi.stubEnv('DIALOGY_AGENT_SEARCH_ENDPOINT', 'https://search.example/v1/search');
    vi.stubEnv('DIALOGY_AGENT_SEARCH_TOKEN', 'search-secret');
    request.mockResolvedValueOnce({ headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ results: [{ title: 'Resultado', url: 'https://example.com/', snippet: 'Informação' }] })) });
    expect(await executeBuiltinAgentTool('tool.web_search', { query: 'previsão' }, signal)).toMatchObject({ results: [{ title: 'Resultado' }] });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://search.example/v1/search', method: 'POST', body: JSON.stringify({ query: 'previsão', maxResults: 8 }) }));
    vi.stubEnv('DIALOGY_AGENT_SEARCH_ENDPOINT', 'http://internal.example/');
    await expect(executeBuiltinAgentTool('tool.web_search', { query: 'x' }, signal)).rejects.toThrow(/inválida/);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('supports the Parallel Search API directly with an operator-provided key', async () => {
    vi.stubEnv('PARALLEL_API_KEY', 'parallel-secret');
    request.mockResolvedValueOnce({ headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ results: [{ title: 'Notícia', url: 'https://example.com/a', excerpts: ['Trecho atual'] }] })) });
    const result = await executeBuiltinAgentTool('tool.web_search', { query: 'pesquisa atual' }, new AbortController().signal);
    expect(result).toMatchObject({ results: [{ title: 'Notícia', url: 'https://example.com/a', snippet: 'Trecho atual' }] });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.parallel.ai/v1/search', headers: expect.objectContaining({ 'x-api-key': 'parallel-secret' }), body: JSON.stringify({ objective: 'pesquisa atual', search_queries: ['pesquisa atual'], advanced_settings: { max_results: 8 } }) }));
  });
  it('exige atestado do operador e envia limites ao sandbox remoto', async () => {
    const signal = new AbortController().signal;
    vi.stubEnv('DIALOGY_AGENT_SANDBOX_ENDPOINT', 'https://sandbox.example/v1/execute');
    vi.stubEnv('DIALOGY_AGENT_SANDBOX_TOKEN', 'sandbox-secret');
    vi.stubEnv('DIALOGY_AGENT_SANDBOX_ISOLATED', 'false');
    await expect(executeBuiltinAgentTool('tool.sandbox', { language: 'python', code: 'print(2)' }, signal)).rejects.toThrow(/atestado/);
    expect(request).not.toHaveBeenCalled();
    vi.stubEnv('DIALOGY_AGENT_SANDBOX_ISOLATED', 'true');
    request.mockResolvedValueOnce({ headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ version: 1, exitCode: 0, stdout: '2 sandbox-secret', stderr: '', timedOut: false })) });
    expect(await executeBuiltinAgentTool('tool.sandbox', { language: 'python', code: 'print(2)' }, signal)).toMatchObject({ stdout: '2 [protegido]', exitCode: 0 });
    const input = JSON.parse(request.mock.calls[0][0].body);
    expect(input).toMatchObject({ language: 'python', limits: { network: false, filesystem: 'ephemeral', memoryMb: 256, timeoutMs: 15000 } });
    await expect(executeBuiltinAgentTool('tool.sandbox', { language: 'ruby', code: 'a' }, signal)).rejects.toThrow();
  });
});
