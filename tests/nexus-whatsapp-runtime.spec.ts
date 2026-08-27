import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchEvolutionAPIMock, getEvolutionApiConfigMock, resolveSafeTargetMock } = vi.hoisted(() => ({
  fetchEvolutionAPIMock: vi.fn(),
  getEvolutionApiConfigMock: vi.fn(),
  resolveSafeTargetMock: vi.fn(),
}));

vi.mock('@/lib/whatsapp/evolution-api-client', () => ({ fetchEvolutionAPI: fetchEvolutionAPIMock }));
vi.mock('@/lib/whatsapp/evolution-config', () => ({ getEvolutionApiConfig: getEvolutionApiConfigMock }));
vi.mock('@/services/autopilot/automation-rules', () => ({ resolveSafeAutopilotWebhookTarget: resolveSafeTargetMock }));

import { executeNexusIntegration } from '@/modules/nexus/services/integration-executors';
import {
  InMemoryWorkflowPersistence,
  WorkflowExecutor,
  createDefaultNodeHandlerRegistry,
} from '@/services/workflow-runtime';
import { connect, workflowDefinition, workflowNode } from './workflow-runtime-fixtures';

function executor() {
  return new WorkflowExecutor(
    new InMemoryWorkflowPersistence(),
    createDefaultNodeHandlerRegistry({ executeIntegration: executeNexusIntegration }),
  );
}

describe('Nexus WhatsApp operational sends', () => {
  beforeEach(() => {
    fetchEvolutionAPIMock.mockReset().mockResolvedValue({ key: { id: 'wamid-test' } });
    getEvolutionApiConfigMock.mockReset().mockResolvedValue({ baseUrl: 'https://evolution.example.com', apiKey: 'secret', instanceName: 'zap1' });
    resolveSafeTargetMock.mockReset().mockResolvedValue({
      url: new URL('https://cdn.example.com/fatura.pdf'),
      addresses: ['203.0.113.10'],
    });
  });

  it('sends imported text to the configured phone and stores the result', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const send = workflowNode('whatsapp.send_text', 'send-text', {
      instanceName: 'zap1',
      phoneNumber: '{{variables.customer.phone}}',
      message: 'Olá, {{variables.customer.name}}!',
      outputKey: 'delivery.text',
    });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, send, end],
      [connect(trigger, 'started', send, 'main'), connect(send, 'success', end, 'main')],
      { workspaceId: 'workspace-1' },
    );

    const execution = await executor().start({
      workflow,
      input: {},
      variables: { customer: { phone: '+55 (11) 99999-9999', name: 'Ana' } },
    });

    expect(execution.status).toBe('completed');
    expect(getEvolutionApiConfigMock).toHaveBeenCalledWith('zap1', { workspaceId: 'workspace-1', allowLegacyInstanceName: true });
    expect(fetchEvolutionAPIMock).toHaveBeenCalledWith('/message/sendText/zap1', expect.any(Object), {
      method: 'POST',
      body: JSON.stringify({ number: '5511999999999', text: 'Olá, Ana!' }),
    });
    expect(execution.variables.delivery).toMatchObject({
      text: { instanceName: 'zap1', phoneNumber: '5511999999999' },
    });
  });

  it('validates the media URL and sends a document with its metadata', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const send = workflowNode('whatsapp.send_media', 'send-media', {
      instanceName: 'zap1',
      phoneNumber: '5511999999999',
      mediaType: 'document',
      url: 'https://cdn.example.com/fatura.pdf',
      caption: 'Sua fatura',
      fileName: 'fatura.pdf',
      outputKey: 'delivery.media',
    });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, send, end],
      [connect(trigger, 'started', send, 'main'), connect(send, 'success', end, 'main')],
      { workspaceId: 'workspace-1' },
    );

    const execution = await executor().start({ workflow, input: {} });

    expect(execution.status).toBe('completed');
    expect(resolveSafeTargetMock).toHaveBeenCalledWith('https://cdn.example.com/fatura.pdf');
    expect(fetchEvolutionAPIMock).toHaveBeenCalledWith('/message/sendMedia/zap1', expect.any(Object), {
      method: 'POST',
      body: JSON.stringify({
        number: '5511999999999',
        mediatype: 'document',
        mimetype: 'application/pdf',
        media: 'https://cdn.example.com/fatura.pdf',
        caption: 'Sua fatura',
        fileName: 'fatura.pdf',
      }),
    });
    expect(execution.variables.delivery).toMatchObject({
      media: { mediaType: 'document', mediaUrl: 'https://cdn.example.com/fatura.pdf' },
    });
  });
});
