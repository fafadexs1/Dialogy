import { describe, expect, it } from 'vitest';
import {
  buildCollectionCompletionCheckpoint,
  createPersistedCollectionFieldReceipt,
  directAgentRouteHasFailedToolCalls,
  evaluateCompletedCollectionClose,
  extractPendingCollectionReplyFields,
  inspectCollectionResponseRoute,
  parseCollectionCompletionCheckpoint,
} from '@/services/autopilot/collection-completion';
import type { NodeRuntimeInput } from '@/services/workflow-runtime';
import { connect, workflowDefinition, workflowNode } from './workflow-runtime-fixtures';

function routedInput(kind: 'needs_input' | 'completed', options: {
  response?: string;
  missingFields?: string[];
  executionId?: string;
} = {}): NodeRuntimeInput {
  const agent = workflowNode('ai.agent', 'agent', {
    name: 'Raquel',
    role: 'atendimento',
    objective: 'Atender',
    completionCriteria: ['Concluir'],
  });
  const respond = workflowNode('output.respond', 'respond');
  const workflow = workflowDefinition(
    [agent, respond],
    [connect(agent, kind === 'needs_input' ? 'needs_input' : 'completed', respond, 'main')],
    { id: 'workflow-1', version: '18' },
  );
  const output = kind === 'needs_input'
    ? {
        type: 'needs_input',
        question: options.response || 'Informe nome e CEP.',
        missingFields: options.missingFields || ['name', 'CEP'],
      }
    : {
        type: 'final',
        response: options.response || 'Obrigada pelas informações!',
        completionStatus: 'completed',
      };
  return {
    workflow,
    node: respond,
    execution: {
      executionId: options.executionId || `execution-${kind}`,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      status: 'running',
      currentNodeId: respond.id,
      previousNodeId: agent.id,
      pendingNodeIds: [],
      input: {},
      variables: {},
      context: {},
      nodeResults: {
        [agent.id]: {
          status: kind === 'needs_input' ? 'route' : 'completed',
          selectedOutput: kind === 'needs_input' ? 'needs_input' : 'completed',
          output,
        },
      },
      executionPath: [],
      startedAt: '2026-07-13T12:00:00.000Z',
      updatedAt: '2026-07-13T12:00:00.000Z',
      totalSteps: 1,
      totalModelCalls: 1,
      totalToolCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      version: 0,
    },
    input: output,
    attachments: {},
    signal: new AbortController().signal,
    emit: async () => undefined,
  };
}

describe('autopilot collection completion compatibility', () => {
  it('persists and validates a checkpoint only from an actual agent needs_input route', () => {
    const route = inspectCollectionResponseRoute(routedInput('needs_input'));
    expect(route).toMatchObject({
      kind: 'needs_input',
      agentNodeId: 'agent',
      respondNodeId: 'respond',
      missingFields: ['name', 'CEP'],
    });
    const checkpoint = buildCollectionCompletionCheckpoint({
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      sourceMessageId: 'message-before',
      route: route!,
      askedAt: '2026-07-13T12:00:00.000Z',
    });

    expect(parseCollectionCompletionCheckpoint(checkpoint)).toEqual(checkpoint);
    expect(parseCollectionCompletionCheckpoint({ ...checkpoint, pendingFields: ['email'] })).toBeNull();
  });

  it('extracts labelled arbitrary fields without assigning an ambiguous multi-field reply', () => {
    expect(extractPendingCollectionReplyFields({
      customerMessage: 'Empresa: Dialogy; Setor: Suporte',
      pendingFields: ['Empresa', 'Setor'],
      alreadyKnownFields: {},
    })).toEqual({ Empresa: 'Dialogy', Setor: 'Suporte' });

    expect(extractPendingCollectionReplyFields({
      customerMessage: 'Dialogy Suporte',
      pendingFields: ['Empresa', 'Setor'],
      alreadyKnownFields: {},
    })).toEqual({});
  });

  it('does not persist conversation-control replies as a single requested field', () => {
    for (const customerMessage of ['não', 'quero falar com um humano', 'pode encerrar']) {
      expect(extractPendingCollectionReplyFields({
        customerMessage,
        pendingFields: ['Nome completo'],
        alreadyKnownFields: {},
      })).toEqual({});
    }
    expect(extractPendingCollectionReplyFields({
      customerMessage: 'Ana Souza',
      pendingFields: ['Nome completo'],
      alreadyKnownFields: {},
    })).toEqual({ 'Nome completo': 'Ana Souza' });
    expect(extractPendingCollectionReplyFields({
      customerMessage: 'Nome: quero falar com um atendente humano; CPF: 111.111.111-11',
      pendingFields: ['Nome', 'CPF'],
      alreadyKnownFields: {},
    })).toEqual({});
    expect(extractPendingCollectionReplyFields({
      customerMessage: 'Consentimento: sim',
      pendingFields: ['Consentimento'],
      alreadyKnownFields: {},
    })).toEqual({ Consentimento: 'sim' });
  });

  it('binds collection evidence to the directly routed agent and rendered response', () => {
    const input = routedInput('completed', { response: 'Obrigada pelas informações!' });
    expect(inspectCollectionResponseRoute(input, 'Obrigada pelas informações!')).toMatchObject({
      response: 'Obrigada pelas informações!',
    });
    expect(inspectCollectionResponseRoute(input, 'Agora informe um documento diferente.')).toBeNull();
    expect(inspectCollectionResponseRoute(
      routedInput('needs_input', { response: 'Informe nome e CEP.' }),
      'Informe nome e CEP. Também informe complemento.',
    )).toBeNull();
    expect(inspectCollectionResponseRoute({
      ...input,
      execution: { ...input.execution, previousNodeId: 'unrelated-node' },
    })).toBeNull();
  });

  it('invalidates collection evidence when the directly routed agent had a failed tool', () => {
    const input = routedInput('completed');
    const agentResult = input.execution.nodeResults.agent!;
    const withFailedTool = {
      ...input,
      execution: {
        ...input.execution,
        nodeResults: {
          ...input.execution.nodeResults,
          agent: {
            ...agentResult,
            toolCalls: [{
              id: 'call-1',
              toolName: 'crm_update_contact_custom_fields',
              arguments: {},
              status: 'error' as const,
              error: { code: 'failed', message: 'Falha', retryable: true },
            }],
          },
        },
      },
    } satisfies NodeRuntimeInput;

    expect(directAgentRouteHasFailedToolCalls(withFailedTool)).toBe(true);
    expect(inspectCollectionResponseRoute(withFailedTool)).toMatchObject({
      kind: 'completed',
      hasFailedToolCalls: true,
    });
  });

  it('allows close only after another execution persisted every requested field', () => {
    const needsRoute = inspectCollectionResponseRoute(routedInput('needs_input'))!;
    const checkpoint = buildCollectionCompletionCheckpoint({
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      sourceMessageId: 'message-before',
      route: needsRoute,
      askedAt: '2026-07-13T12:00:00.000Z',
    });
    const completedRoute = inspectCollectionResponseRoute(routedInput('completed', {
      executionId: 'execution-current',
    }))!;
    const receipts = [
      createPersistedCollectionFieldReceipt({
        field: 'name',
        value: 'Ana',
        storage: 'slot_memory',
        sourceMessageId: 'message-current',
        persistedAt: '2026-07-13T12:01:00.000Z',
      }),
      createPersistedCollectionFieldReceipt({
        field: 'address',
        value: 'CEP 01310-100',
        storage: 'slot_memory',
        sourceMessageId: 'message-current',
        persistedAt: '2026-07-13T12:01:00.000Z',
      }),
    ];

    expect(evaluateCompletedCollectionClose({
      checkpoint,
      route: completedRoute,
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      sourceMessageId: 'message-current',
      knownFields: { name: 'Ana', address: 'CEP 01310-100' },
      receipts,
      invalidFieldNames: [],
    })).toMatchObject({ allowed: true, reason: 'collection_completed' });
  });

  it('carries the original field obligations across a multi-turn partial collection', () => {
    const firstRoute = inspectCollectionResponseRoute(routedInput('needs_input', {
      executionId: 'ask-1',
      missingFields: ['Empresa', 'Setor'],
    }))!;
    const firstCheckpoint = buildCollectionCompletionCheckpoint({
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      sourceMessageId: 'message-before',
      route: firstRoute,
      askedAt: '2026-07-13T12:00:00.000Z',
    })!;
    const companyReceipt = createPersistedCollectionFieldReceipt({
      field: 'Empresa',
      value: 'Dialogy',
      storage: 'crm_custom_field',
      sourceMessageId: 'message-company',
      persistedAt: '2026-07-13T12:01:00.000Z',
    });
    const secondRoute = inspectCollectionResponseRoute(routedInput('needs_input', {
      executionId: 'ask-2',
      missingFields: ['Setor'],
    }))!;
    const secondCheckpoint = buildCollectionCompletionCheckpoint({
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      sourceMessageId: 'message-company',
      route: secondRoute,
      askedAt: '2026-07-13T12:02:00.000Z',
      previousCheckpoint: firstCheckpoint,
      knownFields: { Empresa: 'Dialogy' },
      receipts: [companyReceipt],
    })!;

    expect(secondCheckpoint).toMatchObject({
      pendingFields: ['Empresa', 'Setor'],
      confirmedFields: ['Empresa'],
    });
    const finalRoute = inspectCollectionResponseRoute(routedInput('completed', {
      executionId: 'complete-3',
      response: 'Obrigada pelas informações. Está tudo certo!',
    }))!;
    const sectorReceipt = createPersistedCollectionFieldReceipt({
      field: 'Setor',
      value: 'Suporte',
      storage: 'crm_custom_field',
      sourceMessageId: 'message-sector',
      persistedAt: '2026-07-13T12:03:00.000Z',
    });
    expect(evaluateCompletedCollectionClose({
      checkpoint: secondCheckpoint,
      route: finalRoute,
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      sourceMessageId: 'message-sector',
      knownFields: { Empresa: 'Dialogy', Setor: 'Suporte' },
      receipts: [sectorReceipt],
      invalidFieldNames: [],
    })).toMatchObject({ allowed: true, reason: 'collection_completed' });
  });

  it('does not start collection-close evidence after a failed agent tool call', () => {
    const input = routedInput('needs_input');
    const agentResult = input.execution.nodeResults.agent!;
    input.execution.nodeResults.agent = {
      ...agentResult,
      toolCalls: [{
        id: 'tool-failed',
        toolName: 'lookup',
        status: 'error',
        arguments: {},
        startedAt: '2026-07-13T12:00:00.000Z',
        finishedAt: '2026-07-13T12:00:01.000Z',
      }],
    };
    const route = inspectCollectionResponseRoute(input)!;
    expect(buildCollectionCompletionCheckpoint({
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      sourceMessageId: 'message-before',
      route,
    })).toBeNull();
  });

  it.each<[string, string | null, string, string[]]>([
    ['no checkpoint', null, 'Obrigada pelas informações!', []],
    ['open question', 'checkpoint', 'Obrigada. Qual é o complemento?', []],
    ['missing receipt', 'checkpoint', 'Obrigada pelas informações!', ['drop-receipts']],
    ['invalid field', 'checkpoint', 'Obrigada pelas informações!', ['invalid']],
  ])('blocks unsafe completion: %s', (_label, checkpointMode, response, flags) => {
    const needsRoute = inspectCollectionResponseRoute(routedInput('needs_input'))!;
    const checkpoint = checkpointMode
      ? buildCollectionCompletionCheckpoint({
          chatId: 'chat-1',
          autopilotConfigId: 'config-1',
          sourceMessageId: 'message-before',
          route: needsRoute,
          askedAt: '2026-07-13T12:00:00.000Z',
        })
      : null;
    const route = inspectCollectionResponseRoute(routedInput('completed', {
      executionId: 'execution-current',
      response,
    }))!;
    const receipts = flags.includes('drop-receipts') ? [] : [
      createPersistedCollectionFieldReceipt({ field: 'name', value: 'Ana', storage: 'slot_memory', sourceMessageId: 'message-current', persistedAt: '2026-07-13T12:01:00.000Z' }),
      createPersistedCollectionFieldReceipt({ field: 'address', value: 'CEP 01310-100', storage: 'slot_memory', sourceMessageId: 'message-current', persistedAt: '2026-07-13T12:01:00.000Z' }),
    ];

    expect(evaluateCompletedCollectionClose({
      checkpoint,
      route,
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      sourceMessageId: 'message-current',
      knownFields: { name: 'Ana', address: 'CEP 01310-100' },
      receipts,
      invalidFieldNames: flags.includes('invalid') ? ['customer_identifier'] : [],
    }).allowed).toBe(false);
  });

  it('does not let a CEP-only receipt satisfy a requested complete address', () => {
    const needsRoute = inspectCollectionResponseRoute(routedInput('needs_input', { missingFields: ['address'] }))!;
    const checkpoint = buildCollectionCompletionCheckpoint({
      chatId: 'chat-1', autopilotConfigId: 'config-1', sourceMessageId: 'before', route: needsRoute,
      askedAt: '2026-07-13T12:00:00.000Z',
    });
    const route = inspectCollectionResponseRoute(routedInput('completed', { executionId: 'current' }))!;
    const receipt = createPersistedCollectionFieldReceipt({
      field: 'address', value: 'CEP 01310-100', storage: 'slot_memory', sourceMessageId: 'current-message', persistedAt: '2026-07-13T12:01:00.000Z',
    });
    expect(evaluateCompletedCollectionClose({
      checkpoint,
      route,
      chatId: 'chat-1',
      autopilotConfigId: 'config-1',
      sourceMessageId: 'current-message',
      knownFields: { address: 'CEP 01310-100' },
      receipts: [receipt],
      invalidFieldNames: [],
    }).allowed).toBe(false);
  });
});
