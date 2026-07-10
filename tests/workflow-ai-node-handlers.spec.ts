import { describe, expect, it } from 'vitest';
import {
  ModelFallbackChain,
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
