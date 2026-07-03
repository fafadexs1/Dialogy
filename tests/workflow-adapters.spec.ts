import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LmStudioModelAdapter,
  compileAutopilotFlowToWorkflow,
  validateWorkflowDefinition,
  type ModelCapabilityProfile,
} from '@/services/workflow-runtime';
import type { AutopilotFlowGraph } from '@/lib/types';

const capability: ModelCapabilityProfile = {
  model: 'local-model',
  toolCalling: 'supported',
  structuredOutput: true,
  streaming: true,
  recommendedMaxTools: 8,
  recommendedContextSize: 16_384,
  lastEvaluatedAt: '2026-07-02T12:00:00.000Z',
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('LM Studio model adapter', () => {
  it('lists models and reports capability profiles', async () => {
    const adapter = new LmStudioModelAdapter({
      baseUrl: 'http://localhost:1234',
      capabilities: [capability],
      fetch: async () => jsonResponse({
        data: [{ id: 'local-model', owned_by: 'local', loaded: true }],
      }),
    });
    const models = await adapter.listModels();
    expect(models[0]).toMatchObject({
      id: 'local-model',
      loaded: true,
      capabilities: capability,
    });
    expect((await adapter.healthCheck()).ok).toBe(true);
  });

  it('parses native tool requests without executing them', async () => {
    const adapter = new LmStudioModelAdapter({
      baseUrl: 'http://localhost:1234/v1',
      capabilities: [capability],
      fetch: async () => jsonResponse({
        model: 'local-model',
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [{
              id: 'call-1',
              function: {
                name: 'lookup',
                arguments: '{"id":"123"}',
              },
            }],
          },
        }],
      }),
    });
    const result = await adapter.generate({
      model: 'local-model',
      messages: [{ role: 'user', content: 'Lookup 123' }],
    });
    expect(result.toolRequests).toEqual([{
      id: 'call-1',
      name: 'lookup',
      arguments: { id: '123' },
    }]);
  });

  it('validates structured output from chat completions', async () => {
    const adapter = new LmStudioModelAdapter({
      baseUrl: 'http://localhost:1234',
      capabilities: [capability],
      fetch: async () => jsonResponse({
        model: 'local-model',
        choices: [{
          finish_reason: 'stop',
          message: { content: '{"route":"support","confidence":0.91}' },
        }],
      }),
    });
    const output = await adapter.generateStructured({
      model: 'local-model',
      messages: [{ role: 'user', content: 'Route this message' }],
      schemaName: 'route',
      schema: z.object({
        route: z.string(),
        confidence: z.number(),
      }),
    });
    expect(output).toEqual({ route: 'support', confidence: 0.91 });
  });

  it('rejects invalid structured JSON as a retryable technical error', async () => {
    const adapter = new LmStudioModelAdapter({
      baseUrl: 'http://localhost:1234',
      capabilities: [capability],
      fetch: async () => jsonResponse({
        choices: [{ message: { content: 'not-json' } }],
      }),
    });
    await expect(adapter.generateStructured({
      model: 'local-model',
      messages: [{ role: 'user', content: 'Return JSON' }],
      schemaName: 'object',
      schema: z.object({ ok: z.boolean() }),
    })).rejects.toMatchObject({
      code: 'INVALID_STRUCTURED_OUTPUT',
      retryable: true,
    });
  });

  it('does not enable structured output without a tested capability profile', async () => {
    const adapter = new LmStudioModelAdapter({
      baseUrl: 'http://localhost:1234',
      fetch: async () => jsonResponse({}),
    });
    expect(await adapter.supportsStructuredOutput('unknown')).toBe(false);
    expect(await adapter.supportsTools('unknown')).toBe(false);
  });
});

describe('Autopilot compatibility compiler', () => {
  it('turns linear tool nodes into typed agent attachments', () => {
    const graph: AutopilotFlowGraph = {
      version: 1,
      variables: [],
      nodes: [
        {
          id: 'start',
          kind: 'start',
          title: 'Start',
          subtitle: 'Message received',
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: 'agent',
          kind: 'sub_agent',
          title: 'Support',
          subtitle: 'Diagnose',
          position: { x: 0, y: 200 },
          config: { instructions: 'Resolve the request.' },
        },
        {
          id: 'tool',
          kind: 'tool',
          title: 'Lookup',
          subtitle: 'Look up the customer.',
          position: { x: 240, y: 200 },
          toolName: 'lookup_customer',
          config: {
            inputSchema: {
              type: 'object',
              properties: { id: { type: 'string' } },
              required: ['id'],
            },
            outputSchema: {
              type: 'object',
              properties: { found: { type: 'boolean' } },
              required: ['found'],
            },
          },
        },
        {
          id: 'end',
          kind: 'end',
          title: 'End',
          subtitle: 'Done',
          position: { x: 0, y: 400 },
          config: {},
        },
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent' },
        { id: 'agent-tool', source: 'agent', target: 'tool' },
        { id: 'tool-end', source: 'tool', target: 'end' },
      ],
    };
    const workflow = compileAutopilotFlowToWorkflow({
      configId: 'agent-config',
      workspaceId: 'workspace',
      name: 'Support',
      graph,
      version: '1',
      model: {
        provider: 'lmstudio',
        model: 'local-model',
        temperature: 0.2,
        maxOutputTokens: 2_048,
        supportsTools: true,
        supportsStructuredOutput: true,
        supportsStreaming: true,
        timeoutMs: 60_000,
        maxRetries: 2,
      },
    });
    const toolConnection = workflow.connections.find((connection) => connection.connectionType === 'tool');
    expect(toolConnection).toMatchObject({
      sourceNodeId: 'tool',
      targetNodeId: 'agent',
    });
    expect(workflow.connections.some((connection) => (
      connection.sourceNodeId === 'agent'
      && connection.targetNodeId === 'end'
      && connection.connectionType === 'main'
    ))).toBe(true);
    const validation = validateWorkflowDefinition(workflow);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
  });
});
