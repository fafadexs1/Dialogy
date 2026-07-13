import { describe, expect, it } from 'vitest';
import {
  InMemoryWorkflowPersistence,
  WorkflowExecutor,
  createDefaultNodeHandlerRegistry,
  type NodeRuntimeInput,
  type WorkflowExecution,
  type WorkflowNode,
} from '@/services/workflow-runtime';
import {
  evaluateWorkflowGoalCompletion,
  isValidWorkflowGoalCompletionEvidence,
} from '@/services/workflow-runtime/goal-completion';
import { connect, workflowDefinition, workflowNode } from './workflow-runtime-fixtures';

function goalWorkflow(requiredFields: string[]) {
  const trigger = workflowNode('trigger.manual', 'trigger');
  const goal = workflowNode('logic.goal_completion', 'goal', {
    requiredFields,
    requiredOperations: [],
    requireCompletionSignal: true,
    allowFieldlessCompletion: false,
  });
  const completed = workflowNode('output.end', 'completed');
  const incomplete = workflowNode('output.end', 'incomplete');
  return {
    goal,
    terminal: completed,
    workflow: workflowDefinition(
      [trigger, goal, completed, incomplete],
      [
        connect(trigger, 'started', goal, 'main'),
        connect(goal, 'completed', completed, 'main'),
        connect(goal, 'incomplete', incomplete, 'main'),
      ],
    ),
  };
}

async function execute(requiredFields: string[], input: Record<string, unknown>) {
  const definition = goalWorkflow(requiredFields);
  const executor = new WorkflowExecutor(
    new InMemoryWorkflowPersistence(),
    createDefaultNodeHandlerRegistry(),
  );
  const execution = await executor.start({ workflow: definition.workflow, input });
  return { ...definition, execution };
}

function runtimeInput(
  execution: WorkflowExecution,
  workflow: ReturnType<typeof goalWorkflow>['workflow'],
  node: WorkflowNode,
): NodeRuntimeInput {
  return {
    execution,
    workflow,
    node,
    input: execution.nodeResults.goal?.output || {},
    attachments: {},
    signal: new AbortController().signal,
    emit: async () => undefined,
  };
}

describe('workflow goal completion', () => {
  it('recognizes aliases and completes only when every configured field is present', async () => {
    const { execution } = await execute(['name', 'CEP'], {
      completionStatus: 'completed',
      knownFields: {
        nome: 'Marina Souza',
        address: 'Rua Exemplo 10, CEP 01310-100',
      },
    });

    expect(execution.previousNodeId).toBe('completed');
    expect(execution.nodeResults.goal?.selectedOutput).toBe('completed');
    expect(execution.nodeResults.goal?.output?.goalCompletion).toMatchObject({
      complete: true,
      evaluatedBy: 'workflow_runtime',
      satisfiedFields: ['name', 'CEP'],
      missingFields: [],
      blockers: [],
    });
  });

  it('keeps the conversation open when a required field is missing', async () => {
    const { execution } = await execute(['name', 'CEP'], {
      completionStatus: 'completed',
      knownFields: { name: 'Marina Souza' },
    });

    expect(execution.previousNodeId).toBe('incomplete');
    expect(execution.nodeResults.goal?.output?.goalCompletion).toMatchObject({
      complete: false,
      missingFields: ['CEP'],
      blockers: ['required_fields_missing'],
    });
  });

  it('uses a CEP-only address as postal evidence without treating it as a complete address', async () => {
    const { execution } = await execute(['CEP', 'address'], {
      completionStatus: 'completed',
      knownFields: { address: 'CEP 01310-100' },
    });

    expect(execution.previousNodeId).toBe('incomplete');
    expect(execution.nodeResults.goal?.output?.goalCompletion).toMatchObject({
      satisfiedFields: ['CEP'],
      missingFields: ['address'],
      blockers: ['required_fields_missing'],
    });
  });

  it('does not complete while the final response still asks the customer a question', async () => {
    const { execution } = await execute(['name'], {
      completionStatus: 'completed',
      response: 'Obrigado. Qual é o número do imóvel?',
      knownFields: { name: 'Marina Souza' },
    });

    expect(execution.previousNodeId).toBe('incomplete');
    expect(execution.nodeResults.goal?.output?.goalCompletion).toMatchObject({
      complete: false,
      blockers: ['pending_customer_input'],
    });
  });

  it('does not treat collected fields as task completion while the agent is still working', async () => {
    const { execution } = await execute(['name', 'CEP'], {
      completionStatus: 'partial',
      knownFields: { name: 'Marina Souza', cep: '01310-100' },
    });

    expect(execution.previousNodeId).toBe('incomplete');
    expect(execution.nodeResults.goal?.output?.goalCompletion).toMatchObject({
      complete: false,
      blockers: ['completion_signal_missing'],
    });
  });

  it('does not inherit a completion signal from an unrelated earlier execution step', async () => {
    const { execution, workflow, goal } = await execute(['name'], {
      completionStatus: 'partial',
      knownFields: { name: 'Marina Souza' },
    });
    const input: NodeRuntimeInput = {
      ...runtimeInput(execution, workflow, goal),
      input: { knownFields: { name: 'Marina Souza' } },
      execution: {
        ...execution,
        executionPath: [{
          sequence: 1,
          attempt: 1,
          nodeId: 'old-agent',
          nodeType: 'ai.agent',
          status: 'completed',
          startedAt: '2026-07-13T12:00:00.000Z',
          finishedAt: '2026-07-13T12:00:01.000Z',
          durationMs: 1000,
          output: { completionStatus: 'completed' },
        }],
      },
    };

    expect(evaluateWorkflowGoalCompletion(input)).toMatchObject({
      complete: false,
      blockers: ['completion_signal_missing'],
    });
  });

  it('rejects fieldless auto-close unless the workflow author explicitly enables it', async () => {
    const { execution } = await execute([], { completionStatus: 'completed' });

    expect(execution.previousNodeId).toBe('incomplete');
    expect(execution.nodeResults.goal?.output?.goalCompletion).toMatchObject({
      complete: false,
      blockers: ['required_fields_not_configured'],
    });
  });

  it.each([
    ['if', 'incomplete'],
    ['if:false', 'completed'],
  ])('requires an explicit route when a routing node is a required operation: %s', async (operation, expected) => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const condition = workflowNode('logic.if', 'if', {
      left: '$.input.approved',
      operator: 'equals',
      right: true,
    });
    const goal = workflowNode('logic.goal_completion', 'goal', {
      requiredFields: ['name'],
      requiredOperations: [operation],
      requireCompletionSignal: true,
      allowFieldlessCompletion: false,
    });
    const unusedTrue = workflowNode('output.end', 'unused-true');
    const completed = workflowNode('output.end', 'completed');
    const incomplete = workflowNode('output.end', 'incomplete');
    const workflow = workflowDefinition(
      [trigger, condition, goal, unusedTrue, completed, incomplete],
      [
        connect(trigger, 'started', condition, 'main'),
        connect(condition, 'true', unusedTrue, 'main'),
        connect(condition, 'false', goal, 'main'),
        connect(goal, 'completed', completed, 'main'),
        connect(goal, 'incomplete', incomplete, 'main'),
      ],
    );
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry(),
    );

    const execution = await executor.start({
      workflow,
      input: {
        approved: false,
        completionStatus: 'completed',
        knownFields: { name: 'Marina' },
      },
    });

    expect(execution.nodeResults.goal?.selectedOutput).toBe(expected);
  });

  it('accepts a required system persistence receipt only when it is true', async () => {
    const definition = goalWorkflow(['name']);
    definition.goal.config.requiredOperations = ['system:contact_facts_persisted'];
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry(),
    );

    const execution = await executor.start({
      workflow: definition.workflow,
      input: {
        completionStatus: 'completed',
        knownFields: { name: 'Marina' },
        systemOperations: { contact_facts_persisted: true },
      },
    });

    expect(execution.nodeResults.goal?.selectedOutput).toBe('completed');
  });

  it('allows an operation-only goal when the required operation is proven', async () => {
    const definition = goalWorkflow([]);
    definition.goal.config.requiredOperations = ['system:contact_facts_persisted'];
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry(),
    );

    const execution = await executor.start({
      workflow: definition.workflow,
      input: {
        completionStatus: 'completed',
        systemOperations: { contact_facts_persisted: true },
      },
    });

    expect(execution.nodeResults.goal?.selectedOutput).toBe('completed');
  });

  it('accepts only evidence persisted by the evaluator in the same execution', async () => {
    const { execution, workflow, terminal } = await execute(['name'], {
      completionStatus: 'completed',
      knownFields: { nome: 'Marina Souza' },
    });
    const input = runtimeInput(execution, workflow, terminal);
    const evidence = execution.nodeResults.goal?.output?.goalCompletion;

    expect(isValidWorkflowGoalCompletionEvidence(evidence, input)).toBe(true);
    expect(isValidWorkflowGoalCompletionEvidence({
      ...(evidence as Record<string, unknown>),
      executionId: 'forged-execution',
    }, input)).toBe(false);
  });
});
