import { describe, expect, it, vi } from 'vitest';
import { createStandaloneNexusWorkflow } from '@/modules/nexus/services/standalone-workflows';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';
import { WorkflowExecutor } from '@/services/workflow-runtime/executor';
import { InMemoryWorkflowPersistence } from '@/services/workflow-runtime/persistence';
import { createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime/node-handlers';
import type { NodeRuntimeInput, WorkflowExecution } from '@/services/workflow-runtime/types';
import { renderTemplate } from '@/services/workflow-runtime/utils';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function createAuroraDemoHarness(options: { modelFails?: boolean; generatedText?: string } = {}) {
  const workflow = createStandaloneNexusWorkflow({ id: 'aurora-test', workspaceId: '5c3a91e9-b243-4436-80ba-42434bc5ca97', name: 'Aurora Work · demonstração', template: 'sales_demo' });
  const messages: Array<{ nodeId: string; text: string; simulated: true }> = [];
  const conversation: Array<{ role: 'user' | 'assistant'; text: string }> = [{ role: 'user', text: 'demo aurora' }];
  const persistence = new InMemoryWorkflowPersistence();
  const handlers = createDefaultNodeHandlerRegistry({
    sendResponse: async (text, input) => { messages.push({ nodeId: input.node.id, text, simulated: true }); conversation.push({ role: 'assistant', text }); return { success: true, simulated: true }; },
    resolveModelChain: async () => ({ generateStructured: async (request: { messages: Array<{ content: string }> }) => {
      if (options.modelFails) throw new Error('SIMULATED_MODEL_NOT_CONFIGURED');
      const question = request.messages.at(-1)?.content.toLowerCase() || '';
      const routeId = /pare|cancelar|encerrar/.test(question) ? 'stop' : /humano|pessoa/.test(question) ? 'human' : /garantia|devolu/.test(question) ? 'warranty' : /frete|entrega/.test(question) ? 'delivery' : /caro|preço|preco|desconto/.test(question) ? 'price' : 'compare';
      return { output: { routeId, confidence: 0.98 }, selected: { config: { model: 'deepseek/deepseek-flash' } } };
    } }) as never,
    executePrompt: async (input: NodeRuntimeInput) => {
      if (options.modelFails) throw new Error('SIMULATED_MODEL_NOT_CONFIGURED');
      const source = { variables: input.execution.variables };
      const text = options.generatedText || renderTemplate('Vamos pensar no conforto do seu espaço, {{variables.lead.name}}. A opção sugerida pode ajudar você a montar uma rotina mais agradável.', source);
      return { status: 'success', selectedOutput: 'success', output: { text, simulated: true }, statePatch: { aiPitch: text }, metrics: { durationMs: 0, modelCalls: 1 } };
    },
  });
  const executor = new WorkflowExecutor(persistence, handlers);
  let execution: WorkflowExecution;
  return { workflow, messages, conversation, persistence, executor,
    async start() { execution = await executor.start({ workflow, triggerNodeId: 'demo_start', input: { text: 'demo aurora' }, context: { automationManaged: true, startedAt: '2026-10-25T00:00:00.000Z', sessionId: 'synthetic-test' } }); return execution; },
    async reply(node: string, value: string) {
      if (execution.status !== 'waiting') throw new Error(JSON.stringify({ status: execution.status, node: execution.currentNodeId, failure: execution.failure, results: execution.nodeResults }));
      expect(execution.status).toBe('waiting'); expect(execution.currentNodeId).toBe(node);
      const configuredOptions = workflow.nodes.find(item => item.id === node)?.config.options as Array<{ id: string; label: string }> | undefined;
      conversation.push({ role: 'user', text: configuredOptions?.find(option => option.id === value)?.label || value });
      execution = await executor.resume({ resumeToken: execution.resumeToken!, input: { value, text: value, message: value, selectedOptionId: value } });
      return execution;
    },
    get current() { return execution; },
  };
}

describe('Aurora Work fictional sales journey', () => {
  it('is a valid complete graph with only the DeepSeek credential pending', () => {
    const h = createAuroraDemoHarness();
    expect(validateWorkflowDefinition(h.workflow)).toMatchObject({ valid: true, errors: [], warnings: [] });
    expect(validateWorkflowDefinition(h.workflow, { availableModelIds: [] }).errors.map(issue => issue.code)).toEqual(['model_not_configured']);
    expect(h.workflow.nodes.filter(node => /integration\.|dialogy\.|whatsapp\.|audio\./.test(node.type))).toEqual([]);
    expect(h.workflow.nodes.find(node => node.id === 'demo_deepseek')?.config).toMatchObject({ provider: 'deepseek', model: 'deepseek/deepseek-flash', maxRetries: 0 });
  });
  it('qualifies a lead, offers a kit, computes PIX and confirms only a simulated order', async () => {
    const h = createAuroraDemoHarness(); await h.start();
    await h.reply('demo_entry', 'consult'); await h.reply('demo_name', 'Maria'); await h.reply('demo_need', 'completo');
    await h.reply('demo_budget', '2000'); await h.reply('demo_urgency', 'now');
    expect(h.current.variables.advice).toMatchObject({ productId: 'kit', score: 100, budgetFit: true });
    await h.reply('demo_choose', 'kit'); await h.reply('demo_upsell', 'yes'); await h.reply('demo_payment', 'pix');
    expect(h.current.variables.order).toBeUndefined();
    expect(h.current.variables.quote).toMatchObject({ subtotalCents: 189800, discountCents: 9490, shippingCents: 0, totalCents: 180310 });
    await h.reply('demo_confirm', 'yes'); const result = await h.reply('demo_feedback', 'yes');
    expect(result.status).toBe('completed'); expect(result.variables.order).toMatchObject({ fictional: true, paymentCollected: false, externalSideEffects: [], status: 'simulated_confirmed', totalCents: 180310 });
    expect(result.totalToolCalls).toBe(0); expect(h.messages.some(message => message.text.includes('Simulação confirmada'))).toBe(true);
    if (process.env.CAPTURE_AURORA_DEMO === '1') {
      const directory = resolve('artifacts/workflows/aurora-work'); await mkdir(directory, { recursive: true });
      const scope = 'Conversa executada pelo motor real com persistência em memória, IA simulada e envio interceptado. Não é homologação de DeepSeek nem envio a contato real.';
      await writeFile(resolve(directory, 'conversa-de-teste.json'), JSON.stringify({ scope, status: result.status, modelCalls: result.totalModelCalls, externalTools: result.totalToolCalls, order: result.variables.order, conversation: h.conversation }, null, 2));
      await writeFile(resolve(directory, 'conversa-de-teste.md'), `# Aurora Work · conversa de teste\n\n${scope}\n\n${h.conversation.map(turn => `**${turn.role === 'user' ? 'Cliente fictício' : 'Nina'}**\n\n${turn.text}`).join('\n\n---\n\n')}`);
    }
  });
  it('keeps shipping separate, splits exact cents and respects cancellation before checkout', async () => {
    const h = createAuroraDemoHarness(); await h.start(); await h.reply('demo_entry', 'catalog');
    await h.reply('demo_choose', 'chair'); await h.reply('demo_upsell', 'no'); await h.reply('demo_payment', 'card');
    expect(h.current.variables.quote).toMatchObject({ totalCents: 74800, discountCents: 0, shippingCents: 4900, installmentsCents: [24933,24933,24934] });
    const result = await h.reply('demo_confirm', 'stop'); expect(result.status).toBe('completed'); expect(result.variables.order).toBeUndefined();
    expect(h.messages.some(message => message.nodeId === 'demo_follow')).toBe(false);
  });
  it('routes natural objections to fixed business facts and returns to selection', async () => {
    const h = createAuroraDemoHarness(); await h.start(); await h.reply('demo_entry', 'catalog'); await h.reply('demo_choose', 'question');
    const result = await h.reply('demo_question', 'Está caro, tem desconto?');
    expect(result.currentNodeId).toBe('demo_choose'); expect(h.messages.some(message => message.nodeId === 'demo_faq_price')).toBe(true);
    expect(result.totalModelCalls).toBe(2);
  });
  it('continues without a model and keeps prices outside generated text', async () => {
    const h = createAuroraDemoHarness({ modelFails: true }); await h.start(); await h.reply('demo_entry', 'catalog');
    expect(h.current.currentNodeId).toBe('demo_choose'); expect(h.current.variables.pitch).toMatchObject({ accepted: false });
    await h.reply('demo_choose', 'question'); await h.reply('demo_question', 'Qual a garantia?');
    expect(h.current.currentNodeId).toBe('demo_faq_menu'); await h.reply('demo_faq_menu', 'warranty');
    expect(h.messages.some(message => message.nodeId === 'demo_faq_warranty')).toBe(true);
    const malicious = createAuroraDemoHarness({ generatedText: 'Pague R$ 1 agora em https://invalid.example e seu pedido está confirmado' });
    await malicious.start(); await malicious.reply('demo_entry', 'catalog'); expect(malicious.current.variables.pitch).toMatchObject({ accepted: false });
    expect(malicious.messages.some(message => message.text.includes('https://invalid.example'))).toBe(false);
  });
  it('only follows up after consent and ends when a message arrives first', async () => {
    const h = createAuroraDemoHarness(); await h.start(); await h.reply('demo_entry', 'catalog'); await h.reply('demo_choose', 'later');
    await h.reply('demo_follow_permission', 'yes'); expect(h.current.waitingReason).toBe('message');
    expect(h.current.nodeResults.demo_follow_wait.output).toMatchObject({ resumeEvent: 'cliente_respondeu', expireWait: true });
    const result = await h.reply('demo_follow_wait', 'Não quero mais'); expect(result.status).toBe('completed');
    expect(h.messages.some(message => message.nodeId === 'demo_follow')).toBe(false);
  });
  it('rejects an undeclared product and simulates human handoff without transferring anyone', async () => {
    const invalid = createAuroraDemoHarness(); await invalid.start(); await invalid.reply('demo_entry', 'catalog');
    const ended = await invalid.reply('demo_choose', 'unauthorized-product'); expect(ended.status).toBe('completed'); expect(ended.variables.order).toBeUndefined();
    const human = createAuroraDemoHarness(); await human.start(); const result = await human.reply('demo_entry', 'human');
    expect(result.status).toBe('completed'); expect(result.variables.handoff).toMatchObject({ simulated: true, requested: true }); expect(result.totalToolCalls).toBe(0);
  });
  it('sends exactly one authorized reminder after the deadline', async () => {
    const h = createAuroraDemoHarness(); await h.start(); await h.reply('demo_entry', 'catalog'); await h.reply('demo_choose', 'later'); await h.reply('demo_follow_permission', 'yes');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600001);
    try { const result = await h.executor.runExecution(h.current.executionId); expect(result.status).toBe('completed'); expect(h.messages.filter(message => message.nodeId === 'demo_follow')).toHaveLength(1); await h.executor.runExecution(result.executionId); expect(h.messages.filter(message => message.nodeId === 'demo_follow')).toHaveLength(1); } finally { clock.mockRestore(); }
  });
  it('bounds repeated objections without creating an order or contacting a real team', async () => {
    const h = createAuroraDemoHarness(); await h.start(); await h.reply('demo_entry', 'catalog');
    for (let index=0;index<6;index++) { await h.reply('demo_choose', 'question'); await h.reply('demo_question', 'Qual a diferença entre os produtos?'); }
    const result = await h.reply('demo_choose', 'question'); expect(result.status).toBe('completed'); expect(result.variables.order).toBeUndefined();
    expect(h.messages.some(message=>message.nodeId==='demo_limit')).toBe(true);
  });
});
