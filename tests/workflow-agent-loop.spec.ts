import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AgentNodeConfigSchema,
  ModelFallbackChain,
  ToolRegistry,
  WorkflowExecutionSchema,
  executeAgentNode,
  type AgentDecision,
  type AgentNodeConfig,
  type GenerateRequest,
  type GenerateResult,
  type ModelAdapter,
  type ModelHealth,
  type ModelInfo,
  type ModelStreamEvent,
  type ModelConfiguration,
  type StructuredGenerateRequest,
} from '@/services/workflow-runtime';
import {
  connect,
  workflowDefinition,
  workflowNode,
} from './workflow-runtime-fixtures';

class SequenceModelAdapter implements ModelAdapter {
  calls = 0;

  constructor(
    private readonly sequence: Array<unknown | Error>,
    private readonly capability = true,
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'fake' }];
  }

  async healthCheck(): Promise<ModelHealth> {
    return { ok: true, latencyMs: 0, models: ['fake'] };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    return { model: request.model, text: '', toolRequests: [] };
  }

  async generateStructured<T>(request: StructuredGenerateRequest<T>): Promise<T> {
    const value = this.sequence[this.calls] ?? this.sequence.at(-1);
    this.calls += 1;
    if (value instanceof Error) throw value;
    return request.schema.parse(value);
  }

  async *stream(request: GenerateRequest): AsyncIterable<ModelStreamEvent> {
    yield { type: 'started', model: request.model };
    yield { type: 'completed', model: request.model };
  }

  async supportsTools(): Promise<boolean> {
    return this.capability;
  }

  async supportsStructuredOutput(): Promise<boolean> {
    return this.capability;
  }
}

const modelConfig: ModelConfiguration = {
  provider: 'fake',
  model: 'fake',
  temperature: 0,
  maxOutputTokens: 1_000,
  supportsTools: true,
  supportsStructuredOutput: true,
  supportsStreaming: false,
  timeoutMs: 1_000,
  maxRetries: 0,
};

function agentFixture(
  decisions: Array<AgentDecision | Error>,
  configOverrides: Partial<AgentNodeConfig> = {},
  tools = new ToolRegistry(() => true),
  secondaryDecisions?: Array<AgentDecision | Error>,
) {
  const trigger = workflowNode('trigger.manual', 'trigger');
  const model = workflowNode('ai.model', 'model', modelConfig);
  const agent = workflowNode('ai.agent', 'agent', {
    name: 'Support',
    role: 'support',
    objective: 'Resolve the request',
    instructions: ['Use tools only when needed.'],
    completionCriteria: ['Return a confirmed answer.'],
    availableContext: ['input'],
    maxTurns: 8,
    maxToolCalls: 20,
    maxRepeatedToolCalls: 2,
    timeoutMs: 10_000,
    modelTimeoutMs: 1_000,
    toolTimeoutMs: 500,
    allowParallelToolCalls: false,
    requireStructuredFinalOutput: false,
    fallbackOnToolError: 'route_to_error',
    onLimitReached: 'error',
    ...configOverrides,
  });
  const end = workflowNode('output.end', 'end');
  const workflow = workflowDefinition(
    [trigger, model, agent, end],
    [
      connect(trigger, 'started', agent, 'main'),
      connect(model, 'model', agent, 'model', 'model'),
      connect(agent, 'completed', end, 'main'),
    ],
  );
  const execution = WorkflowExecutionSchema.parse({
    executionId: 'exec-agent',
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    status: 'running',
    currentNodeId: agent.id,
    previousNodeId: trigger.id,
    pendingNodeIds: [],
    input: { request: 'help' },
    variables: {},
    context: {},
    nodeResults: {},
    executionPath: [],
    startedAt: '2026-07-02T12:00:00.000Z',
    updatedAt: '2026-07-02T12:00:00.000Z',
    totalSteps: 0,
    totalModelCalls: 0,
    totalToolCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    version: 0,
  });
  const primary = new SequenceModelAdapter(decisions);
  const candidates = [{ adapter: primary, config: modelConfig }];
  if (secondaryDecisions) {
    candidates.push({
      adapter: new SequenceModelAdapter(secondaryDecisions),
      config: { ...modelConfig, provider: 'secondary', model: 'secondary' },
    });
  }
  const events: string[] = [];
  return {
    primary,
    events,
    run: (memory?: Record<string, unknown>) => executeAgentNode({
      config: AgentNodeConfigSchema.parse(agent.config),
      execution,
      workflow,
      node: agent,
      modelChain: new ModelFallbackChain(candidates),
      tools,
      memory,
      signal: new AbortController().signal,
      emit: async (event) => {
        events.push(event.type);
      },
    }),
  };
}

function lookupToolRegistry(executor?: () => Promise<Record<string, unknown>>) {
  let calls = 0;
  const registry = new ToolRegistry(() => true);
  registry.register({
    name: 'lookup',
    description: 'Looks up a record.',
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ found: z.boolean(), id: z.string() }),
    timeoutMs: 500,
    retryPolicy: {
      maxAttempts: 1,
      initialDelayMs: 0,
      backoffMultiplier: 2,
      maxDelayMs: 10,
      retryableErrorCodes: [],
    },
    idempotent: true,
    riskLevel: 'low',
    requiresConfirmation: false,
    execute: async ({ id }) => {
      calls += 1;
      return executor
        ? { found: true, id, ...await executor() }
        : { found: true, id };
    },
  });
  return { registry, getCalls: () => calls };
}

describe('controlled agent loop', () => {
  it('routes a request for missing input instead of pausing inside the agent', async () => {
    const fixture = agentFixture([{
      type: 'needs_input',
      question: 'Qual é o número do contrato?',
      missingFields: ['contractId'],
    }]);
    const result = await fixture.run();
    expect(result.status).toBe('route');
    expect(result.selectedOutput).toBe('needs_input');
    expect(result.output?.question).toBe('Qual é o número do contrato?');
    expect(result.resumeToken).toBeUndefined();
  });

  it('repairs a choice question when the options were not presented first', async () => {
    const fixture = agentFixture([
      {
        type: 'needs_input',
        question: 'Qual desses planos mais te interessou?',
        missingFields: ['plano_desejado'],
      },
      {
        type: 'needs_input',
        question: 'Temos os planos Básico, Profissional e Empresarial. Qual desses planos mais te interessou?',
        missingFields: ['plano_desejado'],
      },
    ]);

    const result = await fixture.run({
      recentMessages: [
        { fromMe: false, content: 'Olá' },
        { fromMe: true, content: 'Como posso ajudar?' },
      ],
    });

    expect(result.selectedOutput).toBe('needs_input');
    expect(result.output?.question).toContain('Básico, Profissional e Empresarial');
    expect(fixture.primary.calls).toBe(2);
  });

  it('repairs a final answer that asks for an unpresented scheduling choice', async () => {
    const fixture = agentFixture([
      {
        type: 'final',
        response: 'Qual horário você prefere?',
        completionStatus: 'completed',
      },
      {
        type: 'final',
        response: 'Horários disponíveis: 09:00, 11:00 ou 15:00. Qual horário você prefere?',
        completionStatus: 'completed',
      },
    ]);

    const result = await fixture.run();

    expect(result.status).toBe('completed');
    expect(result.output?.response).toContain('09:00, 11:00 ou 15:00');
    expect(fixture.primary.calls).toBe(2);
  });

  it('allows a follow-up choice when an earlier assistant message presented the options', async () => {
    const fixture = agentFixture([{
      type: 'needs_input',
      question: 'Qual desses imóveis mais te interessou?',
      missingFields: ['imovel_desejado'],
    }]);

    const result = await fixture.run({
      recentMessages: [{
        fromMe: true,
        content: 'Imóveis disponíveis:\n1. Apartamento no Centro\n2. Casa no Bairro Verde',
      }],
    });

    expect(result.selectedOutput).toBe('needs_input');
    expect(fixture.primary.calls).toBe(1);
  });

  it('refuses to ask again for a field already present in structured memory', async () => {
    const fixture = agentFixture([
      {
        type: 'needs_input',
        question: 'Qual é o seu CEP?',
        missingFields: ['CEP'],
      },
      {
        type: 'final',
        response: 'Usei o CEP já confirmado.',
        completionStatus: 'completed',
      },
    ]);

    const result = await fixture.run({
      knownFields: { address: 'CEP 72800-123' },
    });

    expect(result.status).toBe('completed');
    expect(result.output?.response).toBe('Usei o CEP já confirmado.');
    expect(fixture.primary.calls).toBe(2);
  });

  it('removes known fields when only part of a missing-field list is truly absent', async () => {
    const fixture = agentFixture([
      {
        type: 'needs_input',
        question: 'Qual é seu CEP e seu e-mail?',
        missingFields: ['CEP', 'email'],
      },
      {
        type: 'needs_input',
        question: 'Qual é seu e-mail?',
        missingFields: ['email'],
      },
    ]);

    const result = await fixture.run({
      knownFields: { address: 'CEP 72800-123' },
    });

    expect(result.selectedOutput).toBe('needs_input');
    expect(result.output?.missingFields).toEqual(['email']);
    expect(result.output?.question).toBe('Qual é seu e-mail?');
    expect(fixture.primary.calls).toBe(2);
  });

  it('rejects a partial final response that asks again for a known field', async () => {
    const fixture = agentFixture([
      {
        type: 'final',
        response: 'Para continuar, informe novamente seu CEP e seu e-mail.',
        completionStatus: 'partial',
      },
      {
        type: 'needs_input',
        question: 'Qual é seu e-mail?',
        missingFields: ['email'],
      },
    ]);

    const result = await fixture.run({
      knownFields: { address: 'CEP 72800-123' },
    });

    expect(result.selectedOutput).toBe('needs_input');
    expect(result.output?.missingFields).toEqual(['email']);
    expect(fixture.primary.calls).toBe(2);
  });

  it('forces one explicit resolution of an ambiguous terminal partial response', async () => {
    const fixture = agentFixture([
      {
        type: 'final',
        response: 'Obrigada pelas informaÃ§Ãµes. EstÃ¡ tudo certo!',
        completionStatus: 'partial',
      },
      {
        type: 'final',
        response: 'Obrigada pelas informaÃ§Ãµes. EstÃ¡ tudo certo!',
        completionStatus: 'completed',
      },
    ]);

    const result = await fixture.run();

    expect(result.selectedOutput).toBe('completed');
    expect(result.output?.completionStatus).toBe('completed');
    expect(fixture.primary.calls).toBe(2);
  });

  it('completes without tools', async () => {
    const fixture = agentFixture([{
      type: 'final',
      response: 'Resolved.',
      completionStatus: 'completed',
    }]);
    const result = await fixture.run();
    expect(result.status).toBe('completed');
    expect(result.output?.response).toBe('Resolved.');
    expect(result.toolCalls).toEqual([]);
  });

  it('executes one requested tool and returns its result to the model', async () => {
    const { registry, getCalls } = lookupToolRegistry();
    const fixture = agentFixture([
      {
        type: 'tool_call',
        toolName: 'lookup',
        arguments: { id: '123' },
        purposeSummary: 'Confirm the record.',
      },
      {
        type: 'final',
        response: 'Record confirmed.',
        completionStatus: 'completed',
      },
    ], {}, registry);
    const result = await fixture.run();
    expect(result.status).toBe('completed');
    expect(result.toolCalls).toHaveLength(1);
    expect(getCalls()).toBe(1);
    expect(fixture.events).toContain('tool.completed');
  });

  it('executes two tools in sequence', async () => {
    const { registry, getCalls } = lookupToolRegistry();
    const fixture = agentFixture([
      {
        type: 'tool_call',
        toolName: 'lookup',
        arguments: { id: 'one' },
        purposeSummary: 'First lookup.',
      },
      {
        type: 'tool_call',
        toolName: 'lookup',
        arguments: { id: 'two' },
        purposeSummary: 'Second lookup.',
      },
      {
        type: 'final',
        response: 'Both confirmed.',
        completionStatus: 'completed',
      },
    ], {}, registry);
    const result = await fixture.run();
    expect(result.toolCalls).toHaveLength(2);
    expect(getCalls()).toBe(2);
  });

  it('routes invalid tool arguments to error without executing', async () => {
    const { registry, getCalls } = lookupToolRegistry();
    const fixture = agentFixture([{
      type: 'tool_call',
      toolName: 'lookup',
      arguments: {},
      purposeSummary: 'Invalid lookup.',
    }], {}, registry);
    const result = await fixture.run();
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('INVALID_TOOL_ARGUMENTS');
    expect(getCalls()).toBe(0);
  });

  it('stops repeated identical tool calls', async () => {
    const { registry } = lookupToolRegistry();
    const repeated: AgentDecision = {
      type: 'tool_call',
      toolName: 'lookup',
      arguments: { id: 'same' },
      purposeSummary: 'Repeat lookup.',
    };
    const fixture = agentFixture(
      [repeated, repeated, repeated, repeated],
      { maxTurns: 8, maxRepeatedToolCalls: 1, onLimitReached: 'error' },
      registry,
    );
    const result = await fixture.run();
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('REPEATED_TOOL_CALL_LIMIT');
  });

  it('enforces the maximum agent turns', async () => {
    const { registry } = lookupToolRegistry();
    const fixture = agentFixture([
      {
        type: 'tool_call',
        toolName: 'lookup',
        arguments: { id: 'one' },
        purposeSummary: 'First.',
      },
      {
        type: 'tool_call',
        toolName: 'lookup',
        arguments: { id: 'two' },
        purposeSummary: 'Second.',
      },
    ], { maxTurns: 2, onLimitReached: 'error' }, registry);
    const result = await fixture.run();
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('MAX_AGENT_TURNS_REACHED');
  });

  it('separates the visible customer message from the internal summary on automatic handoff', async () => {
    const repeatedInvalidFinal: AgentDecision = {
      type: 'final',
      response: 'Recebi os dados do cliente e preciso encaminhar para a equipe.',
      completionStatus: 'completed',
    };
    const fixture = agentFixture(
      [repeatedInvalidFinal, repeatedInvalidFinal, repeatedInvalidFinal, repeatedInvalidFinal],
      {
        maxTurns: 8,
        onLimitReached: 'handoff',
        requireStructuredFinalOutput: true,
        finalOutputSchema: {
          type: 'object',
          required: ['confirmed'],
          properties: { confirmed: { type: 'boolean' } },
        },
      },
    );

    const result = await fixture.run();

    expect(result.selectedOutput).toBe('handoff');
    expect(result.output?.customerMessage).toContain('Obrigado pelas informações');
    expect(result.output?.summary).toContain('Transferência automática por REPEATED_DECISION_SIGNATURE');
    expect(result.output?.summary).toContain('Contexto para continuidade');
  });

  it('falls back after retryable invalid structured output', async () => {
    const failure = Object.assign(new Error('invalid JSON'), {
      code: 'INVALID_STRUCTURED_OUTPUT',
      retryable: true,
    });
    const fixture = agentFixture(
      [failure],
      {},
      new ToolRegistry(() => true),
      [{
        type: 'final',
        response: 'Fallback completed.',
        completionStatus: 'completed',
      }],
    );
    const result = await fixture.run();
    expect(result.status).toBe('completed');
    expect(result.metrics?.model).toBe('secondary');
  });

  it('does not silently fallback on a behavioral capability error', async () => {
    const failure = Object.assign(new Error('unsupported'), {
      code: 'MODEL_CAPABILITY_MISMATCH',
      retryable: false,
    });
    const fixture = agentFixture(
      [failure],
      {},
      new ToolRegistry(() => true),
      [{
        type: 'final',
        response: 'Should not run.',
        completionStatus: 'completed',
      }],
    );
    await expect(fixture.run()).rejects.toThrow('unsupported');
  });

  it('rejects a final response that misses the configured structured schema', async () => {
    const fixture = agentFixture([
      {
        type: 'final',
        response: 'Missing object.',
        completionStatus: 'completed',
      },
      {
        type: 'final',
        response: 'Still missing.',
        completionStatus: 'partial',
      },
    ], {
      maxTurns: 2,
      requireStructuredFinalOutput: true,
      finalOutputSchema: {
        type: 'object',
        properties: { code: { type: 'string' } },
        required: ['code'],
      },
      onLimitReached: 'error',
    });
    const result = await fixture.run();
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('MAX_AGENT_TURNS_REACHED');
  });
});
