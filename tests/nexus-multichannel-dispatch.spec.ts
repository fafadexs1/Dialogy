import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), start: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/modules/nexus/services/runtime', () => ({
  cancelPublishedNexusWorkflowExecution: vi.fn(), loadPublishedNexusWorkflow: mocks.load,
  resolveNexusInteractionOption: vi.fn(), resumePublishedNexusWorkflow: vi.fn(),
  startPublishedNexusWorkflow: mocks.start,
}));

import { dispatchPublishedNexusMessage } from '@/modules/nexus/services/message-dispatcher';
import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';

beforeEach(() => { vi.resetAllMocks(); });

it.each([
  ['instagram', 'Instagram page', true], ['messenger', 'Facebook page', true],
  ['webchat', '', true], ['telegram', 'bot1', true],
  ['whatsapp', 'zap1', true], ['whatsapp', 'zap2', false],
] as const)('dispatches published instance-scoped flows for %s / %s: %s', async (platform, instanceName, handled) => {
  const definition = WorkflowDefinitionSchema.parse({
    id: 'nexus:flow-1', workspaceId: 'workspace-1', name: 'Published flow', version: 'v1', status: 'published',
    createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z', settings: {},
    nodes: [createWorkflowNode('trigger.received_message', {
      id: 'trigger', position: { x: 0, y: 0 },
      config: { instanceNames: ['zap1'], startPolicy: 'unassigned_only' },
    })],
  });
  mocks.query.mockResolvedValueOnce({ rows: [{
    status: 'gerais', contact_id: 'contact-1', contact_name: 'Customer', source: platform,
    agent_id: null, assigned_system_agent_id: null,
  }] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{
    id: 'flow-1', definition, instance_platforms: { zap1: 'whatsapp', bot1: 'telegram' },
  }] });
  mocks.load.mockResolvedValue({ definition });
  mocks.start.mockResolvedValue({ execution: { status: 'waiting' } });
  const result = await dispatchPublishedNexusMessage({
    workspaceId: 'workspace-1', chatId: 'chat-1', message: 'Olá', sourceMessageId: 'message-1', instanceName,
    // Sender metadata cannot overwrite the trusted channel registry.
    metadata: { platform, instancePlatforms: { zap1: 'telegram' } }, adapters: {} as never,
  });
  expect(result.handled).toBe(handled);
  expect(mocks.start).toHaveBeenCalledTimes(handled ? 1 : 0);
  const [query, parameters] = mocks.query.mock.calls[2];
  expect(query).toContain('FROM public.evolution_api_instances WHERE workspace_id = $1');
  expect(parameters).toEqual(['workspace-1']);
  if (handled) expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: 'chat-1', context: expect.objectContaining({ platform }),
  }));
});
