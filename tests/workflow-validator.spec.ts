import { describe, expect, it } from 'vitest';
import {
  createNativeWorkflowTemplate,
  validateWorkflowDefinition,
  type ModelConfiguration,
  type WorkflowNode,
} from '@/services/workflow-runtime';
import {
  connect,
  linearWorkflow,
  workflowDefinition,
  workflowNode,
} from './workflow-runtime-fixtures';

function issueCodes(result: ReturnType<typeof validateWorkflowDefinition>) {
  return result.errors.map((issue) => issue.code);
}

describe('workflow static validator', () => {
  it('accepts a connected linear workflow', () => {
    expect(validateWorkflowDefinition(linearWorkflow())).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('rejects model attachments without an active workspace credential when a catalog is supplied', () => {
    const model: ModelConfiguration = {
      provider: 'deepseek',
      model: 'deepseek/deepseek-v4-flash',
      temperature: 0.2,
      maxOutputTokens: 2048,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      timeoutMs: 60_000,
      maxRetries: 2,
    };
    const workflow = createNativeWorkflowTemplate({
      configId: 'credential-validation',
      workspaceId: 'workspace',
      name: 'Credential validation',
      model,
      persona: '',
      template: 'single_agent',
    });

    expect(issueCodes(validateWorkflowDefinition(workflow, {
      availableModelIds: ['openai/gpt-workspace'],
    }))).toContain('model_not_configured');
    expect(issueCodes(validateWorkflowDefinition(workflow, {
      availableModelIds: [model.model],
    }))).not.toContain('model_not_configured');
  });

  it('rejects incompatible connection types', () => {
    const workflow = linearWorkflow();
    workflow.connections[0]!.connectionType = 'tool';
    expect(issueCodes(validateWorkflowDefinition(workflow))).toContain('incompatible_connection');
  });

  it('rejects more than one connection from a single-cardinality output', () => {
    const workflow = linearWorkflow();
    const secondEnd = workflowNode('output.end', 'second-end');
    workflow.nodes.push(secondEnd);
    workflow.connections.push(connect(workflow.nodes[0]!, 'started', secondEnd, 'main', 'main', 'duplicate-output'));
    expect(issueCodes(validateWorkflowDefinition(workflow))).toContain('output_cardinality_exceeded');
  });

  it('rejects an agent without a model', () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const agent = workflowNode('ai.agent', 'agent', {
      objective: 'Resolver',
      completionCriteria: ['Resolver'],
    });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, agent, end],
      [
        connect(trigger, 'started', agent, 'main'),
        connect(agent, 'completed', end, 'main'),
      ],
    );
    expect(issueCodes(validateWorkflowDefinition(workflow))).toContain('agent_missing_model');
  });

  it('rejects tools without schemas and descriptions', () => {
    const workflow = linearWorkflow();
    const tool = workflowNode('tool.internal', 'tool', {
      name: '',
      description: '',
      inputSchema: null,
      outputSchema: null,
    });
    workflow.nodes.push(tool);
    expect(issueCodes(validateWorkflowDefinition(workflow))).toContain('tool_missing_schema');
  });

  it('rejects a switch without fallback', () => {
    const workflow = linearWorkflow();
    const switchNode = workflowNode('logic.switch', 'switch', {
      value: '{{input.route}}',
      cases: [],
      defaultOutput: 'missing',
    });
    workflow.nodes.splice(1, 0, switchNode);
    workflow.connections = [
      connect(workflow.nodes[0]!, 'started', switchNode, 'main'),
      connect(switchNode, 'default', workflow.nodes.at(-1)!, 'main'),
    ];
    expect(issueCodes(validateWorkflowDefinition(workflow))).toContain('switch_missing_fallback');
  });

  it('rejects a loop without bounds and exit condition', () => {
    const workflow = linearWorkflow();
    const loop = workflowNode('logic.loop', 'loop', {
      maxIterations: 0,
      totalTimeoutMs: 0,
      exitCondition: '',
    });
    workflow.nodes.splice(1, 0, loop);
    workflow.connections = [
      connect(workflow.nodes[0]!, 'started', loop, 'main'),
      connect(loop, 'done', workflow.nodes.at(-1)!, 'main'),
      connect(loop, 'limit_reached', workflow.nodes.at(-1)!, 'main', 'main', 'loop_limit_end'),
      connect(loop, 'iterate', loop, 'main'),
    ];
    const codes = issueCodes(validateWorkflowDefinition(workflow));
    expect(codes).toContain('loop_missing_limit');
    expect(codes).toContain('loop_missing_exit_condition');
  });

  it('rejects undeclared cycles', () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const first = workflowNode('data.set', 'first');
    const second = workflowNode('data.set', 'second');
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, first, second, end],
      [
        connect(trigger, 'started', first, 'main'),
        connect(first, 'success', second, 'main'),
        connect(second, 'success', first, 'main', 'main', 'cycle'),
        connect(second, 'success', end, 'main', 'main', 'finish'),
      ],
    );
    expect(issueCodes(validateWorkflowDefinition(workflow))).toContain('undeclared_cycle');
  });

  it('rejects unknown variables', () => {
    const workflow = linearWorkflow();
    const template = workflowNode('data.template', 'template', {
      template: 'Olá {{customer.unknown}}',
      outputKey: 'message',
    });
    workflow.nodes.splice(1, 0, template);
    workflow.connections = [
      connect(workflow.nodes[0]!, 'started', template, 'main'),
      connect(template, 'success', workflow.nodes.at(-1)!, 'main'),
    ];
    expect(issueCodes(validateWorkflowDefinition(workflow))).toContain('unknown_variable');
  });

  it('rejects inline secrets', () => {
    const workflow = linearWorkflow();
    const node = workflowNode('data.set', 'secret', {
      assignments: {},
      apiKey: 'plain-text-key',
    });
    workflow.nodes.splice(1, 0, node);
    workflow.connections = [
      connect(workflow.nodes[0]!, 'started', node, 'main'),
      connect(node, 'success', workflow.nodes.at(-1)!, 'main'),
    ];
    expect(issueCodes(validateWorkflowDefinition(workflow))).toContain('inline_secret');
  });

  it('rejects sensitive actions without permission or confirmation', () => {
    const workflow = linearWorkflow();
    const handoff = workflowNode('output.handoff', 'handoff', {
      requireConfirmation: false,
      permissionScope: '',
    });
    workflow.nodes.splice(1, 0, handoff);
    workflow.connections = [
      connect(workflow.nodes[0]!, 'started', handoff, 'main'),
      connect(handoff, 'completed', workflow.nodes.at(-1)!, 'main'),
    ];
    expect(issueCodes(validateWorkflowDefinition(workflow))).toContain('sensitive_action_missing_permission');
  });

  it('rejects paths that do not reach a terminal node', () => {
    const workflow = linearWorkflow();
    workflow.connections = [];
    expect(issueCodes(validateWorkflowDefinition(workflow))).toContain('path_without_terminal');
  });

  it('rejects an AI router without low-confidence route', () => {
    const workflow = linearWorkflow();
    const router = workflowNode('logic.ai_router', 'router', {
      routes: [{ id: 'known' }],
      lowConfidenceOutput: 'missing',
      defaultOutput: 'default',
    });
    workflow.nodes.splice(1, 0, router);
    workflow.connections = [
      connect(workflow.nodes[0]!, 'started', router, 'main'),
      connect(router, 'default', workflow.nodes.at(-1)!, 'main'),
    ];
    expect(issueCodes(validateWorkflowDefinition(workflow))).toContain('ai_router_missing_low_confidence');
  });

  it('rejects non-existent subflows when a registry is supplied', () => {
    const workflow = linearWorkflow();
    const subflow = workflowNode('logic.subflow', 'subflow', {
      workflowId: 'missing',
      inputSchema: {},
      outputSchema: {},
    });
    workflow.nodes.splice(1, 0, subflow);
    workflow.connections = [
      connect(workflow.nodes[0]!, 'started', subflow, 'main'),
      connect(subflow, 'success', workflow.nodes.at(-1)!, 'main'),
    ];
    expect(issueCodes(validateWorkflowDefinition(workflow, {
      knownWorkflowIds: ['available'],
    }))).toContain('subflow_not_found');
  });

  it('allows custom nodes but warns about them', () => {
    const workflow = linearWorkflow();
    const custom: WorkflowNode = {
      id: 'custom',
      type: 'custom.safe',
      name: 'Custom',
      position: { x: 0, y: 0 },
      config: {},
      inputPorts: [{
        id: 'main',
        label: 'Input',
        direction: 'input',
        connectionType: 'main',
        required: true,
        multiple: false,
      }],
      outputPorts: [{
        id: 'success',
        label: 'Output',
        direction: 'output',
        connectionType: 'main',
        required: true,
        multiple: false,
      }],
    };
    workflow.nodes.splice(1, 0, custom);
    workflow.connections = [
      connect(workflow.nodes[0]!, 'started', custom, 'main'),
      connect(custom, 'success', workflow.nodes.at(-1)!, 'main'),
    ];
    expect(validateWorkflowDefinition(workflow).warnings.map((issue) => issue.code)).toContain('unknown_node_type');
  });
});
