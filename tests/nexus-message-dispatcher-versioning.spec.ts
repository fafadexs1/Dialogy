import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  cancel: vi.fn(),
  load: vi.fn(),
  resolveOption: vi.fn(),
  resume: vi.fn(),
  start: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/modules/nexus/services/runtime', () => ({
  cancelPublishedNexusWorkflowExecution: mocks.cancel,
  loadPublishedNexusWorkflow: mocks.load,
  resolveNexusInteractionOption: mocks.resolveOption,
  resumePublishedNexusWorkflow: mocks.resume,
  startPublishedNexusWorkflow: mocks.start,
}));

import { dispatchPublishedNexusMessage } from '@/modules/nexus/services/message-dispatcher';
import { workflowDefinition, workflowNode } from './workflow-runtime-fixtures';

describe('Nexus message dispatcher published-version ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancel.mockResolvedValue({ status: 'cancelled' });
  });

  it('cancels a v11 waiter and never resumes it after v12 is published', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          status: 'gerais',
          agent_id: null,
          assigned_system_agent_id: null,
          contact_id: 'contact-1',
          source: 'whatsapp',
          instance_type: 'evolution',
          contact_name: 'Cliente',
          phone: '5561995215930',
          phone_number_jid: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          execution_id: 'execution-v11',
          current_node_id: 'old-question',
          resume_token: 'resume-v11',
          workflow_version: 'v11',
          published_workflow_version: 'v12',
          definition: {},
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await dispatchPublishedNexusMessage({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      message: 'Olá novamente',
      sourceMessageId: 'message-1',
      instanceName: 'zap1',
      adapters: {} as never,
    });

    expect(mocks.cancel).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      executionId: 'execution-v11',
      reason: 'Execução da versão v11 substituída pela versão publicada v12.',
    });
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(result).toEqual({ handled: false, resumed: false, executions: [] });
  });

  it.each([
    { type: 'logic.approval', reason: 'approval', config: {}, accepts: false },
    { type: 'logic.map_subflow', reason: 'subflows', config: {}, accepts: false },
    { type: 'logic.wait', reason: 'event', config: { mode: 'event', resumeEvent: 'payment_confirmed' }, accepts: false },
    { type: 'logic.wait', reason: 'time', config: { mode: 'time' }, accepts: false },
    { type: 'logic.wait', reason: 'message', config: { mode: 'message' }, accepts: true },
    { type: 'interaction.input', reason: 'time', config: {}, accepts: true },
    { type: 'dialogy.sgp_identify_customer', reason: 'time', config: {}, accepts: true },
  ])('keeps the pinned version and routes a message correctly for $type / $reason', async ({ type, reason, config, accepts }) => {
    mocks.query.mockResolvedValueOnce({ rows: [{ status: 'gerais', agent_id: null, assigned_system_agent_id: null }] })
      .mockResolvedValueOnce({ rows: [{ execution_id: 'pinned-v11', current_node_id: 'wait', resume_token: 'resume-v11', workflow_version: 'v11', published_workflow_version: 'v12', context: { automationManaged: true }, waiting_reason: reason,
        definition: workflowDefinition([workflowNode(type, 'wait', config)], [], { id: 'nexus:flow', version: 'v11', workspaceId: 'workspace-1' }) }] });
    mocks.resume.mockResolvedValue({ execution: { executionId: 'pinned-v11' } });
    const result = await dispatchPublishedNexusMessage({ workspaceId: 'workspace-1', chatId: 'chat-1', message: 'Uma nova mensagem', sourceMessageId: 'message-2', adapters: {} as never });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.resume).toHaveBeenCalledTimes(accepts ? 1 : 0);
    expect(result).toMatchObject({ handled: true, resumed: accepts });
  });
});
