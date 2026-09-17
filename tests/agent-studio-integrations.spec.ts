import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStudioHttpRequest, buildStudioMcpArguments, mapStudioOutputs, readStudioValue, resolveStudioEndpoint } from '@/services/agent-studio/data-mapping';
import { HttpRequestStepConfigSchema, McpToolStepConfigSchema } from '@/services/agent-studio/types';

const mocks = vi.hoisted(() => ({ http: vi.fn(), connections: vi.fn(), credential: vi.fn(), workspace: vi.fn(), mcp: vi.fn() }));
vi.mock('@/modules/nexus/services/http-executor', () => ({ executeNexusHttpOperation: mocks.http }));
vi.mock('@/modules/nexus/services/credentials', () => ({ listNexusCredentialSummaries: mocks.connections, loadNexusCredentialPayload: mocks.credential }));
vi.mock('@/services/mcp/store', () => ({ getMcpWorkspaceConfig: mocks.workspace }));
vi.mock('@/services/mcp/client', () => ({
  callMcpServerTool: mocks.mcp,
  parseQualifiedMcpToolName: (value: string) => {
    const parsed = /^mcp:([^:]+):(.+)$/.exec(value);
    return parsed ? { serverId: parsed[1], toolName: parsed[2] } : null;
  },
}));
import { executeStudioHttp, executeStudioMcp, mcpContractFingerprint } from '@/services/agent-studio/integrations';

const httpConfig = () => HttpRequestStepConfigSchema.parse({ name: 'Consultar', method: 'GET', url: '/invoices', connectionId: 'conn' });
const mcpConfig = () => McpToolStepConfigSchema.parse({ serverId: 'billing', qualifiedToolName: 'mcp:billing:get_invoice', friendlyToolName: 'Consultar fatura' });
const tool = { name: 'get_invoice', qualifiedName: 'mcp:billing:get_invoice', serverId: 'billing', serverName: 'Cobrança', inputSchema: { type: 'object', properties: { invoiceId: { type: 'number' } }, required: ['invoiceId'], additionalProperties: false }, annotations: { readOnlyHint: true } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connections.mockResolvedValue([{ id: 'conn', metadata: { kind: 'agent_http', baseUrl: 'https://billing.example/v1/', authType: 'bearer_token' } }]);
  mocks.credential.mockResolvedValue({ type: 'bearer', payload: { token: 'test-secret' } });
  mocks.http.mockResolvedValue({ status: 200, data: { invoices: [{ id: 7 }] } });
  mocks.workspace.mockResolvedValue({ servers: [{ id: 'billing', name: 'Cobrança', transport: 'streamable_http', isActive: true, tools: [tool] }] });
  mocks.mcp.mockResolvedValue({ structuredContent: { document: 'https://billing.example/invoice.pdf' }, content: [] });
});

describe('typed Studio mappings', () => {
  it('maps collected fields, earlier outputs, flow input and fixed values without templates', () => {
    const config = httpConfig();
    config.method = 'POST';
    config.url = '/invoices/{invoiceId}';
    config.sentDataMappings = [
      { apiField: 'invoiceId', location: 'path', sourceType: 'step_output', sourceValue: 'selected' },
      { apiField: 'customer.document', location: 'body', sourceType: 'collected_field', sourceValue: 'cpf' },
      { apiField: 'amount', location: 'body', sourceType: 'static_value', sourceValue: '19.50', valueType: 'number' },
      { apiField: 'channel', location: 'query', sourceType: 'flow_input', sourceValue: 'channel' },
    ];
    const request = buildStudioHttpRequest(config, { values: { cpf: '{{secret}}', selected: 'a/b' }, input: { channel: 'web' } }, 'https://billing.example');
    expect(request.url).toBe('https://billing.example/invoices/a%2Fb');
    expect(request.body).toEqual({ customer: { document: '{{secret}}' }, amount: 19.5 });
    expect(request.query).toEqual({ channel: 'web' });
  });

  it.each(['https://evil.example/read', '//evil.example/read', '\\evil.example', 'http://billing.example/read', 'https://user:password@billing.example'])('rejects unsafe credential destination %s', (url) => {
    expect(() => resolveStudioEndpoint(url, 'https://billing.example')).toThrow();
  });

  it('preserves array, number and boolean outputs and explicitly clears absent optional results', () => {
    const mappings = [
      { jsonPath: 'invoices', chipKey: 'invoices', chipLabel: 'Faturas' },
      { jsonPath: 'invoices[0].id', chipKey: 'id', chipLabel: 'Identificador' },
      { jsonPath: 'ok', chipKey: 'ok', chipLabel: 'Sucesso' },
      { jsonPath: 'missing', chipKey: 'optional', chipLabel: 'Opcional', required: false },
    ];
    expect(mapStudioOutputs({ invoices: [{ id: 7 }], ok: false }, mappings)).toEqual({ invoices: [{ id: 7 }], id: 7, ok: false, optional: null });
    expect(() => mapStudioOutputs({}, [mappings[0]])).toThrow('Faturas');
  });

  it('supports top-level array index paths like [0].id and $[0].id', () => {
    const mappings = [
      { jsonPath: '[0].ID', chipKey: 'deviceId', chipLabel: 'ID Equipamento' },
      { jsonPath: '$[0].name', chipKey: 'deviceName', chipLabel: 'Nome Equipamento' },
    ];
    const data = [{ ID: 'ROUTER-123', name: 'ZTE F670L' }];
    expect(mapStudioOutputs(data, mappings)).toEqual({
      deviceId: 'ROUTER-123',
      deviceName: 'ZTE F670L',
    });
  });

  it.each(['__proto__.secret', 'constructor.prototype.secret', 'prototype', 'a..b'])('rejects prototype and malformed path %s', (path) => {
    expect(() => readStudioValue({}, path)).toThrow();
  });

  it('rejects inherited values and missing data instead of sending an empty request', () => {
    expect(readStudioValue(Object.create({ document: 'secret' }), 'document')).toBeUndefined();
    const config = mcpConfig();
    config.argumentMappings = [{ argumentName: 'invoiceId', sourceChipKey: 'missing', sourceChipLabel: 'Fatura' }];
    expect(() => buildStudioMcpArguments(config, { values: {} })).toThrow('dado necessário');
  });

  it('does not coerce a false boolean to true or accept nonnumeric input', () => {
    const config = mcpConfig();
    config.argumentMappings = [{ argumentName: 'notify', sourceType: 'static_value', sourceChipKey: 'false', sourceChipLabel: 'Notificar', valueType: 'boolean' }];
    expect(buildStudioMcpArguments(config, { values: {} })).toEqual({ notify: false });
    config.argumentMappings[0].valueType = 'number';
    expect(() => buildStudioMcpArguments(config, { values: {} })).toThrow('número');
  });
});

describe('Studio HTTP execution', () => {
  it('retries transient GET failures within the configured limit', async () => {
    mocks.http.mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { retryable: true }));
    const result = await executeStudioHttp({ workspaceId: 'ws', config: httpConfig(), context: { values: {} }, confirmed: false });
    expect(result.statusCode).toBe(200); expect(mocks.http).toHaveBeenCalledTimes(2);
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('never repeats a confirmed %s after a transient failure', async (method) => {
    mocks.http.mockRejectedValue(Object.assign(new Error('Unknown outcome'), { retryable: true }));
    const config = HttpRequestStepConfigSchema.parse({ ...httpConfig(), method, maxRetries: 3 });
    await expect(executeStudioHttp({ workspaceId: 'ws', config, context: { values: {} }, confirmed: true })).rejects.toThrow('Unknown outcome');
    expect(mocks.http).toHaveBeenCalledOnce();
  });
  it('does not retry an invalid mapped response or a confirmation-gated GET', async () => {
    const config = httpConfig(); config.outputMappings = [{ chipKey: 'missing', chipLabel: 'Missing', jsonPath: 'missing' }];
    await expect(executeStudioHttp({ workspaceId: 'ws', config, context: { values: {} }, confirmed: false })).rejects.toThrow('Missing');
    expect(mocks.http).toHaveBeenCalledOnce(); mocks.http.mockClear();
    config.requiresConfirmation = true; mocks.http.mockRejectedValue(Object.assign(new Error('Unavailable'), { retryable: true }));
    await expect(executeStudioHttp({ workspaceId: 'ws', config, context: { values: {} }, confirmed: true })).rejects.toThrow();
    expect(mocks.http).toHaveBeenCalledOnce();
  });
  it('executes through the DNS-pinned executor, uses server credentials and maps real output', async () => {
    const config = httpConfig();
    config.outputMappings = [{ jsonPath: 'invoices', chipKey: 'invoices', chipLabel: 'Faturas' }];
    const result = await executeStudioHttp({ workspaceId: 'ws', config, context: { values: {} }, confirmed: false });
    expect(result.values.invoices).toEqual([{ id: 7 }]);
    expect(mocks.http.mock.calls[0][0].runtimeSource.studio.headers.Authorization).toBe('Bearer test-secret');
    expect(mocks.http.mock.calls[0][0].config.headers).toBe('{{studio.headers}}');
    expect(mocks.credential).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws', credentialId: 'conn' }));
  });

  it('blocks credential exfiltration before network execution', async () => {
    const config = httpConfig();
    config.url = 'https://evil.example';
    await expect(executeStudioHttp({ workspaceId: 'ws', config, context: { values: {} }, confirmed: false })).rejects.toThrow('mesmo servidor');
    expect(mocks.http).not.toHaveBeenCalled();
  });

  it('requires confirmation for writes even if client says confirmation is unnecessary', async () => {
    const config = httpConfig();
    config.method = 'DELETE';
    config.requiresConfirmation = false;
    await expect(executeStudioHttp({ workspaceId: 'ws', config, context: { values: {} }, confirmed: false })).rejects.toThrow('Confirme');
    expect(mocks.http).not.toHaveBeenCalled();
  });

  it('redacts secrets reflected by a remote server', async () => {
    mocks.http.mockResolvedValue({ status: 200, data: { echo: 'value=test-secret', authorization: 'other' } });
    const result = await executeStudioHttp({ workspaceId: 'ws', config: httpConfig(), context: { values: {} }, confirmed: false });
    expect(JSON.stringify(result)).not.toContain('test-secret');
    expect(result.response).toEqual({ echo: 'value=[protegido]', authorization: '[protegido]' });
  });

  it('aborts at the total deadline even before response headers', async () => {
    vi.useFakeTimers();
    try {
      mocks.http.mockImplementation(() => new Promise(() => undefined));
      const config = httpConfig();
      config.timeoutSeconds = 1;
      const pending = executeStudioHttp({ workspaceId: 'ws', config, context: { values: {} }, confirmed: false });
      const assertion = expect(pending).rejects.toThrow('tempo limite');
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
      expect(mocks.http.mock.calls[0][0].signal.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('Studio MCP execution', () => {
  const configured = () => ({ ...mcpConfig(), argumentMappings: [{ argumentName: 'invoiceId', sourceChipKey: 'invoice', sourceChipLabel: 'Fatura' }], outputMappings: [{ jsonPath: 'document', chipKey: 'document', chipLabel: 'Documento' }] });

  it('uses typed mapped arguments, validates schema and extracts output', async () => {
    const result = await executeStudioMcp({ workspaceId: 'ws', config: configured(), context: { values: { invoice: 7 } }, confirmed: false });
    expect(mocks.mcp).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'get_invoice', arguments: { invoiceId: 7 } }));
    expect(result.values.document).toContain('invoice.pdf');
  });

  it('rejects wrong input types before calling the tool', async () => {
    await expect(executeStudioMcp({ workspaceId: 'ws', config: configured(), context: { values: { invoice: 'seven' } }, confirmed: true })).rejects.toThrow('tipos exigidos');
    expect(mocks.mcp).not.toHaveBeenCalled();
  });

  it('requires server-derived confirmation and cannot be downgraded by browser riskLevel', async () => {
    mocks.workspace.mockResolvedValue({ servers: [{ id: 'billing', isActive: true, tools: [{ ...tool, annotations: { destructiveHint: true } }] }] });
    await expect(executeStudioMcp({ workspaceId: 'ws', config: configured(), context: { values: { invoice: 7 } }, confirmed: false })).rejects.toThrow('confirmação');
    expect(mocks.mcp).not.toHaveBeenCalled();
  });

  it('rejects tools absent from the synchronized catalog', async () => {
    mocks.workspace.mockResolvedValue({ servers: [{ id: 'billing', isActive: true, tools: [] }] });
    await expect(executeStudioMcp({ workspaceId: 'ws', config: configured(), context: { values: { invoice: 7 } }, confirmed: true })).rejects.toThrow('não está disponível');
    expect(mocks.mcp).not.toHaveBeenCalled();
  });

  it('rejects a changed tool contract and treats isError as failure', async () => {
    await expect(executeStudioMcp({ workspaceId: 'ws', config: configured(), context: { values: { invoice: 7 } }, confirmed: true, expectedFingerprint: 'old' })).rejects.toThrow('mudou');
    expect(mocks.mcp).not.toHaveBeenCalled();
    mocks.mcp.mockResolvedValue({ isError: true, content: [] });
    await expect(executeStudioMcp({ workspaceId: 'ws', config: configured(), context: { values: { invoice: 7 } }, confirmed: true, expectedFingerprint: mcpContractFingerprint(tool, { id: 'billing', transport: 'streamable_http' }) })).rejects.toThrow('informou falha');
  });
});
