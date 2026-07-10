import { describe, expect, it } from 'vitest';
import {
  previewAutopilotNativeMigration,
  type ModelConfiguration,
} from '@/services/workflow-runtime';
import type { AutopilotFlowGraph } from '@/lib/types';

const graph: AutopilotFlowGraph = {
  version: 1,
  nodes: [
    { id: 'start', kind: 'start', title: 'Início', subtitle: '', position: { x: 0, y: 0 }, config: {} },
    {
      id: 'agent',
      kind: 'sub_agent',
      title: 'Atendimento',
      subtitle: 'Principal',
      position: { x: 300, y: 0 },
      config: { instructions: 'Resolva a solicitação.', message: 'Responda com segurança.' },
    },
    { id: 'end', kind: 'end', title: 'Fim', subtitle: '', position: { x: 600, y: 0 }, config: {} },
  ],
  edges: [
    { id: 'start-agent', source: 'start', target: 'agent' },
    { id: 'agent-end', source: 'agent', target: 'end' },
  ],
};

const model: ModelConfiguration = {
  provider: 'fake',
  model: 'fake',
  temperature: 0.2,
  maxOutputTokens: 2_048,
  supportsTools: true,
  supportsStructuredOutput: true,
  supportsStreaming: true,
  timeoutMs: 60_000,
  maxRetries: 2,
};

describe('autopilot native migration', () => {
  it('preserves persona and produces explicit agent outcomes', () => {
    const result = previewAutopilotNativeMigration({
      configId: 'config',
      workspaceId: 'workspace',
      name: 'Automação',
      graph,
      model,
      persona: 'Persona original sem alterações.',
    });
    const agent = result.workflow.nodes.find((node) => node.type === 'ai.agent');
    expect(agent?.config.persona).toBe('Persona original sem alterações.');
    expect(result.workflow.connections.some((item) => item.sourceNodeId === agent?.id && item.sourcePortId === 'needs_input')).toBe(true);
    expect(result.workflow.connections.some((item) => item.sourceNodeId === agent?.id && item.sourcePortId === 'handoff')).toBe(true);
    expect(result.validation.valid).toBe(true);
  });

  it('reuses an existing migration when the source hash is unchanged', () => {
    const first = previewAutopilotNativeMigration({
      configId: 'config', workspaceId: 'workspace', name: 'Automação', graph, model, persona: 'Persona',
    });
    const second = previewAutopilotNativeMigration({
      configId: 'config',
      workspaceId: 'workspace',
      name: 'Automação',
      graph,
      model,
      persona: 'Persona',
      existingDefinition: first.workflow,
      existingSourceHash: first.sourceHash,
    });
    expect(second.reused).toBe(true);
    expect(second.workflow).toEqual(first.workflow);
  });
});
