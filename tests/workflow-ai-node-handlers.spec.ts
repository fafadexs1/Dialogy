import { describe, expect, it } from 'vitest';
import {
  ModelFallbackChain,
  ToolRegistry,
  WorkflowExecutionSchema,
  createDefaultNodeHandlerRegistry,
  type GenerateRequest,
  type GenerateResult,
  type ModelAdapter,
  type ModelConfiguration,
  type ModelHealth,
  type ModelInfo,
  type ModelStreamEvent,
  type StructuredGenerateRequest,
} from '@/services/workflow-runtime';
import { workflowDefinition, workflowNode } from './workflow-runtime-fixtures';

class StructuredAdapter implements ModelAdapter {
  constructor(private readonly output: unknown) {}
  async listModels(): Promise<ModelInfo[]> { return [{ id: 'fake' }]; }
  async healthCheck(): Promise<ModelHealth> { return { ok: true, latencyMs: 0 }; }
  async generate(request: GenerateRequest): Promise<GenerateResult> { return { model: request.model, text: '', toolRequests: [] }; }
  async generateStructured<T>(request: StructuredGenerateRequest<T>): Promise<T> { return request.schema.parse(this.output); }
  async *stream(): AsyncIterable<ModelStreamEvent> { yield { type: 'completed', model: 'fake' }; }
  async supportsTools(): Promise<boolean> { return true; }
  async supportsStructuredOutput(): Promise<boolean> { return true; }
}

const config: ModelConfiguration = {
  provider: 'fake', model: 'fake', temperature: 0, maxOutputTokens: 1000,
  supportsTools: true, supportsStructuredOutput: true, supportsStreaming: false,
  timeoutMs: 1000, maxRetries: 0,
};

function context(nodeType: 'logic.ai_router' | 'data.extract', nodeConfig: Record<string, unknown>, modelOutput: unknown) {
  const model = workflowNode('ai.model', 'model', config);
  const node = workflowNode(nodeType, 'subject', nodeConfig);
  if (nodeType === 'logic.ai_router') {
    node.outputPorts.unshift({ id: 'support', label: 'Support', direction: 'output', connectionType: 'main', required: true, multiple: false });
  }
  const workflow = workflowDefinition([model, node], [], { status: 'draft' });
  const execution = WorkflowExecutionSchema.parse({
    executionId: 'exec', workflowId: workflow.id, workflowVersion: workflow.version,
    status: 'running', currentNodeId: node.id, previousNodeId: null, pendingNodeIds: [],
    input: { message: 'preciso de suporte' }, variables: {}, context: {}, nodeResults: {}, executionPath: [],
    startedAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
    totalSteps: 0, totalModelCalls: 0, totalToolCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, version: 0,
  });
  const handlers = createDefaultNodeHandlerRegistry({
    resolveModelChain: async () => new ModelFallbackChain([{ adapter: new StructuredAdapter(modelOutput), config }]),
  });
  return {
    handler: handlers.get(nodeType)!,
    input: {
      execution, workflow, node, input: execution.input, attachments: { model: [model] },
      signal: new AbortController().signal, emit: async () => undefined,
    },
  };
}

describe('workflow AI node handlers', () => {
  it('delegates an AI block to the selected linked system agent before the native AI runtime', async () => {
    const agent = workflowNode('ai.agent', 'agent', {
      name: 'Comercial', role: 'assinatura', persona: '', language: 'pt-BR',
      objective: 'Resolver', instructions: [], completionCriteria: ['Resolver'], availableContext: [],
      maxTurns: 8, maxToolCalls: 20, maxRepeatedToolCalls: 2, timeoutMs: 10_000,
      modelTimeoutMs: 5_000, toolTimeoutMs: 5_000, allowParallelToolCalls: false,
      requireStructuredFinalOutput: false, fallbackOnToolError: 'route_to_error', onLimitReached: 'handoff',
      useSelectedSystemAgent: true,
    });
    const workflow = workflowDefinition([agent], [], { status: 'published' });
    const execution = WorkflowExecutionSchema.parse({
      executionId: 'linked-agent-exec', workflowId: workflow.id, workflowVersion: workflow.version,
      status: 'running', currentNodeId: agent.id, previousNodeId: null, pendingNodeIds: [],
      input: { message: 'Quero contratar' }, variables: {}, context: {}, nodeResults: {}, executionPath: [],
      startedAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
      totalSteps: 0, totalModelCalls: 0, totalToolCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, version: 0,
    });
    const handlers = createDefaultNodeHandlerRegistry({
      executeLinkedAgent: async () => ({
        handled: true,
        success: true,
        delegated: true,
        systemAgentId: 'system-agent-1',
      }),
    });

    const result = await handlers.get('ai.agent')!.execute({
      execution, workflow, node: agent, input: execution.input, attachments: {},
      signal: new AbortController().signal, emit: async () => undefined,
    });

    expect(result).toMatchObject({
      status: 'completed',
      selectedOutput: 'handoff',
      output: { handled: true, delegated: true, systemAgentId: 'system-agent-1' },
    });
  });

  it('preserves imported agent input, response variable and automatic delivery', async () => {
    const model = workflowNode('ai.model', 'model', config);
    const agent = workflowNode('ai.agent', 'agent', {
      name: 'Comercial', role: 'assinatura', persona: 'Ajude o cliente.', language: 'pt-BR',
      objective: 'Resolver', instructions: [], completionCriteria: ['Resolver'], availableContext: ['variables'],
      maxTurns: 8, maxToolCalls: 20, maxRepeatedToolCalls: 2, timeoutMs: 10_000,
      modelTimeoutMs: 5_000, toolTimeoutMs: 5_000, allowParallelToolCalls: false,
      requireStructuredFinalOutput: false, fallbackOnToolError: 'route_to_error', onLimitReached: 'handoff',
      inputPath: '$.variables.mensagem_cliente', inputVariable: 'mensagem_cliente', outputKey: 'resposta_agente',
      autoSendResponse: true, conversationMode: true, maxConversationTurns: 6,
    });
    const workflow = workflowDefinition([model, agent], [], { status: 'draft' });
    const execution = WorkflowExecutionSchema.parse({
      executionId: 'agent-exec', workflowId: workflow.id, workflowVersion: workflow.version,
      status: 'running', currentNodeId: agent.id, previousNodeId: null, pendingNodeIds: [],
      input: { ignored: true }, variables: { mensagem_cliente: 'Quero contratar' }, context: {}, nodeResults: {}, executionPath: [],
      startedAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
      totalSteps: 0, totalModelCalls: 0, totalToolCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, version: 0,
    });
    const delivered: string[] = [];
    const handlers = createDefaultNodeHandlerRegistry({
      resolveModelChain: async () => new ModelFallbackChain([{
        adapter: new StructuredAdapter({ type: 'final', response: 'Claro, vamos contratar.', completionStatus: 'completed' }),
        config,
      }]),
      resolveToolRegistry: async () => new ToolRegistry(),
      sendResponse: async (message) => { delivered.push(message); return { success: true }; },
    });
    const result = await handlers.get('ai.agent')!.execute({
      execution, workflow, node: agent, input: execution.input, attachments: { model: [model] },
      signal: new AbortController().signal, emit: async () => undefined,
    });
    expect(result.selectedOutput).toBe('completed');
    expect(result.statePatch).toMatchObject({
      resposta_agente: 'Claro, vamos contratar.',
      __agentConversationTurns: { agent: 1 },
    });
    expect(delivered).toEqual(['Claro, vamos contratar.']);
  });

  it('routes low-confidence AI decisions to the explicit fallback', async () => {
    const fixture = context('logic.ai_router', {
      routes: [{ id: 'support', label: 'Support', description: 'Support requests' }],
      minimumConfidence: 0.8,
      lowConfidenceOutput: 'low_confidence',
      defaultOutput: 'default',
    }, { routeId: 'support', confidence: 0.4 });
    const result = await fixture.handler.execute(fixture.input);
    expect(result.selectedOutput).toBe('low_confidence');
    expect(result.output?.proposedRouteId).toBe('support');
  });

  it('extracts and validates structured data against JSON schema', async () => {
    const fixture = context('data.extract', {
      schema: {
        type: 'object',
        properties: { contractId: { type: 'string' } },
        required: ['contractId'],
      },
      maxAttempts: 2,
      outputKey: 'extracted',
    }, { contractId: '123' });
    const result = await fixture.handler.execute(fixture.input);
    expect(result.selectedOutput).toBe('success');
    expect(result.statePatch).toEqual({ extracted: { contractId: '123' } });
  });
});
