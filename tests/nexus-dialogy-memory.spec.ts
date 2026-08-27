import { describe, expect, it, vi } from 'vitest';

import { loadNexusDialogyMemory } from '@/modules/nexus/services/dialogy-memory';
import { WorkflowExecutionSchema, createWorkflowNode } from '@/services/workflow-runtime';

function execution() {
  return WorkflowExecutionSchema.parse({
    executionId: 'execution-1', workflowId: 'workflow-1', workflowVersion: 'v1',
    status: 'running', currentNodeId: 'agent', previousNodeId: null, pendingNodeIds: [],
    input: { customerMessage: 'Quero a segunda via.' }, variables: {}, context: {}, nodeResults: {}, executionPath: [],
    sessionId: '11111111-1111-4111-8111-111111111111',
    conversationId: '11111111-1111-4111-8111-111111111111',
    startedAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
    totalSteps: 0, totalModelCalls: 0, totalToolCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, version: 0,
  });
}

describe('Nexus Dialogy memory resource', () => {
  it('hydrates recent messages, contact facts and universal Dialogy memory', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ contact_id: '22222222-2222-4222-8222-222222222222' }] })
      .mockResolvedValueOnce({ rows: [
        { id: 'm2', content: 'Vou buscar sua fatura.', from_me: true, created_at: '2026-08-25T00:02:00.000Z' },
        { id: 'm1', content: 'Quero a segunda via.', from_me: false, created_at: '2026-08-25T00:01:00.000Z' },
      ] });
    const loadContactMemory = vi.fn().mockResolvedValue({
      slots: { name: 'Ana', customer_identifier: '12345678900' },
      nativeState: { stage: 'billing' },
      updatedAt: '2026-08-25T00:00:00.000Z',
    });
    const resolveMemory = vi.fn().mockResolvedValue({
      entries: [{
        id: 'memory-1', workspaceId: 'workspace-1', contactId: '22222222-2222-4222-8222-222222222222',
        layer: 'contact_fact', key: 'plan', value: '500 Mega', sourceType: 'conversation', scope: {},
        confidence: 0.9, observedAt: '2026-08-25T00:00:00.000Z', status: 'active',
      }],
      conflicts: [],
    });
    const node = createWorkflowNode('memory.session', {
      id: 'memory', position: { x: 0, y: 0 },
      config: { provider: 'dialogy', scope: 'hybrid', maxMessages: 20, maxAgeDays: 180 },
    });

    const result = await loadNexusDialogyMemory({
      workspaceId: 'workspace-1', execution: execution(), memoryNode: node,
      database: { query } as never, loadContactMemory, resolveMemory,
    });

    expect(result).toMatchObject({
      provider: 'dialogy', scope: 'hybrid',
      contactId: '22222222-2222-4222-8222-222222222222',
      knownFields: { name: 'Ana', customer_identifier: '12345678900', plan: '500 Mega' },
      nativeState: { stage: 'billing' },
      recentMessages: [
        expect.objectContaining({ id: 'm1', role: 'user', fromMe: false }),
        expect.objectContaining({ id: 'm2', role: 'assistant', fromMe: true }),
      ],
    });
    expect(loadContactMemory).toHaveBeenCalledWith(expect.objectContaining({ maxAgeDays: 180 }));
    expect(resolveMemory).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '11111111-1111-4111-8111-111111111111',
      contactId: '22222222-2222-4222-8222-222222222222',
    }));
  });

  it('gracefully returns empty native memory for non-chat executions', async () => {
    const value = execution();
    value.conversationId = 'nexus-test:manual';
    const query = vi.fn();
    const result = await loadNexusDialogyMemory({ workspaceId: 'workspace-1', execution: value, database: { query } as never });
    expect(query).not.toHaveBeenCalled();
    expect(result).toMatchObject({ provider: 'dialogy', conversationId: null, contactId: null, recentMessages: [], knownFields: {} });
  });
});
