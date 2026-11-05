import { createHash } from 'node:crypto';

import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import type {
  ConnectionType,
  ModelConfiguration,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowValidationResult,
} from '@/services/workflow-runtime/types';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';

import { LegacyNexusFlowSchema, repairLegacyNexusText } from './legacy-import';

const REQUIRED_LEGACY_NODES = {
  welcome: 'a417828e-d19f-45ea-8184-f26348f588a8',
  mainMenu: 'c64c2011-f4f0-43c3-9721-d3e97f7fa58d',
  referralMenu: 'b67f8821-c264-490b-89e6-ab8722bdcdd3',
  commercialMessage: 'c6cdfb32-5bdf-4d85-a141-56266c1a317a',
  supportClosedMessage: 'c6f70a76-fb40-42c2-b16d-23795232947a',
  supportMenu: 'b0ca8f89-f86b-4653-bcb6-11abfc89ca3e',
  supportHandoffMessage: '3df99771-1413-4413-972e-294a02deb895',
  financeMenu: '99ae0347-cb4d-45c8-98a3-8fb6c31e53e9',
  financeClosedMessage: 'dfba00ef-5b34-4cd8-ac03-ce455dfcd407',
  handoffMessage: '38ea2175-2948-4a86-a61c-fc6165287904',
  copySuccessMessage: '6936cf8d-0820-4801-bc4c-65131905e557',
  genericFailureMessage: '3fcd5026-326b-4393-8842-dc536e562c64',
  retryCopyMenu: 'f5b65cb6-1e8d-424e-aef2-32b89f08fcf5',
  retryPromiseMenu: '086d414c-f199-4d4d-bfc4-103f5cdb316b',
  closeMessage: 'd1454be5-c3ef-431a-9f32-455f7c42bb3e',
  agent: '86d4cc09-9e0c-49c2-91be-f57aced83f3d',
  discordTool: 'c18e8cae-ee42-4673-89e2-f810e905695f',
} as const;

const PRUNED_LEGACY_NODE_IDS = [
  'a7a9d87a-b148-42e9-896e-6b96ad0399a0',
  'eb69168d-2b65-4a55-bbf8-0892e271ec83',
  '70580637-dcda-4e48-b85f-23380be38e45',
] as const;

export const VELPRO_FINAL_PROFILE = 'velpro-final-native-v1';
export const VELPRO_DISCORD_CHANNEL_ID = '1420958123576791100';
export const VELPRO_PENDING_DISCORD_CREDENTIAL_ID = '00000000-0000-4000-8000-000000000000';

type LegacyNode = Record<string, unknown> & { id: string; type: string };

export type VelproFinalBindings = {
  workspaceId: string;
  workflowId: string;
  raquelConfigId: string;
  senderSystemAgentId: string;
  model: ModelConfiguration;
  instanceNames: string[];
  teamIds: {
    commercial: string;
    finance: string;
    support: string;
  };
  tagIds: {
    commercial: string;
    finance: string;
    support: string;
    secondCopy: string;
    closeReason: string;
  };
  knowledgeDocumentIds: string[];
  discordCredentialId?: string;
};

export type VelproFinalBuildResult = {
  workflow: WorkflowDefinition;
  validation: WorkflowValidationResult;
  sourceHash: string;
  credentialReady: boolean;
  prunedLegacyNodeIds: string[];
};

type OptionDefinition = { id: string; label: string };

function asLegacyNode(value: unknown): LegacyNode {
  return value as LegacyNode;
}

function repaired(value: unknown, fallback = '') {
  return typeof value === 'string' ? repairLegacyNexusText(value) : fallback;
}

function legacyOptions(node: LegacyNode): string[] {
  const options = Array.isArray(node.options)
    ? node.options
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => repaired(item.value).trim())
      .filter(Boolean)
    : [];
  if (options.length > 0) return options;
  return repaired(node.optionsList)
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function addDynamicMainOutput(node: WorkflowNode, id: string, label: string) {
  if (node.outputPorts.some((port) => port.id === id)) return;
  const firstAttachmentOrError = node.outputPorts.findIndex((port) => port.connectionType !== 'main');
  node.outputPorts.splice(firstAttachmentOrError < 0 ? node.outputPorts.length : firstAttachmentOrError, 0, {
    id,
    label,
    direction: 'output',
    connectionType: 'main',
    required: false,
    multiple: false,
  });
}

function rewriteRaquelPrompt(prompt: string) {
  return prompt
    .replace(/@lookup_knowledge/gi, 'a base de conhecimento nativa conectada')
    .replace(/\(http-tool\)/gi, '(ferramenta HTTP nativa da Dialogy)');
}

function rewriteDiscordToolDescription(description: string) {
  return [
    'Receba o argumento INFORMACOES_CLIENTE como uma única string de texto. A Dialogy fará o envelope JSON e a autenticação de forma segura.',
    '',
    description
      .replace(/NÃO é JSON/gi, 'O argumento não deve ser um objeto JSON')
      .replace(/NÃƒO é JSON/gi, 'O argumento não deve ser um objeto JSON'),
  ].join('\n');
}

export function buildVelproFinalWorkflow(input: {
  rawLegacyFlow: unknown;
  bindings: VelproFinalBindings;
  now?: Date;
}): VelproFinalBuildResult {
  const legacy = LegacyNexusFlowSchema.parse(input.rawLegacyFlow);
  const sourceName = repaired(legacy.name).trim();
  if (sourceName !== 'Fluxo Velpro Final') {
    throw new Error(`O arquivo informado não é o "Fluxo Velpro Final" esperado: ${sourceName || 'sem nome'}.`);
  }
  if (legacy.nodes.length !== 71 || legacy.connections.length !== 85) {
    throw new Error(`A exportação Velpro esperada possui 71 blocos e 85 conexões; foram recebidos ${legacy.nodes.length} e ${legacy.connections.length}.`);
  }

  const legacyById = new Map(legacy.nodes.map((node) => [node.id, asLegacyNode(node)]));
  const required = (key: keyof typeof REQUIRED_LEGACY_NODES, expectedType?: string) => {
    const id = REQUIRED_LEGACY_NODES[key];
    const node = legacyById.get(id);
    if (!node || (expectedType && node.type !== expectedType)) {
      throw new Error(`O bloco obrigatório ${key} (${id}) não foi encontrado na exportação Velpro.`);
    }
    return node;
  };
  for (const id of PRUNED_LEGACY_NODE_IDS) {
    if (!legacyById.has(id)) throw new Error(`O bloco órfão esperado ${id} não foi encontrado; a fonte Velpro não corresponde ao perfil validado.`);
  }

  const welcomeLegacy = required('welcome', 'message');
  const mainMenuLegacy = required('mainMenu', 'option');
  const referralLegacy = required('referralMenu', 'option');
  const commercialMessageLegacy = required('commercialMessage', 'message');
  const supportClosedLegacy = required('supportClosedMessage', 'message');
  const supportMenuLegacy = required('supportMenu', 'option');
  const supportHandoffLegacy = required('supportHandoffMessage', 'message');
  const financeMenuLegacy = required('financeMenu', 'option');
  const financeClosedLegacy = required('financeClosedMessage', 'message');
  const handoffLegacy = required('handoffMessage', 'message');
  const copySuccessLegacy = required('copySuccessMessage', 'message');
  const failureLegacy = required('genericFailureMessage', 'message');
  const retryPromiseLegacy = required('retryPromiseMenu', 'option');
  const closeLegacy = required('closeMessage', 'message');
  const agentLegacy = required('agent', 'intelligent-agent');
  const discordLegacy = required('discordTool', 'http-tool');

  const mainLabels = legacyOptions(mainMenuLegacy);
  const referralLabels = legacyOptions(referralLegacy);
  const supportLabels = legacyOptions(supportMenuLegacy);
  const financeLabels = legacyOptions(financeMenuLegacy);
  const promiseRetryLabels = legacyOptions(retryPromiseLegacy);
  if (mainLabels.length !== 5 || referralLabels.length !== 7 || supportLabels.length !== 3 || financeLabels.length !== 6) {
    throw new Error('As opções principais da exportação Velpro não correspondem ao fluxo validado.');
  }

  const timestamp = (input.now || new Date()).toISOString();
  const sourceHash = createHash('sha256').update(JSON.stringify(input.rawLegacyFlow)).digest('hex');
  const { bindings } = input;
  const workflow: WorkflowDefinition = {
    id: `nexus:${bindings.workflowId}`,
    workspaceId: bindings.workspaceId,
    name: 'Fluxo Velpro Final',
    version: 'draft',
    status: 'draft',
    nodes: [],
    connections: [],
    settings: {
      executionTimeoutMs: 86_400_000,
      maxSteps: 500,
      maxModelCalls: 40,
      maxToolCalls: 20,
      maxAgentTurnsPerNode: 12,
      maxRepeatedDecisionSignatures: 2,
      maxTotalInputTokens: 160_000,
      maxTotalOutputTokens: 30_000,
      concurrencyLimit: 1,
    },
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        message: { type: 'string' },
        customerMessage: { type: 'string' },
        sourceMessageId: { type: 'string' },
      },
      additionalProperties: true,
    },
    metadata: {
      editor: 'nexus',
      kind: 'standalone',
      nexusWorkflowId: bindings.workflowId,
      profile: VELPRO_FINAL_PROFILE,
      source: 'nexusflow_legacy_import',
      sourceName,
      sourceVersion: repaired(legacy.version) || null,
      sourceSha256: sourceHash,
      legacyNodeCount: legacy.nodes.length,
      legacyConnectionCount: legacy.connections.length,
      prunedLegacyNodeIds: [...PRUNED_LEGACY_NODE_IDS],
      aiRuntime: 'dialogy_native',
      raquelConfigId: bindings.raquelConfigId,
      senderSystemAgentId: bindings.senderSystemAgentId,
      credentialReady: Boolean(bindings.discordCredentialId),
      priority: 100,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const byId = new Map<string, WorkflowNode>();
  let edgeSequence = 0;
  const add = (
    type: string,
    id: string,
    name: string,
    position: { x: number; y: number },
    config: Record<string, unknown> = {},
  ) => {
    if (byId.has(id)) throw new Error(`ID de bloco duplicado no perfil Velpro: ${id}.`);
    const node = createWorkflowNode(type, { id, name, position, config });
    workflow.nodes.push(node);
    byId.set(id, node);
    return node;
  };
  const connect = (
    source: WorkflowNode,
    sourcePortId: string,
    target: WorkflowNode,
    targetPortId = 'main',
    connectionType?: ConnectionType,
  ) => {
    const sourcePort = source.outputPorts.find((port) => port.id === sourcePortId);
    const targetPort = target.inputPorts.find((port) => port.id === targetPortId);
    if (!sourcePort) throw new Error(`Saída ${source.id}:${sourcePortId} não existe.`);
    if (!targetPort) throw new Error(`Entrada ${target.id}:${targetPortId} não existe.`);
    const type = connectionType || sourcePort.connectionType;
    if (sourcePort.connectionType !== type || targetPort.connectionType !== type) {
      throw new Error(`Conexão incompatível ${source.id}:${sourcePortId} -> ${target.id}:${targetPortId}.`);
    }
    edgeSequence += 1;
    workflow.connections.push({
      id: `velpro_edge_${String(edgeSequence).padStart(3, '0')}`,
      sourceNodeId: source.id,
      sourcePortId,
      targetNodeId: target.id,
      targetPortId,
      connectionType: type,
    });
  };
  const respond = (id: string, name: string, x: number, y: number, message: string) => add(
    'output.respond', id, name, { x, y }, { channel: 'source', message, idempotent: true },
  );
  const end = (id: string, name: string, x: number, y: number, outcome: string) => add(
    'output.end', id, name, { x, y }, { output: { outcome } },
  );
  const options = (
    id: string,
    name: string,
    x: number,
    y: number,
    prompt: string,
    outputKey: string,
    definitions: OptionDefinition[],
  ) => {
    const node = add('interaction.options', id, name, { x, y }, {
      prompt,
      footer: '',
      deliveryMode: 'list',
      options: definitions.map((option) => ({ id: option.id, value: option.label, label: option.label })),
      outputKey,
      timeoutMs: 86_400_000,
      customFallbackRoutes: false,
      invalidOptionMessage: 'Opção inválida. Escolha uma das opções abaixo.',
    });
    definitions.forEach((option) => addDynamicMainOutput(node, option.id, option.label));
    return node;
  };
  const loop = (id: string, name: string, x: number, y: number, maxIterations: number) => add(
    'logic.loop', id, name, { x, y }, { maxIterations, exitCondition: 'false', totalTimeoutMs: 86_400_000 },
  );
  const teamAvailability = (id: string, name: string, x: number, y: number, teamId: string, outputKey: string) => add(
    'dialogy.team_availability', id, name, { x, y }, { teamId, outputKey, permissionScope: 'teams:read' },
  );
  const tag = (id: string, name: string, x: number, y: number, tagId: string) => add(
    'dialogy.chat_tag', id, name, { x, y }, { tagId, outputKey: `${id}Result`, permissionScope: 'chats:tag' },
  );
  const handoff = (id: string, name: string, x: number, y: number, teamId: string, reason: string) => add(
    'output.handoff', id, name, { x, y }, {
      destinationType: 'human',
      teamId,
      agentId: '',
      systemAgentId: '',
      reason,
      requireConfirmation: false,
      confirmationPath: '',
      permissionScope: 'conversation:handoff',
    },
  );

  const trigger = add('trigger.received_message', 'velpro_trigger', 'Mensagem recebida · Velpro', { x: 0, y: 0 }, {
    matchMode: 'all',
    keywords: [],
    pattern: '',
    caseSensitive: false,
    continueMatching: false,
    platforms: ['whatsapp'],
    instanceNames: [...bindings.instanceNames],
    messageTypes: ['text'],
    startPolicy: 'unassigned_only',
    sessionTimeoutMs: 86_400_000,
  });
  const bootstrap = add('data.set', 'velpro_context', 'Preparar contexto Velpro', { x: 280, y: 0 }, {
    assignments: {
      id_conversa: '{{conversationId}}',
      id_chat: '{{conversationId}}',
      mensagem_usuario: '{{input.message}}',
      id_estavel: '{{context.contactPhone}}',
      nome_usuario: '{{context.contactName}}',
    },
  });
  const welcome = respond('velpro_welcome', 'Boas-vindas Velpro', 560, 0, repaired(welcomeLegacy.text));
  const mainMenu = options('velpro_main_menu', 'Menu principal Velpro', 840, 0, repaired(mainMenuLegacy.questionText), 'escolha_usuario', [
    { id: 'subscribe', label: mainLabels[0]! },
    { id: 'address_transfer', label: mainLabels[1]! },
    { id: 'support', label: mainLabels[2]! },
    { id: 'finance', label: mainLabels[3]! },
    { id: 'close', label: mainLabels[4]! },
  ]);

  const expiredMessage = respond('velpro_session_expired', 'Avisar sessão expirada', 5520, 2160, 'O tempo desta etapa expirou. Envie uma nova mensagem para iniciar novamente.');
  const expiredEnd = end('velpro_session_expired_end', 'Finalizar sessão expirada', 6080, 2160, 'session_expired');
  const retryExhausted = respond('velpro_retry_exhausted', 'Limite de tentativas', 5520, 1960, 'Não consegui confirmar uma opção após algumas tentativas. Envie uma nova mensagem para recomeçar.');
  const retryEnd = end('velpro_retry_end', 'Finalizar tentativas', 6080, 1960, 'retry_limit');
  connect(expiredMessage, 'success', expiredEnd);
  connect(retryExhausted, 'success', retryEnd);

  const closeNotice = respond('velpro_close_notice', 'Avisar encerramento', 4680, 1720, repaired(closeLegacy.text));
  const closeConversation = add('output.close_conversation', 'velpro_close_chat', 'Encerrar atendimento Velpro', { x: 4960, y: 1720 }, {
    reason: 'Atendimento concluído pelo Fluxo Velpro Final.',
    notes: 'Executou uma ação automatizada ou escolheu encerrar o atendimento.',
    reasonTagId: bindings.tagIds.closeReason,
    sendCloseMessage: false,
    closePolicy: 'deterministic_route',
    permissionScope: 'conversation:close',
  });
  const closeEnd = end('velpro_close_end', 'Atendimento encerrado', 5240, 1720, 'closed');
  connect(closeNotice, 'success', closeConversation);
  connect(closeConversation, 'completed', closeEnd);

  connect(mainMenu, 'close', closeNotice);

  const referralMenu = options('velpro_referral_menu', 'Como conheceu a Velpro', 1400, -520, repaired(referralLegacy.questionText), 'origem_cliente', referralLabels.map((label, index) => ({
    id: `referral_${index + 1}`,
    label,
  })));
  connect(mainMenu, 'subscribe', referralMenu);

  const commercialAvailability = teamAvailability(
    'velpro_commercial_availability', 'Expediente comercial', 1960, -520,
    bindings.teamIds.commercial, 'commercialAvailability',
  );
  for (let index = 0; index < referralLabels.length; index += 1) connect(referralMenu, `referral_${index + 1}`, commercialAvailability);
  connect(mainMenu, 'address_transfer', commercialAvailability);
  const commercialOpenTag = tag('velpro_commercial_open_tag', 'Etiquetar comercial aberto', 2240, -680, bindings.tagIds.commercial);
  const commercialClosedTag = tag('velpro_commercial_closed_tag', 'Etiquetar comercial fora de horário', 2240, -360, bindings.tagIds.commercial);
  connect(commercialAvailability, 'open', commercialOpenTag);
  connect(commercialAvailability, 'closed', commercialClosedTag);

  const commercialMessage = respond('velpro_commercial_message', 'Preparar transferência comercial', 2520, -680, repaired(commercialMessageLegacy.text));
  const commercialHandoff = handoff(
    'velpro_commercial_handoff', 'Transferir para Comercial', 2800, -680,
    bindings.teamIds.commercial, 'Cliente interessado em contratação ou transferência de endereço.',
  );
  const commercialEnd = end('velpro_commercial_end', 'Finalizar transferência comercial', 3080, -680, 'commercial_handoff');
  connect(commercialOpenTag, 'success', commercialMessage);
  connect(commercialMessage, 'success', commercialHandoff);
  connect(commercialHandoff, 'completed', commercialEnd);

  const model = add('ai.model', 'velpro_raquel_model', 'Modelo nativo da Raquel', { x: 2520, y: -80 }, bindings.model);
  const memory = add('memory.session', 'velpro_raquel_memory', 'Memória híbrida Dialogy', { x: 2760, y: -80 }, {
    provider: 'dialogy',
    scope: 'hybrid',
    maxMessages: 40,
    maxAgeDays: 180,
    maxEntries: 100,
    layers: ['turn_context', 'operational_state', 'contact_fact', 'case_memory'],
  });
  const knowledge = add('knowledge.rag_retriever', 'velpro_raquel_knowledge', 'Base comercial Velpro', { x: 3000, y: -80 }, {
    documentIds: [...bindings.knowledgeDocumentIds],
    maxDocuments: 8,
    minimumScore: 0.55,
    filters: {},
    strategy: 'hybrid',
    rerank: true,
    tokenLimit: 8_000,
  });
  const guardrail = add('guardrail.policy', 'velpro_raquel_guardrail', 'Proteções da Raquel', { x: 3240, y: -80 }, {
    name: 'Proteções comerciais Velpro',
    checks: ['no_secret_exposure', 'no_unconfirmed_tool_success', 'no_fabricated_knowledge'],
    onViolation: 'route_to_error',
  });
  const discordTool = add('tool.http', 'velpro_discord_tool', 'Enviar atendimento ao Discord', { x: 3480, y: -80 }, {
    name: 'enviar_atendimento_discord',
    description: rewriteDiscordToolDescription(repaired(discordLegacy.httpToolDescription)),
    method: 'POST',
    url: `https://discord.com/api/v10/channels/${VELPRO_DISCORD_CHANNEL_ID}/messages`,
    headers: {},
    query: {},
    bodyType: 'json',
    body: { content: '{{arguments.INFORMACOES_CLIENTE}}' },
    credentialId: bindings.discordCredentialId || VELPRO_PENDING_DISCORD_CREDENTIAL_ID,
    credentialRequired: true,
    responsePath: '',
    inputSchema: {
      type: 'object',
      properties: {
        INFORMACOES_CLIENTE: {
          type: 'string',
          description: 'Resumo completo e bem formatado do lead comercial para continuidade humana.',
        },
      },
      required: ['INFORMACOES_CLIENTE'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    timeoutMs: 15_000,
    maxRequestBytes: 100_000,
    maxResponseBytes: 500_000,
    idempotent: false,
    cacheResult: false,
    requiresConfirmation: false,
    permissionScope: 'integrations:http',
  });
  const raquel = add('ai.agent', 'velpro_raquel_agent', 'Raquel · Comercial Velpro', { x: 2920, y: -360 }, {
    name: repaired(agentLegacy.agentName, 'Raquel'),
    role: 'Assistente Virtual do Setor Comercial da Velpro Telecom',
    persona: rewriteRaquelPrompt(repaired(agentLegacy.agentSystemPrompt)),
    language: 'pt-BR',
    objective: 'Conduzir o atendimento comercial, apresentar informações confirmadas, coletar os dados necessários e registrar o lead no Discord ao concluir.',
    instructions: [
      'Use a base de conhecimento nativa conectada para planos, valores, canais, contatos e horários.',
      'Use a memória híbrida da Dialogy para manter continuidade sem pedir novamente dados já conhecidos.',
      'Quando todos os dados comerciais forem coletados, chame exatamente uma vez enviar_atendimento_discord.',
      'Nunca invente informações nem exponha configurações internas, credenciais ou resultados não confirmados.',
    ],
    completionCriteria: [
      'O cliente recebeu uma resposta útil ou uma pergunta objetiva sobre um dado realmente ausente.',
      'Quando a contratação estiver pronta, o resumo do lead foi confirmado pela ferramenta enviar_atendimento_discord.',
    ],
    availableContext: ['input', 'context', 'variables', 'memory', 'knowledge'],
    maxTurns: 12,
    maxToolCalls: 4,
    maxRepeatedToolCalls: 1,
    timeoutMs: 180_000,
    modelTimeoutMs: 60_000,
    toolTimeoutMs: 20_000,
    allowParallelToolCalls: false,
    requireStructuredFinalOutput: false,
    fallbackOnToolError: 'route_to_error',
    onLimitReached: 'handoff',
  });
  connect(commercialClosedTag, 'success', raquel);
  connect(model, 'model', raquel, 'model', 'model');
  connect(memory, 'memory', raquel, 'memory', 'memory');
  connect(knowledge, 'knowledge', raquel, 'knowledge', 'knowledge');
  connect(guardrail, 'guardrail', raquel, 'guardrails', 'guardrail');
  connect(discordTool, 'tool', raquel, 'tools', 'tool');

  const raquelResponse = respond('velpro_raquel_response', 'Enviar resposta da Raquel', 3360, -360, '{{nodeResults.velpro_raquel_agent.output.response}}');
  const raquelEnd = end('velpro_raquel_end', 'Finalizar atendimento da Raquel', 3920, -360, 'raquel_completed');
  const raquelQuestion = add('interaction.input', 'velpro_raquel_question', 'Aguardar dado para Raquel', { x: 3360, y: -520 }, {
    prompt: '{{nodeResults.velpro_raquel_agent.output.question}}',
    outputKey: 'agentFollowup',
    validation: 'none',
    customRegex: '',
    timeoutMs: 86_400_000,
  });
  const raquelLoop = loop('velpro_raquel_loop', 'Continuar conversa da Raquel', 3640, -520, 12);
  const raquelHandoffMessage = respond(
    'velpro_raquel_handoff_message', 'Avisar continuidade comercial', 3360, -200,
    'Obrigado pelas informações. O setor comercial continuará seu atendimento por aqui.',
  );
  connect(raquel, 'completed', raquelResponse);
  connect(raquelResponse, 'success', raquelEnd);
  connect(raquel, 'needs_input', raquelQuestion);
  connect(raquelQuestion, 'resumed', raquelLoop);
  connect(raquelQuestion, 'expired', expiredMessage);
  connect(raquelLoop, 'iterate', raquel);
  connect(raquelLoop, 'done', retryExhausted);
  connect(raquelLoop, 'limit_reached', retryExhausted);
  connect(raquel, 'handoff', raquelHandoffMessage);
  connect(raquel, 'limit_reached', raquelHandoffMessage);
  connect(raquelHandoffMessage, 'success', raquelEnd);

  const supportAvailability = teamAvailability(
    'velpro_support_availability', 'Expediente do suporte', 1400, 280,
    bindings.teamIds.support, 'supportAvailability',
  );
  connect(mainMenu, 'support', supportAvailability);
  const supportOpenTag = tag('velpro_support_open_tag', 'Etiquetar suporte aberto', 1680, 180, bindings.tagIds.support);
  const supportClosedTag = tag('velpro_support_closed_tag', 'Etiquetar suporte fechado', 1680, 460, bindings.tagIds.support);
  connect(supportAvailability, 'open', supportOpenTag);
  connect(supportAvailability, 'closed', supportClosedTag);
  const supportClosedMessage = respond('velpro_support_closed_message', 'Informar horário do suporte', 1960, 460, repaired(supportClosedLegacy.text));
  const supportClosedEnd = end('velpro_support_closed_end', 'Finalizar suporte fechado', 2240, 460, 'support_closed');
  connect(supportClosedTag, 'success', supportClosedMessage);
  connect(supportClosedMessage, 'success', supportClosedEnd);
  const supportMenu = options('velpro_support_menu', 'Menu de suporte', 1960, 180, repaired(supportMenuLegacy.questionText), 'escolha_usuario_1', [
    { id: 'signal_problem', label: supportLabels[0]! },
    { id: 'billing', label: supportLabels[1]! },
    { id: 'unlock', label: supportLabels[2]! },
  ]);
  connect(supportOpenTag, 'success', supportMenu);
  const supportHandoffMessage = respond('velpro_support_handoff_message', 'Preparar transferência ao suporte', 2520, 100, repaired(supportHandoffLegacy.text));
  const supportHandoff = handoff(
    'velpro_support_handoff', 'Transferir para Suporte', 2800, 100,
    bindings.teamIds.support, 'Solicitação técnica identificada pelo Fluxo Velpro Final.',
  );
  const supportEnd = end('velpro_support_end', 'Finalizar transferência ao suporte', 3080, 100, 'support_handoff');
  connect(supportMenu, 'signal_problem', supportHandoffMessage);
  connect(supportHandoffMessage, 'success', supportHandoff);
  connect(supportHandoff, 'completed', supportEnd);

  const financeMenu = options('velpro_finance_menu', 'Menu financeiro', 2520, 700, repaired(financeMenuLegacy.questionText), 'escolha_usuario_2', [
    { id: 'second_copy', label: financeLabels[0]! },
    { id: 'negotiate', label: financeLabels[1]! },
    { id: 'report_payment', label: financeLabels[2]! },
    { id: 'other_finance', label: financeLabels[3]! },
    { id: 'payment_promise', label: financeLabels[4]! },
    { id: 'back', label: financeLabels[5]! },
  ]);
  connect(mainMenu, 'finance', financeMenu);
  connect(supportMenu, 'billing', financeMenu);
  connect(supportMenu, 'unlock', financeMenu);
  const backLoop = loop('velpro_back_to_main_loop', 'Voltar ao menu principal', 2800, 1040, 5);
  connect(financeMenu, 'back', backLoop);
  connect(backLoop, 'iterate', mainMenu);
  connect(backLoop, 'done', retryExhausted);
  connect(backLoop, 'limit_reached', retryExhausted);

  const financeAvailability = teamAvailability(
    'velpro_finance_availability', 'Expediente financeiro', 3080, 700,
    bindings.teamIds.finance, 'financeAvailability',
  );
  connect(financeMenu, 'negotiate', financeAvailability);
  connect(financeMenu, 'report_payment', financeAvailability);
  connect(financeMenu, 'other_finance', financeAvailability);
  const financeOpenTag = tag('velpro_finance_open_tag', 'Etiquetar financeiro aberto', 3360, 580, bindings.tagIds.finance);
  const financeClosedTag = tag('velpro_finance_closed_tag', 'Etiquetar financeiro fechado', 3360, 860, bindings.tagIds.finance);
  connect(financeAvailability, 'open', financeOpenTag);
  connect(financeAvailability, 'closed', financeClosedTag);
  const financeHandoffMessage = respond('velpro_finance_handoff_message', 'Preparar transferência financeira', 3640, 580, repaired(handoffLegacy.text));
  const financeHandoff = handoff(
    'velpro_finance_handoff', 'Transferir para Financeiro', 3920, 580,
    bindings.teamIds.finance, 'Solicitação financeira identificada pelo Fluxo Velpro Final.',
  );
  const financeHandoffEnd = end('velpro_finance_handoff_end', 'Finalizar transferência financeira', 4200, 580, 'finance_handoff');
  connect(financeOpenTag, 'success', financeHandoffMessage);
  connect(financeHandoffMessage, 'success', financeHandoff);
  connect(financeHandoff, 'completed', financeHandoffEnd);
  const financeClosedMessage = respond('velpro_finance_closed_message', 'Informar horário financeiro', 3640, 860, repaired(financeClosedLegacy.text));
  const financeClosedEnd = end('velpro_finance_closed_end', 'Finalizar financeiro fechado', 3920, 860, 'finance_closed');
  connect(financeClosedTag, 'success', financeClosedMessage);
  connect(financeClosedMessage, 'success', financeClosedEnd);

  const copyTag = tag('velpro_second_copy_tag', 'Etiquetar segunda via', 3080, 1160, bindings.tagIds.secondCopy);
  const copyCpf = add('interaction.input', 'velpro_second_copy_cpf', 'Pedir CPF para segunda via', { x: 3360, y: 1160 }, {
    prompt: 'Digite o CPF do titular',
    outputKey: 'cpf_segunda_via',
    validation: 'cpf',
    customRegex: '',
    timeoutMs: 86_400_000,
  });
  const secondCopy = add('dialogy.sgp_second_copy', 'velpro_sgp_second_copy', 'Segunda via nativa SGP', { x: 3640, y: 1160 }, {
    cpfCnpj: '{{cpf_segunda_via}}',
    deliveryMode: 'list',
    timeoutMs: 86_400_000,
    outputKey: 'sgpSecondCopy',
    permissionScope: 'sgp:read',
  });
  const copySuccess = respond('velpro_second_copy_success', 'Concluir segunda via', 3920, 1080, repaired(copySuccessLegacy.text));
  connect(financeMenu, 'second_copy', copyTag);
  connect(copyTag, 'success', copyCpf);
  connect(copyCpf, 'resumed', secondCopy);
  connect(copyCpf, 'expired', expiredMessage);
  connect(secondCopy, 'success', copySuccess);
  connect(copySuccess, 'success', closeNotice);

  const promiseTag = tag('velpro_payment_promise_tag', 'Etiquetar desbloqueio', 3080, 1480, bindings.tagIds.finance);
  const promiseCpf = add('interaction.input', 'velpro_payment_promise_cpf', 'Pedir CPF para desbloqueio', { x: 3360, y: 1480 }, {
    prompt: 'Digite o CPF do titular',
    outputKey: 'cpf_promessa',
    validation: 'cpf',
    customRegex: '',
    timeoutMs: 86_400_000,
  });
  const promiseDate = add('data.code', 'velpro_payment_promise_date', 'Calcular data da promessa', { x: 3640, y: 1480 }, {
    language: 'javascript',
    source: [
      "const today = new Date();",
      "const target = new Date(today.getTime() + (4 * 24 * 60 * 60 * 1000));",
      "const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(target);",
      "const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));",
      "return { value: `${values.year}-${values.month}-${values.day}` };",
    ].join('\n'),
    outputKey: 'promise_date',
  });
  const paymentPromise = add('dialogy.sgp_payment_promise', 'velpro_sgp_payment_promise', 'Promessa de pagamento nativa SGP', { x: 3920, y: 1480 }, {
    cpfCnpj: '{{cpf_promessa}}',
    deliveryMode: 'list',
    promiseDate: '{{promise_date.value}}',
    sendSms: true,
    timeoutMs: 86_400_000,
    outputKey: 'sgpPaymentPromise',
    permissionScope: 'sgp:write',
  });
  const promiseFailure = respond('velpro_payment_promise_failure', 'Falha no desbloqueio', 4480, 1560, repaired(failureLegacy.text));
  const promiseRetry = options('velpro_payment_promise_retry', 'Tentar desbloqueio novamente', 4760, 1560, repaired(retryPromiseLegacy.questionText), 'promessa_retry', [
    { id: 'try_again', label: promiseRetryLabels[0] || 'Tentar novamente' },
    { id: 'finish', label: promiseRetryLabels[1] || 'Encerrar Atendimento' },
  ]);
  const promiseLoop = loop('velpro_payment_promise_loop', 'Repetir desbloqueio', 5040, 1560, 3);
  connect(financeMenu, 'payment_promise', promiseTag);
  connect(promiseTag, 'success', promiseCpf);
  connect(promiseCpf, 'resumed', promiseDate);
  connect(promiseCpf, 'expired', expiredMessage);
  connect(promiseDate, 'success', paymentPromise);
  connect(paymentPromise, 'status-0', closeNotice);
  connect(paymentPromise, 'status-1', closeNotice);
  connect(paymentPromise, 'status-2', promiseFailure);
  connect(paymentPromise, 'limit-reached', financeAvailability);
  connect(promiseFailure, 'success', promiseRetry);
  connect(promiseRetry, 'try_again', promiseLoop);
  connect(promiseRetry, 'finish', closeNotice);
  connect(promiseLoop, 'iterate', promiseCpf);
  connect(promiseLoop, 'done', retryExhausted);
  connect(promiseLoop, 'limit_reached', retryExhausted);

  connect(trigger, 'message', bootstrap);
  connect(bootstrap, 'success', welcome);
  connect(welcome, 'success', mainMenu);

  const parsed = WorkflowDefinitionSchema.parse(workflow);
  const validation = validateWorkflowDefinition(parsed, { availableModelIds: [bindings.model.model] });
  if (!validation.valid) {
    throw new Error(`O perfil nativo Velpro é inválido: ${validation.errors.map((issue) => `${issue.code}: ${issue.message}`).join(' | ')}`);
  }
  const serialized = JSON.stringify(parsed);
  const forbiddenFragments = [
    'dialogy.fhgg2n.easypanel.host',
    'velpro.sgp.tsmx.com.br/api/ura',
    'pufferpanel.fhgg2n.easypanel.host',
    'memoryConnectionString',
    'memoryRedisConnectionString',
    'aiApiKey',
    'apiAuthBearerToken',
  ];
  const leaked = forbiddenFragments.find((fragment) => serialized.includes(fragment));
  if (leaked) throw new Error(`A definição Velpro reteve uma referência legada proibida: ${leaked}.`);

  return {
    workflow: parsed,
    validation,
    sourceHash,
    credentialReady: Boolean(bindings.discordCredentialId),
    prunedLegacyNodeIds: [...PRUNED_LEGACY_NODE_IDS],
  };
}
