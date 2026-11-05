import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSchema } from 'genkit/schema';
import { financialAppTemplates } from '@/services/workflow-runtime/financial-app-templates';
import { ConnectorDefinitionSchema } from '@/services/workflow-runtime/connector-contract';
const mocks = vi.hoisted(() => ({ request: vi.fn(), credential: vi.fn() }));
vi.mock('@/modules/nexus/services/public-http', () => ({ requestPublicHttps: mocks.request }));
vi.mock('@/modules/nexus/services/credentials', () => ({ loadNexusCredentialPayload: mocks.credential }));
vi.mock('@/modules/nexus/services/workflow-files', () => ({ saveWorkflowFile: vi.fn(), loadWorkflowFile: vi.fn() }));
import { executeNexusHttpOperation } from '@/modules/nexus/services/http-executor';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.credential.mockResolvedValue({ type: 'bearer', payload: { token: 'example-token' }, metadata: {} });
  mocks.request.mockResolvedValue({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{}') });
});
describe('financial app read operations', () => {
  it.each(financialAppTemplates.map((template) => [template.id, template] as const))('%s uses the fixed origin and workspace credential', async (id, template) => {
    const args = id === 'mercadopago_search' ? { reference: 'invoice-123' } : {};
    expect(validateSchema(args, { jsonSchema: template.definition.inputSchema }).valid).toBe(true);
    expect(template.definition.http.method).toBe('GET');
    await executeNexusHttpOperation({ workspaceId: 'workspace', config: { ...template.definition.http, credentialId: 'credential' }, runtimeSource: { arguments: args }, signal: AbortSignal.timeout(5000) });
    const request = mocks.request.mock.calls[0][0];
    expect(new URL(request.url).origin).toBe(new URL(template.definition.http.url).origin);
    expect(request.headers.Authorization).toBe('Bearer example-token');
    expect(request.body).toBeUndefined();
  });
  it('passes an Asaas token using its configured header without exposing it in the URL', async () => {
    mocks.credential.mockResolvedValueOnce({ type: 'api_key', payload: { name: 'access_token', value: 'private-token' }, metadata: {} });
    const template = financialAppTemplates.find((entry) => entry.id === 'asaas_payments_sandbox')!;
    await executeNexusHttpOperation({ workspaceId: 'workspace', config: { ...template.definition.http, credentialId: 'credential' }, runtimeSource: {}, signal: AbortSignal.timeout(5000) });
    const request = mocks.request.mock.calls[0][0];
    expect(request.headers.access_token).toBe('private-token');
    expect(request.url).not.toContain('private-token');
  });
  it('cannot silently change financial operations into mutations', () => {
    for (const template of financialAppTemplates) for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(ConnectorDefinitionSchema.safeParse({ ...template.definition, approval: 'automatic', http: { ...template.definition.http, method } }).success).toBe(false);
    }
  });
});
