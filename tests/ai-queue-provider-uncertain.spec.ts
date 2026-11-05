import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  processAutopilot: vi.fn(),
  handoff: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    query: mocks.dbQuery,
  },
}));

vi.mock('@/services/autopilot-service', () => ({
  processAutopilotForChat: mocks.processAutopilot,
}));

vi.mock('@/services/autopilot/runtime/failure-handoff', () => ({
  handoffAutopilotFailureToHuman: mocks.handoff,
}));

vi.mock('@/services/autopilot/learning-cycle', () => ({
  runAutopilotLearningCycle: vi.fn(),
}));

vi.mock('@/services/rag/case-memory', () => ({
  refreshCaseMemoryForChat: vi.fn(),
}));

vi.mock('@/services/rag/document-ingestion', () => ({
  ingestKnowledgeBaseDocument: vi.fn(),
}));

vi.mock('@/lib/realtime/chat-broadcast', () => ({
  broadcastHydratedChatUpdate: vi.fn(),
}));

import { handleAiQueueJob } from '@/lib/queue/ai-handlers';
import type { QueueJobRecord } from '@/lib/queue/types';
import { UncertainProviderDeliveryError } from '@/services/autopilot/runtime/provider-delivery';

describe('AI queue uncertain provider delivery', () => {
  beforeEach(() => {
    mocks.dbQuery.mockReset();
    mocks.processAutopilot.mockReset();
    mocks.handoff.mockReset();
    mocks.dbQuery.mockResolvedValue({
      rows: [{
        id: 'chat-1',
        workspace_id: 'workspace-1',
        status: 'atendimentos',
        agent_id: null,
        assigned_system_agent_id: 'system-agent-1',
        source: 'whatsapp',
        instance_type: 'baileys',
        is_autopilot_active: true,
        autopilot_config_id: 'config-1',
        copilot_mode: 'auto',
        contact_id: 'contact-1',
        contact_name: 'Cliente',
        contact_phone: '5500000000000',
        contact_phone_number_jid: '5500000000000@s.whatsapp.net',
      }],
      rowCount: 1,
    });
    mocks.processAutopilot.mockRejectedValue(
      new UncertainProviderDeliveryError('provider result unknown'),
    );
    mocks.handoff.mockResolvedValue(true);
  });

  it('hands off immediately and completes the queue job without a blind retry', async () => {
    const job: QueueJobRecord = {
      id: 'ai-job-1',
      type: 'ai_autopilot_process',
      status: 'active',
      payload: {
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
        messageId: 'message-1',
        instanceName: 'instance-1',
        lastMessageContent: 'Qual o status?',
      },
      attempts: 0,
      max_attempts: 3,
      run_at: new Date(0).toISOString(),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(handleAiQueueJob(job)).resolves.toBeUndefined();

    expect(mocks.processAutopilot).toHaveBeenCalledTimes(1);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining('ct.workspace_id = c.workspace_id'), ['chat-1','workspace-1']);
    expect(mocks.dbQuery.mock.calls[0][0]).toContain('c.workspace_id = $2');
    expect(mocks.processAutopilot.mock.calls[0][1].contact.phone).toBe('5500000000000');
    expect(mocks.handoff).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      systemAgentId: 'system-agent-1',
      sourceMessageId: 'message-1',
      failedToolNames: [],
      reason: 'uncertain_provider_delivery',
    });
    consoleError.mockRestore();
  });
});
