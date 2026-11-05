import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), deliver: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/services/whatsapp/deliver-catalog', () => ({ deliverWhatsappCatalog: mocks.deliver }));

import { executeNexusIntegration } from '@/modules/nexus/services/integration-executors';
import { InMemoryWorkflowPersistence, WorkflowExecutor, createDefaultNodeHandlerRegistry, validateWorkflowDefinition } from '@/services/workflow-runtime';
import { connect, workflowDefinition, workflowNode } from './workflow-runtime-fixtures';

const cards = [{ title: 'Produto de {{variables.customer}}', body: 'R$ 99,90', imageUrl: 'https://cdn.example.com/product.jpg', buttons: [{ type: 'reply', displayText: 'Quero', id: 'product-1' }] }];

function definition() {
  const start = workflowNode('trigger.received_message', 'start');
  const send = workflowNode('whatsapp.send_catalog', 'catalog', { body: 'Olá, {{variables.customer}}!', cards, outputKey: 'delivery.catalog' });
  const end = workflowNode('output.end', 'end');
  return workflowDefinition([start, send, end], [connect(start, 'message', send, 'main'), connect(send, 'success', end, 'main')], { workspaceId: 'ws-1', metadata: { senderSystemAgentId: 'agent-1' } });
}

describe('catalog workflow execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [{ id: 'agent-1' }] });
    mocks.deliver.mockResolvedValue({ success: true, message: { id: 'message-1', message_id_from_api: 'provider-1' } });
  });
  it('materializes variables and sends to the execution conversation', async () => {
    const executor = new WorkflowExecutor(new InMemoryWorkflowPersistence(), createDefaultNodeHandlerRegistry({ executeIntegration: executeNexusIntegration }));
    const run = await executor.start({ workflow: definition(), input: { message: 'Catálogo' }, conversationId: 'chat-1', variables: { customer: 'Ana' } });
    expect(run.status).toBe('completed');
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1', chatId: 'chat-1', senderSystemAgentId: 'agent-1', catalog: expect.objectContaining({ body: 'Olá, Ana!', cards: [expect.objectContaining({ title: 'Produto de Ana' })] }) }));
    expect(run.variables.delivery).toMatchObject({ catalog: { providerMessageId: 'provider-1', products: 1 } });
  });
  it('does not report a successful workflow delivery when acceptance is unknown', async () => {
    mocks.deliver.mockResolvedValue({ success: true, warning: 'Envio incerto' });
    const executor = new WorkflowExecutor(new InMemoryWorkflowPersistence(), createDefaultNodeHandlerRegistry({ executeIntegration: executeNexusIntegration }));
    const run = await executor.start({ workflow: definition(), input: {}, conversationId: 'chat-1', variables: { customer: 'Ana' } });
    expect(run.nodeResults.catalog?.status).toBe('error');
    expect(run.nodeResults.catalog?.error?.code).toBe('EXTERNAL_OUTCOME_UNKNOWN');
  });
  it('rejects missing products at publication while accepting variable URLs', () => {
    const workflow = definition();
    const node = workflow.nodes.find((candidate) => candidate.id === 'catalog')!;
    node.config.cards = [{ ...cards[0], imageUrl: '{{variables.product.photo}}' }];
    expect(validateWorkflowDefinition(workflow).errors.some((error) => error.code === 'whatsapp_catalog_config_invalid')).toBe(false);
    node.config.cards = [];
    expect(validateWorkflowDefinition(workflow).errors.some((error) => error.code === 'whatsapp_catalog_config_invalid')).toBe(true);
  });
});
