import { describe, expect, it } from 'vitest';
import {
  buildCollectionCompletionCheckpoint,
  chooseNonRepeatingCollectionFallback,
  createPersistedCollectionFieldReceipt,
  directAgentRouteHasFailedToolCalls,
  evaluateCompletedCollectionClose,
  extractPendingCollectionHistoryFields,
  extractPendingCollectionReplyFields,
  findPendingCollectionQuestion,
  inspectCollectionResponseRoute,
  parseCollectionCompletionCheckpoint,
  sanitizeConversationKnownFields,
} from '@/services/autopilot/collection-completion';
import type { NodeRuntimeInput } from '@/services/workflow-runtime';
import { hashValue } from '@/services/workflow-runtime/utils';
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
    const {
      checkpointFingerprint: _checkpointFingerprint,
      collectionStartedAt: _collectionStartedAt,
      ...legacyCheckpoint
    } = checkpoint!;
    const legacyFingerprint = hashValue({ ...legacyCheckpoint, status: 'awaiting_fields' });
    expect(parseCollectionCompletionCheckpoint({
      ...legacyCheckpoint,
      checkpointFingerprint: legacyFingerprint,
    })).toMatchObject({
      collectionStartedAt: new Date(new Date(checkpoint!.askedAt).getTime() - 5 * 60_000).toISOString(),
      checkpointFingerprint: legacyFingerprint,
    });
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

  it('binds a short reply to the one pending field explicitly asked in the prior question', () => {
    const pendingFields = ['contractId', 'problemDescription', 'preference'];

    expect(extractPendingCollectionReplyFields({
      customerMessage: '16318 esse aqui',
      pendingFields,
      alreadyKnownFields: { customer_identifier: '86675273191' },
      previousQuestion: 'Qual contrato ou endereco voce deseja consultar?',
    })).toEqual({ contractId: '16318' });

    expect(extractPendingCollectionReplyFields({
      customerMessage: 'A conexao da internet esta muito lenta',
      pendingFields,
      alreadyKnownFields: { contractId: '16318' },
      previousQuestion: 'Qual problema esta acontecendo com a sua conexao?',
    })).toEqual({ problemDescription: 'A conexao da internet esta muito lenta' });

    expect(extractPendingCollectionReplyFields({
      customerMessage: 'Ativa ai pra mim o Wi-Fi',
      pendingFields,
      alreadyKnownFields: {
        contractId: '16318',
        problemDescription: 'A conexao da internet esta muito lenta',
      },
      previousQuestion: 'Voce gostaria de ativar ou prefere alterar o nome e a senha?',
    })).toEqual({ preference: 'Ativa ai pra mim o Wi-Fi' });
  });

  it('reconstructs collected workflow fields from alternating visible chat history', () => {
    const recovered = extractPendingCollectionHistoryFields({
      messages: [
        { fromMe: true, content: 'Qual contrato voce deseja consultar?' },
        { fromMe: false, content: '16318 esse aqui' },
        { fromMe: true, content: 'Qual problema esta acontecendo?' },
        { fromMe: false, content: 'Meu Wi-Fi esta muito lento' },
        { fromMe: true, content: 'Voce prefere ativar ou alterar as configuracoes?' },
        { fromMe: false, content: 'Ativa ai pra mim' },
      ],
      pendingFields: ['contractId', 'problemDescription', 'preference'],
      alreadyKnownFields: { customer_identifier: '86675273191' },
    });

    expect(recovered).toEqual({
      contractId: '16318',
      problemDescription: 'Meu Wi-Fi esta muito lento',
      preference: 'Ativa ai pra mim',
    });
  });

  it('keeps ambiguous questions and unrelated replies out of generic conversation memory', () => {
    expect(extractPendingCollectionReplyFields({
      customerMessage: 'Dialogy Suporte',
      pendingFields: ['Empresa', 'Setor'],
      alreadyKnownFields: {},
      previousQuestion: 'Informe a empresa e o setor.',
    })).toEqual({});
    expect(extractPendingCollectionReplyFields({
      customerMessage: 'Tudo certo por aqui',
      pendingFields: ['contractId', 'problemDescription', 'preference'],
      alreadyKnownFields: {},
      previousQuestion: 'Posso ajudar em mais alguma coisa?',
    })).toEqual({});
  });

  it('accepts an explicit correction to a remembered field', () => {
    expect(extractPendingCollectionReplyFields({
      customerMessage: '99999',
      pendingFields: ['contractId', 'problemDescription'],
      alreadyKnownFields: { contractId: '16318' },
      previousQuestion: 'Qual contrato voce quer consultar agora?',
    })).toEqual({ contractId: '99999' });
    expect(extractPendingCollectionReplyFields({
      customerMessage: 'Contrato: 88888',
      pendingFields: ['contractId', 'problemDescription'],
      alreadyKnownFields: { contractId: '16318' },
    })).toEqual({ contractId: '88888' });
  });

  it('keeps the pending question across informational messages but not another request', () => {
    expect(findPendingCollectionQuestion({
      messages: [
        { fromMe: true, content: 'Qual contrato voce deseja consultar?' },
        { fromMe: true, content: 'Vou usar apenas consultas seguras.' },
      ],
      pendingFields: ['contractId', 'problemDescription'],
    })).toBe('Qual contrato voce deseja consultar?');
    expect(findPendingCollectionQuestion({
      messages: [
        { fromMe: true, content: 'Qual contrato voce deseja consultar?' },
        { fromMe: true, content: 'Posso ajudar em outra coisa?' },
      ],
      pendingFields: ['contractId', 'problemDescription'],
    })).toBeNull();
  });

  it('replaces a configured fallback that asks for a field already known', () => {
    const genericFallback = 'Nao consegui concluir esta etapa agora.';
    expect(chooseNonRepeatingCollectionFallback({
      configuredFallback: 'Para continuar, me informe seu CPF ou CNPJ.',
      knownFields: { customer_identifier: '86675273191' },
      genericFallback,
    })).toBe(genericFallback);
    expect(chooseNonRepeatingCollectionFallback({
      configuredFallback: 'Pode detalhar o problema?',
      knownFields: { customer_identifier: '86675273191' },
      genericFallback,
    })).toBe('Pode detalhar o problema?');
    expect(chooseNonRepeatingCollectionFallback({
      configuredFallback: 'Me informe o CPF/CNPJ do titular, por favor.',
      knownFields: { name: 'Fabricio' },
      genericFallback,
    })).toBe('Me informe o CPF/CNPJ do titular, por favor.');
  });

  it('sanitizes bounded current-chat workflow memory without accepting nested state', () => {
    expect(sanitizeConversationKnownFields({
      contractId: ' 16318 esse aqui ',
      preference: ' Ativar Wi-Fi ',
      nested: { unsafe: true },
      constructor: 'ignored',
    })).toEqual({
      contractId: '16318 esse aqui',
      preference: 'Ativar Wi-Fi',
    });
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
      collectionStartedAt: firstCheckpoint.collectionStartedAt,
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
