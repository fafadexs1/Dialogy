import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db } from '@/lib/db';
import { createPublishedStudioSandboxExecutor } from '@/services/agent-studio/workflow-sandbox';
import { WorkflowExecutor } from '@/services/workflow-runtime/executor';
import { InMemoryWorkflowPersistence } from '@/services/workflow-runtime/persistence';
import { createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime/node-handlers';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import { openStudioSession } from '@/services/agent-studio/session-store';

vi.mock('server-only', () => ({}));
const enabled = process.env.RUN_AURORA_CONVERSATION_LIVE === '1';
afterAll(async () => { if (enabled) await db.end(); });
describe('Aurora conversation with the real provider and intercepted business effects', () => {
  it.skipIf(!enabled)('answers free text, calculates from published quotes and rejects unauthorized discounts', async () => {
    const directory = resolve('artifacts/workflows/aurora-work');
    const workflow = WorkflowDefinitionSchema.parse(JSON.parse(await readFile(resolve(directory, 'workflow-conversational.json'), 'utf8')));
    expect(workflow.workspaceId).toBe('5c3a91e9-b243-4436-80ba-42434bc5ca97');
    expect(workflow.status).toBe('draft'); expect(workflow.nodes).toHaveLength(2);
    const actorUserId = '8fe1f4da-9305-475c-95d1-83bda9f29b22';
    const conversation: Array<{ role: string; text: string }> = [];
    const executor = new WorkflowExecutor(new InMemoryWorkflowPersistence(), createDefaultNodeHandlerRegistry({
      executePublishedAgent: createPublishedStudioSandboxExecutor({ workspaceId: workflow.workspaceId!, actorUserId,
        sendResponse: async text => { conversation.push({ role: 'assistant', text }); return { success: true, sandbox: true }; },
      }),
    }));
    const firstMessage = 'Oi! Já tenho mesa e quero só a cadeira, sem apoio para os pés. Tenho até dois mil reais. Quanto fica no PIX e no cartão, contando frete? Só estou comparando, não quero confirmar nada.';
    conversation.push({ role: 'user', text: firstMessage });
    const first = await executor.start({ workflow, input: { message: firstMessage, text: firstMessage }, context: { sandbox: true, userId: actorUserId } });
    expect(first.status, JSON.stringify(first.failure)).toBe('waiting');
    const reply = conversation.at(-1)!.text;
    expect(reply).toMatch(/713[,.]05/); expect(reply).toMatch(/748/);
    const objection = 'Ainda está caro. Pode fazer por seiscentos no PIX e tirar o frete? Continuo sem autorizar qualquer compra.';
    conversation.push({ role: 'user', text: objection });
    const second = await executor.resume({ resumeToken: first.resumeToken!, input: { text: objection, message: objection, value: objection } });
    expect(second.status, JSON.stringify(second.failure)).toBe('waiting');
    const node = workflow.nodes.find(node => node.type === 'ai.published_agent')!;
    const sessions = second.variables.__studioSandboxSessions as Record<string, string>;
    const state = openStudioSession({ workspaceId: workflow.workspaceId!, agentId: String(node.config.agentId), chatId: `nexus-preview:${second.executionId}`, contextId: node.id }, sessions[node.id]);
    expect(state.values.aurora_simulacao_confirmada).not.toBe(true);
    expect(state.conversationMemory?.some(turn => turn.customer === firstMessage)).toBe(true);
    const evidence = { provider: 'DeepSeek real', execution: 'Nexus executor and real published Studio agent, persistence in memory', businessEffects: 'Intercepted: no customer, CRM, charge, transfer or delivery', workflowId: workflow.id, agentId: node.config.agentId, releaseId: node.config.releaseId, status: second.status, modelCalls: second.totalModelCalls, conversation };
    await writeFile(resolve(directory, 'conversa-ia-real.json'), JSON.stringify(evidence, null, 2));
    await writeFile(resolve(directory, 'conversa-ia-real.md'), `# Nina · conversa com DeepSeek real\n\nMotor do Nexus + publicação do Studio. Ações de negócio interceptadas; persistência do teste em memória.\n\n${conversation.map(turn => `**${turn.role === 'user' ? 'Cliente fictício' : 'Nina'}**\n\n${turn.text}`).join('\n\n---\n\n')}`);
  }, 240000);
});
