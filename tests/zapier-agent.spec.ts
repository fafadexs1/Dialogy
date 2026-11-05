import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ credential: vi.fn(), approval: vi.fn(), effect: vi.fn(), request: vi.fn() }));
vi.mock('@/modules/nexus/services/credentials', () => ({ loadNexusCredentialPayload: mocks.credential }));
vi.mock('@/modules/nexus/services/automation-approvals', () => ({ requestAutomationApproval: mocks.approval }));
vi.mock('@/modules/nexus/services/durable-effects', () => ({ executeDurableEffect: mocks.effect }));
vi.mock('@/modules/nexus/services/public-http', () => ({ requestPublicHttps: mocks.request }));
vi.mock('@/modules/nexus/services/toolbox-policy', () => ({ assertAutomationToolboxEnabled: vi.fn() }));
import { triggerZapierWebhook } from '@/modules/nexus/services/zapier-agent';

const input = { workflow: { workspaceId: 'workspace' }, node: { id: 'zap', config: { credentialId: 'credential' } }, signal: new AbortController().signal } as never;
beforeEach(() => { vi.resetAllMocks(); mocks.credential.mockResolvedValue({ payload: { value: 'https://hooks.zapier.com/hooks/catch/12345/private-secret/' } }); mocks.approval.mockResolvedValue(null); mocks.effect.mockImplementation(async (_workspace, _id, _proposal, run) => run()); mocks.request.mockResolvedValue({ status: 200 }); });
describe('Zapier tool', () => {
  it('requires approval without revealing the secret webhook URL', async () => {
    mocks.approval.mockResolvedValueOnce({ status: 'waiting', resumeToken: 'approval' });
    expect((await triggerZapierWebhook(input, { data: { name: 'Ana' } }, 'once')).status).toBe('waiting');
    expect(mocks.request).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.approval.mock.calls[0])).not.toContain('private-secret');
  });
  it('sends approved data once through the durable effect', async () => {
    expect((await triggerZapierWebhook(input, { data: { name: 'Ana' } }, 'once')).output).toEqual({ accepted: true, service: 'Zapier' });
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', body: '{"name":"Ana"}', maxResponseBytes: 64000 }));
    expect(mocks.effect).toHaveBeenCalledTimes(1);
  });
  it('rejects arbitrary destinations and oversized payloads', async () => {
    mocks.credential.mockResolvedValueOnce({ payload: { value: 'https://evil.example/hooks/catch/123/x' } });
    await expect(triggerZapierWebhook(input, { data: {} }, 'once')).rejects.toThrow('Catch Hook');
    await expect(triggerZapierWebhook(input, { data: { text: 'a'.repeat(33000) } }, 'once')).rejects.toThrow('32 KB');
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
