import { describe, expect, it } from 'vitest';
import {
  createNativeWorkflowTemplate,
  validateWorkflowDefinition,
  type ModelConfiguration,
} from '@/services/workflow-runtime';

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

function template(kind: 'single_agent' | 'routed_team' | 'blank') {
  return createNativeWorkflowTemplate({
    configId: 'config-1',
    workspaceId: 'workspace-1',
    name: 'Automação de IA',
    model,
    persona: 'Fale de forma acolhedora.',
    template: kind,
  });
}

describe('native workflow templates', () => {
  it('creates a valid single-agent automation with attached capabilities', () => {
    const workflow = template('single_agent');
    expect(validateWorkflowDefinition(workflow)).toEqual({ valid: true, errors: [], warnings: [] });
    const agent = workflow.nodes.find((node) => node.type === 'ai.agent');
    expect(agent?.config.persona).toBe('Fale de forma acolhedora.');
    expect(workflow.connections.some((connection) => connection.connectionType === 'model')).toBe(true);
    expect(workflow.connections.some((connection) => connection.connectionType === 'memory')).toBe(true);
    expect(workflow.connections.some((connection) => connection.connectionType === 'guardrail')).toBe(true);
    expect(workflow.connections.some((connection) => connection.connectionType === 'knowledge')).toBe(true);
  });

  it('creates a valid routed multi-agent automation', () => {
    const workflow = template('routed_team');
    expect(validateWorkflowDefinition(workflow)).toEqual({ valid: true, errors: [], warnings: [] });
    expect(workflow.nodes.filter((node) => node.type === 'ai.agent')).toHaveLength(2);
    expect(workflow.nodes.some((node) => node.type === 'logic.ai_router')).toBe(true);
  });

  it('keeps the blank template intentionally unpublishable', () => {
    const validation = validateWorkflowDefinition(template('blank'));
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((issue) => issue.code)).toContain('missing_terminal');
  });
});
