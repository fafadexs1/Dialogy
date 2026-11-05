import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ persistence: null as any, decisions: [] as unknown[], runAgentTools: vi.fn() }));
vi.mock('@/services/agent-tools/runtime', () => ({ runAgentTools: mocks.runAgentTools }));
vi.mock('@/services/ai/platform-config', () => ({
  platformModel: async () => ({ id: 'fake' }), platformApiKey: async () => '',
}));
vi.mock('@/services/workflow-runtime/autopilot-rollout', () => ({ isWorkflowRuntimeV2ModeEnabled: async () => false }));
vi.mock('@/services/workflow-runtime/postgres-persistence', () => ({
  PostgresWorkflowPersistence: class { constructor() { return mocks.persistence; } },
}));
vi.mock('@/services/workflow-runtime/adapters/runtime-provider', () => ({
  RuntimeProviderModelAdapter: class {
    async supportsTools() { return true; }
    async supportsStructuredOutput() { return true; }
    async generateStructured(request: { schema: { parse: (value: unknown) => unknown } }) {
      return request.schema.parse(mocks.decisions.shift());
    }
  },
}));

import { InMemoryWorkflowPersistence } from '@/services/workflow-runtime/persistence';
import { runAutopilotWorkflowRuntimeV2Primary } from '@/services/workflow-runtime/autopilot-primary';
import { connect, workflowDefinition, workflowNode } from './workflow-runtime-fixtures';

describe('native workflow response preparation and persisted recovery', () => {
  it.each([true, false])('persists verified content before delivery, with provider success=%s', async (success) => {
    const persistence = new InMemoryWorkflowPersistence();
    mocks.persistence = persistence;
    mocks.decisions = [
      { type: 'tool_call', toolName: 'sgp_fetch_contact_panel_data', arguments: {}, purposeSummary: 'Consultar fatura.' },
      { type: 'final', response: 'Rascunho incorreto com outro código e outro mês.', completionStatus: 'completed' },
    ];
    const pix = '000201SYNTHETIC6304ABCD';
    mocks.runAgentTools.mockReset().mockImplementation(async (_context, actions) => [{
      toolName: 'sgp_fetch_contact_panel_data', status: 'success', input: actions[0],
      output: { invoices: [{ id: '8002', contractId: '7001', dueDate: '2026-11-10', amount: 10,
        correctedAmount: 10, isOpen: true, isPaid: false, isCancelled: false, pixCode: pix }] },
    }]);
    const trigger = workflowNode('trigger.manual', 'trigger');
    const model = workflowNode('ai.model', 'model', { provider: 'fake', model: 'fake', maxRetries: 0, supportsTools: true, supportsStructuredOutput: true });
    const tool = workflowNode('tool.internal', 'sgp', { name: 'sgp_fetch_contact_panel_data', description: 'Consulta atual do cliente no SGP.', inputSchema: {} });
    const agent = workflowNode('ai.agent', 'agent', { name: 'Sofia', role: 'billing', objective: 'Entregar a fatura solicitada.',
      instructions: ['Consulte o SGP antes de responder.'], completionCriteria: ['Fatura verificada.'] });
    const respond = workflowNode('output.respond', 'respond', { message: '{{current.response}}' });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition([trigger, model, tool, agent, respond, end], [
      connect(trigger, 'started', agent, 'main'), connect(model, 'model', agent, 'model', 'model'),
      connect(tool, 'tool', agent, 'tools', 'tool'), connect(agent, 'completed', respond, 'main'),
      connect(respond, 'success', end, 'main'),
    ]);
    await persistence.saveWorkflowDefinition(workflow);
    const sendResponse = vi.fn(async () => ({ success, ...(success ? {} : { error: 'provider unavailable' }) }));
    const input = {
      config: { workflow_builder_mode: 'native_v2', workflow_runtime_v2_mode: 'primary', workspace_id: 'workspace-1',
        active_workflow_id: workflow.id, active_workflow_version: workflow.version } as any,
      chatId: 'chat-1', sourceMessageId: 'message-1', customerMessage: 'PIX da fatura 8002', staticDocuments: [],
      dependencies: {
        database: { query: vi.fn() } as any, responseTimeZone: 'America/Sao_Paulo',
        toolContext: { workspaceId: 'workspace-1', customerMessage: 'PIX da fatura 8002', chat: { id: 'chat-1' },
          turnPolicy: { toolMode: 'allow', globallyEnabledToolNames: ['sgp_fetch_contact_panel_data'], attachedToolNames: [], allowedToolNames: [] } } as any,
        recentMessages: [], structuredMemory: { knownFields: { customer_identifier: '52998224725' } },
        sendResponse, handoff: async () => ({}), closeConversation: async () => ({}),
      },
    };
    const first = await runAutopilotWorkflowRuntimeV2Primary(input);
    expect(sendResponse, JSON.stringify(first)).toHaveBeenCalledOnce();
    expect(first.status).toBe(success ? 'completed' : 'failed');
    const sent = sendResponse.mock.calls[0] as unknown as [string, unknown, { preserveFormatting: boolean; blocks: string[] }];
    expect(sent[0]).toContain(pix);
    expect(sent[0]).not.toContain('Rascunho incorreto');
    expect(sent[2]).toMatchObject({ preserveFormatting: true });
    expect(sent[2].blocks.join('\n\n')).toContain(pix);
    const stored = await persistence.getExecution(first.executionId!);
    expect((stored?.nodeResults.agent as any)?.output?.response).toContain(pix);
    const second = await runAutopilotWorkflowRuntimeV2Primary(input);
    expect(second.recoveryResponse).toContain(pix);
    expect(second.recoveryResponse).not.toContain('Rascunho incorreto');
    expect(sendResponse).toHaveBeenCalledOnce();
    expect(mocks.runAgentTools).toHaveBeenCalledOnce();
  });
});
