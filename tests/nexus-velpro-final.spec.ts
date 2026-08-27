import { describe, expect, it } from 'vitest';

import { createNexusToolRegistry } from '@/modules/nexus/services/tool-registry';
import {
  buildVelproFinalWorkflow,
  VELPRO_DISCORD_CHANNEL_ID,
  VELPRO_FINAL_PROFILE,
  VELPRO_PENDING_DISCORD_CREDENTIAL_ID,
  type VelproFinalBindings,
} from '@/modules/nexus/services/velpro-final';
import {
  InMemoryWorkflowPersistence,
  ModelFallbackChain,
  WorkflowExecutor,
  createDefaultNodeHandlerRegistry,
  type GenerateRequest,
  type GenerateResult,
  type ModelAdapter,
  type ModelHealth,
  type ModelInfo,
  type ModelStreamEvent,
  type StructuredGenerateRequest,
} from '@/services/workflow-runtime';

const REQUIRED = {
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

const ORPHANS = [
  'a7a9d87a-b148-42e9-896e-6b96ad0399a0',
  'eb69168d-2b65-4a55-bbf8-0892e271ec83',
  '70580637-dcda-4e48-b85f-23380be38e45',
] as const;

function optionNode(id: string, count: number, prefix: string) {
  return {
    id,
    type: 'option',
    questionText: `Escolha uma opÃ§Ã£o de ${prefix}`,
    options: Array.from({ length: count }, (_, index) => ({ value: `${prefix} ${index + 1}` })),
  };
}

function legacyVelproFixture() {
  const nodes: Array<Record<string, unknown>> = [
    { id: REQUIRED.welcome, type: 'message', text: 'OlÃ¡, vocÃª chegou! ðŸš€' },
    optionNode(REQUIRED.mainMenu, 5, 'Principal'),
    optionNode(REQUIRED.referralMenu, 7, 'Origem'),
    { id: REQUIRED.commercialMessage, type: 'message', text: 'Vamos transferir ao Comercial.' },
    { id: REQUIRED.supportClosedMessage, type: 'message', text: 'O suporte estÃ¡ fechado.' },
    optionNode(REQUIRED.supportMenu, 3, 'Suporte'),
    { id: REQUIRED.supportHandoffMessage, type: 'message', text: 'Transferindo ao suporte.' },
    optionNode(REQUIRED.financeMenu, 6, 'Financeiro'),
    { id: REQUIRED.financeClosedMessage, type: 'message', text: 'O financeiro estÃ¡ fechado.' },
    { id: REQUIRED.handoffMessage, type: 'message', text: 'Transferindo seu atendimento.' },
    { id: REQUIRED.copySuccessMessage, type: 'message', text: 'Segunda via enviada.' },
    { id: REQUIRED.genericFailureMessage, type: 'message', text: 'NÃ£o foi possÃ­vel concluir.' },
    optionNode(REQUIRED.retryCopyMenu, 2, 'Segunda via'),
    optionNode(REQUIRED.retryPromiseMenu, 2, 'Desbloqueio'),
    { id: REQUIRED.closeMessage, type: 'message', text: 'Atendimento encerrado.' },
    {
      id: REQUIRED.agent,
      type: 'intelligent-agent',
      agentName: 'Raquel',
      agentSystemPrompt: 'Atenda em portuguÃªs. Consulte @lookup_knowledge e use (http-tool) ao concluir.',
    },
    {
      id: REQUIRED.discordTool,
      type: 'http-tool',
      httpToolDescription: 'INFORMACOES_CLIENTE NÃƒO Ã© JSON. Envie um resumo completo.',
      httpToolUrl: 'http://legacy.invalid/discord',
      httpToolAuthToken: 'legacy-secret',
    },
    ...ORPHANS.map((id) => ({ id, type: 'message', text: 'Bloco Ã³rfÃ£o' })),
  ];
  for (let index = nodes.length; index < 71; index += 1) {
    nodes.push({ id: `legacy-filler-${index}`, type: 'message', text: `Legado ${index}` });
  }
  const connections = Array.from({ length: 85 }, (_, index) => ({
    id: `legacy-connection-${index}`,
    from: String(nodes[index % nodes.length]!.id),
    to: String(nodes[(index + 1) % nodes.length]!.id),
  }));
  return { version: '1.0', name: 'Fluxo Velpro Final', nodes, connections };
}

const bindings: VelproFinalBindings = {
  workspaceId: 'workspace-velpro',
  workflowId: 'workflow-velpro',
  raquelConfigId: 'raquel-config',
  senderSystemAgentId: 'sender-velpro',
  model: {
    provider: 'google',
    model: 'googleai/gemini-3.1-flash-lite',
    temperature: 0.21,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    timeoutMs: 60_000,
    maxRetries: 2,
  },
  instanceNames: ['zap1'],
  teamIds: { commercial: 'team-commercial', finance: 'team-finance', support: 'team-support' },
  tagIds: {
    commercial: 'tag-commercial',
    finance: 'tag-finance',
    support: 'tag-support',
    secondCopy: 'tag-second-copy',
    closeReason: 'tag-system',
  },
  knowledgeDocumentIds: ['doc-1', 'doc-2', 'doc-3', 'doc-4'],
};

class VelproSequenceModelAdapter implements ModelAdapter {
  private index = 0;

  constructor(private readonly decisions: unknown[]) {}

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: bindings.model.model }];
  }

  async healthCheck(): Promise<ModelHealth> {
    return { ok: true, latencyMs: 0, models: [bindings.model.model] };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    return { model: request.model, text: '', toolRequests: [] };
  }

  async generateStructured<T>(request: StructuredGenerateRequest<T>): Promise<T> {
    const decision = this.decisions[this.index] ?? this.decisions.at(-1);
    this.index += 1;
    return request.schema.parse(decision);
  }

  async *stream(request: GenerateRequest): AsyncIterable<ModelStreamEvent> {
    yield { type: 'started', model: request.model };
    yield { type: 'completed', model: request.model };
  }

  async supportsTools(): Promise<boolean> {
    return true;
  }

  async supportsStructuredOutput(): Promise<boolean> {
    return true;
  }
}

describe('Fluxo Velpro Final nativo', () => {
  it('reconstrói toda a jornada em blocos Dialogy validados e sem segredos legados', () => {
    const result = buildVelproFinalWorkflow({
      rawLegacyFlow: legacyVelproFixture(),
      bindings,
      now: new Date('2026-08-25T12:00:00.000Z'),
    });
    const { workflow } = result;
    const node = (id: string) => workflow.nodes.find((candidate) => candidate.id === id);

    expect(result.validation).toEqual({ valid: true, errors: [], warnings: [] });
    expect(workflow.nodes).toHaveLength(59);
    expect(workflow.connections).toHaveLength(86);
    expect(workflow.metadata).toMatchObject({
      profile: VELPRO_FINAL_PROFILE,
      source: 'nexusflow_legacy_import',
      aiRuntime: 'dialogy_native',
      senderSystemAgentId: 'sender-velpro',
      credentialReady: false,
      legacyNodeCount: 71,
      legacyConnectionCount: 85,
      prunedLegacyNodeIds: [...ORPHANS],
    });
    expect(node('velpro_trigger')?.config).toMatchObject({
      platforms: ['whatsapp'],
      instanceNames: ['zap1'],
      messageTypes: ['text'],
      startPolicy: 'unassigned_only',
    });
    expect(node('velpro_welcome')?.config.message).toBe('Olá, você chegou! 🚀');
    expect(node('velpro_commercial_availability')).toMatchObject({ type: 'dialogy.team_availability' });
    expect(node('velpro_commercial_open_tag')).toMatchObject({ type: 'dialogy.chat_tag' });
    expect(node('velpro_commercial_handoff')).toMatchObject({ type: 'output.handoff', config: { teamId: 'team-commercial' } });
    expect(node('velpro_sgp_second_copy')).toMatchObject({ type: 'dialogy.sgp_second_copy' });
    expect(node('velpro_sgp_payment_promise')).toMatchObject({ type: 'dialogy.sgp_payment_promise' });
    expect(node('velpro_sgp_payment_promise')?.outputPorts).toContainEqual(
      expect.objectContaining({ id: 'limit-reached', label: 'Limite atingido' }),
    );
    expect(workflow.connections).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'velpro_sgp_payment_promise',
        sourcePortId: 'limit-reached',
        targetNodeId: 'velpro_finance_availability',
      }),
    );
    expect(node('velpro_close_chat')).toMatchObject({ type: 'output.close_conversation', config: { reasonTagId: 'tag-system' } });
    expect(node('velpro_raquel_memory')).toMatchObject({ type: 'memory.session', config: { provider: 'dialogy', scope: 'hybrid' } });
    expect(node('velpro_raquel_knowledge')).toMatchObject({
      type: 'knowledge.rag_retriever',
      config: { documentIds: ['doc-1', 'doc-2', 'doc-3', 'doc-4'], strategy: 'hybrid' },
    });
    expect(node('velpro_raquel_agent')?.config.persona).toContain('base de conhecimento nativa conectada');
    expect(node('velpro_raquel_agent')?.config.persona).not.toContain('@lookup_knowledge');
    expect(node('velpro_discord_tool')).toMatchObject({
      type: 'tool.http',
      config: {
        method: 'POST',
        url: `https://discord.com/api/v10/channels/${VELPRO_DISCORD_CHANNEL_ID}/messages`,
        body: { content: '{{arguments.INFORMACOES_CLIENTE}}' },
        credentialId: VELPRO_PENDING_DISCORD_CREDENTIAL_ID,
        credentialRequired: true,
      },
    });
    expect(workflow.nodes.filter((candidate) => candidate.type === 'logic.loop')).toHaveLength(3);
    expect(workflow.nodes.filter((candidate) => candidate.name.startsWith('Repetir menu'))).toHaveLength(0);
    expect(workflow.nodes.filter((candidate) => candidate.type === 'error.handler')).toHaveLength(0);
    expect(workflow.connections.filter((candidate) => candidate.connectionType === 'error')).toHaveLength(0);
    expect(
      workflow.nodes
        .filter((candidate) => candidate.type === 'interaction.options')
        .every((candidate) => candidate.config.customFallbackRoutes === false),
    ).toBe(true);
    expect(
      workflow.connections.some((connection) => {
        const source = workflow.nodes.find((candidate) => candidate.id === connection.sourceNodeId);
        return source?.type === 'interaction.options' && ['default', 'expired'].includes(connection.sourcePortId);
      }),
    ).toBe(false);
    expect(workflow.nodes.some((candidate) => ORPHANS.includes(candidate.id as typeof ORPHANS[number]))).toBe(false);
    expect(JSON.stringify(workflow)).not.toContain('legacy.invalid');
    expect(JSON.stringify(workflow)).not.toContain('legacy-secret');
  });

  it('marca a definição como pronta quando a credencial do Discord é vinculada', () => {
    const result = buildVelproFinalWorkflow({
      rawLegacyFlow: legacyVelproFixture(),
      bindings: { ...bindings, discordCredentialId: 'discord-credential' },
    });
    expect(result.credentialReady).toBe(true);
    expect(result.workflow.metadata?.credentialReady).toBe(true);
    expect(result.workflow.nodes.find((node) => node.id === 'velpro_discord_tool')?.config.credentialId).toBe('discord-credential');
  });

  it('executa a jornada determinística de suporte até a transferência nativa', async () => {
    const { workflow } = buildVelproFinalWorkflow({ rawLegacyFlow: legacyVelproFixture(), bindings });
    const deliveries: string[] = [];
    const handoffs: string[] = [];
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry({
        sendResponse: async (message) => {
          deliveries.push(message);
          return { success: true };
        },
        executePlatformAction: async (runtimeInput) => ({
          status: 'route',
          selectedOutput: runtimeInput.node.type === 'dialogy.team_availability' ? 'open' : 'success',
          output: { simulated: true },
        }),
        handoff: async (runtimeInput) => {
          handoffs.push(String(runtimeInput.node.config.teamId || ''));
          return { success: true, transferred: true };
        },
      }),
    );

    const mainMenu = await executor.start({
      workflow,
      input: { message: 'Olá' },
      context: { contactName: 'Cliente', contactPhone: '5511999999999' },
      conversationId: 'chat-1',
    });
    expect(mainMenu.status).toBe('waiting');
    expect(mainMenu.currentNodeId).toBe('velpro_main_menu');

    const supportMenu = await executor.resume({ resumeToken: mainMenu.resumeToken!, input: { value: '3' } });
    expect(supportMenu.status).toBe('waiting');
    expect(supportMenu.currentNodeId).toBe('velpro_support_menu');

    const completed = await executor.resume({ resumeToken: supportMenu.resumeToken!, input: { value: '1' } });
    expect(completed.status).toBe('completed');
    expect(completed.executionPath.map((step) => step.nodeId)).toContain('velpro_support_end');
    expect(handoffs).toEqual(['team-support']);
    expect(deliveries.length).toBeGreaterThanOrEqual(4);
  });

  it('executa contratação e transferência de endereço pela equipe comercial', async () => {
    const { workflow } = buildVelproFinalWorkflow({ rawLegacyFlow: legacyVelproFixture(), bindings });
    const handoffs: string[] = [];
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry({
        sendResponse: async () => ({ success: true }),
        executePlatformAction: async (runtimeInput) => ({
          status: 'route',
          selectedOutput: runtimeInput.node.type === 'dialogy.team_availability' ? 'open' : 'success',
          output: { simulated: true },
        }),
        handoff: async (runtimeInput) => {
          handoffs.push(String(runtimeInput.node.config.teamId || ''));
          return { success: true, transferred: true };
        },
      }),
    );

    const subscribeMenu = await executor.start({ workflow, input: { message: 'Quero assinar' }, conversationId: 'chat-commercial-1' });
    const referralMenu = await executor.resume({ resumeToken: subscribeMenu.resumeToken!, input: { value: '1' } });
    const subscribed = await executor.resume({ resumeToken: referralMenu.resumeToken!, input: { value: '1' } });
    expect(subscribed.status).toBe('completed');
    expect(subscribed.executionPath.map((step) => step.nodeId)).toContain('velpro_commercial_end');

    const addressMenu = await executor.start({ workflow, input: { message: 'Mudar endereço' }, conversationId: 'chat-commercial-2' });
    const transferred = await executor.resume({ resumeToken: addressMenu.resumeToken!, input: { value: '2' } });
    expect(transferred.status).toBe('completed');
    expect(transferred.executionPath.map((step) => step.nodeId)).toContain('velpro_commercial_end');
    expect(handoffs).toEqual(['team-commercial', 'team-commercial']);
  });

  it('executa a Raquel com memória híbrida, conhecimento e envio Discord interceptado', async () => {
    const { workflow } = buildVelproFinalWorkflow({
      rawLegacyFlow: legacyVelproFixture(),
      bindings: { ...bindings, discordCredentialId: 'discord-credential' },
    });
    const deliveries: string[] = [];
    const httpCalls: Array<Record<string, unknown>> = [];
    const guardrailPhases: string[] = [];
    let memoryLoads = 0;
    let knowledgeRetrievals = 0;
    const model = new VelproSequenceModelAdapter([
      {
        type: 'tool_call',
        toolName: 'enviar_atendimento_discord',
        arguments: { INFORMACOES_CLIENTE: 'Lead de teste isolado, sem dados reais.' },
        purposeSummary: 'Registrar o lead comercial confirmado.',
      },
      {
        type: 'final',
        response: 'Cadastro de teste confirmado com segurança.',
        completionStatus: 'completed',
      },
    ]);
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry({
        resolveModelChain: async () => new ModelFallbackChain([{ adapter: model, config: bindings.model }]),
        resolveToolRegistry: async (context) => createNexusToolRegistry({
          workspaceId: bindings.workspaceId,
          toolNodes: context.toolNodes,
          executeHttpOperation: async (input) => {
            httpCalls.push(input as unknown as Record<string, unknown>);
            return { status: 200, data: { id: 'intercepted-message' }, selected: { accepted: true } };
          },
        }),
        loadMemory: async () => {
          memoryLoads += 1;
          return { source: 'dialogy', scope: 'hybrid', entries: [] };
        },
        retrieveKnowledge: async () => {
          knowledgeRetrievals += 1;
          return [{ id: 'doc-1', content: 'Plano de teste confirmado.' }];
        },
        applyGuardrails: async (phase, value) => {
          guardrailPhases.push(phase);
          return value;
        },
        executePlatformAction: async (runtimeInput) => ({
          status: 'route',
          selectedOutput: runtimeInput.node.type === 'dialogy.team_availability' ? 'closed' : 'success',
          output: { simulated: true },
        }),
        sendResponse: async (message) => {
          deliveries.push(message);
          return { success: true };
        },
      }),
    );

    const mainMenu = await executor.start({
      workflow,
      input: { message: 'Quero contratar' },
      context: { contactName: 'Cliente de teste', contactPhone: '5500000000000' },
      conversationId: 'chat-raquel-e2e',
    });
    const referralMenu = await executor.resume({ resumeToken: mainMenu.resumeToken!, input: { value: '1' } });
    const completed = await executor.resume({ resumeToken: referralMenu.resumeToken!, input: { value: '1' } });

    expect(completed.status).toBe('completed');
    expect(completed.executionPath.map((step) => step.nodeId)).toContain('velpro_raquel_agent');
    expect(completed.executionPath.map((step) => step.nodeId)).toContain('velpro_raquel_end');
    expect(memoryLoads).toBe(1);
    expect(knowledgeRetrievals).toBe(1);
    expect(guardrailPhases).toEqual(['input', 'output']);
    expect(httpCalls).toHaveLength(1);
    expect(httpCalls[0]).toMatchObject({
      workspaceId: 'workspace-velpro',
      config: {
        method: 'POST',
        url: `https://discord.com/api/v10/channels/${VELPRO_DISCORD_CHANNEL_ID}/messages`,
        credentialId: 'discord-credential',
        credentialRequired: true,
        body: { content: '{{arguments.INFORMACOES_CLIENTE}}' },
      },
      runtimeSource: {
        arguments: { INFORMACOES_CLIENTE: 'Lead de teste isolado, sem dados reais.' },
      },
    });
    expect(deliveries.at(-1)).toBe('Cadastro de teste confirmado com segurança.');
  });

  it('executa financeiro aberto e financeiro fechado pelas rotas corretas', async () => {
    const { workflow } = buildVelproFinalWorkflow({ rawLegacyFlow: legacyVelproFixture(), bindings });
    let financeAvailability: 'open' | 'closed' = 'open';
    const handoffs: string[] = [];
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry({
        sendResponse: async () => ({ success: true }),
        executePlatformAction: async (runtimeInput) => ({
          status: 'route',
          selectedOutput: runtimeInput.node.type === 'dialogy.team_availability' ? financeAvailability : 'success',
          output: { simulated: true },
        }),
        handoff: async (runtimeInput) => {
          handoffs.push(String(runtimeInput.node.config.teamId || ''));
          return { success: true, transferred: true };
        },
      }),
    );

    const openMain = await executor.start({ workflow, input: { message: 'Financeiro' }, conversationId: 'chat-finance-open' });
    const openMenu = await executor.resume({ resumeToken: openMain.resumeToken!, input: { value: '4' } });
    const openCompleted = await executor.resume({ resumeToken: openMenu.resumeToken!, input: { value: '2' } });
    expect(openCompleted.status).toBe('completed');
    expect(openCompleted.executionPath.map((step) => step.nodeId)).toContain('velpro_finance_handoff_end');
    expect(handoffs).toEqual(['team-finance']);

    financeAvailability = 'closed';
    const closedMain = await executor.start({ workflow, input: { message: 'Financeiro' }, conversationId: 'chat-finance-closed' });
    const closedMenu = await executor.resume({ resumeToken: closedMain.resumeToken!, input: { value: '4' } });
    const closedCompleted = await executor.resume({ resumeToken: closedMenu.resumeToken!, input: { value: '3' } });
    expect(closedCompleted.status).toBe('completed');
    expect(closedCompleted.executionPath.map((step) => step.nodeId)).toContain('velpro_finance_closed_end');
    expect(handoffs).toEqual(['team-finance']);
  });

  it('emite segunda via nativa, repete CPF inválido e encerra o atendimento', async () => {
    const { workflow } = buildVelproFinalWorkflow({ rawLegacyFlow: legacyVelproFixture(), bindings });
    const platformNodes: string[] = [];
    let closeCount = 0;
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry({
        sendResponse: async () => ({ success: true }),
        executePlatformAction: async (runtimeInput) => {
          platformNodes.push(runtimeInput.node.id);
          return { status: 'route', selectedOutput: 'success', output: { simulated: true } };
        },
        closeConversation: async () => {
          closeCount += 1;
          return { success: true, closed: true };
        },
      }),
    );

    const mainMenu = await executor.start({ workflow, input: { message: 'Segunda via' }, conversationId: 'chat-copy' });
    const financeMenu = await executor.resume({ resumeToken: mainMenu.resumeToken!, input: { value: '4' } });
    const cpfPrompt = await executor.resume({ resumeToken: financeMenu.resumeToken!, input: { value: '1' } });
    expect(cpfPrompt.currentNodeId).toBe('velpro_second_copy_cpf');

    const retried = await executor.resume({ resumeToken: cpfPrompt.resumeToken!, input: { value: '123' } });
    expect(retried.status).toBe('waiting');
    expect(retried.currentNodeId).toBe('velpro_second_copy_cpf');

    const completed = await executor.resume({ resumeToken: retried.resumeToken!, input: { value: '52998224725' } });
    expect(completed.status).toBe('completed');
    expect(completed.variables.cpf_segunda_via).toBe('52998224725');
    expect(completed.executionPath.map((step) => step.nodeId)).toContain('velpro_sgp_second_copy');
    expect(platformNodes).toContain('velpro_sgp_second_copy');
    expect(closeCount).toBe(1);
  });

  it('executa o desbloqueio nativo e calcula a data da promessa antes de encerrar', async () => {
    const { workflow } = buildVelproFinalWorkflow({ rawLegacyFlow: legacyVelproFixture(), bindings });
    let closeCount = 0;
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry({
        sendResponse: async () => ({ success: true }),
        executePlatformAction: async (runtimeInput) => {
          if (runtimeInput.node.id === 'velpro_sgp_payment_promise') {
            return { status: 'route', selectedOutput: 'status-1', output: { simulated: true } };
          }
          return { status: 'route', selectedOutput: 'success', output: { simulated: true } };
        },
        closeConversation: async () => {
          closeCount += 1;
          return { success: true, closed: true };
        },
      }),
    );

    const mainMenu = await executor.start({ workflow, input: { message: 'Desbloquear' }, conversationId: 'chat-unlock' });
    const financeMenu = await executor.resume({ resumeToken: mainMenu.resumeToken!, input: { value: '4' } });
    const cpfPrompt = await executor.resume({ resumeToken: financeMenu.resumeToken!, input: { value: '5' } });
    const completed = await executor.resume({ resumeToken: cpfPrompt.resumeToken!, input: { value: '52998224725' } });

    expect(completed.status).toBe('completed');
    expect(completed.variables.cpf_promessa).toBe('52998224725');
    expect(completed.executionPath.map((step) => step.nodeId)).toContain('velpro_payment_promise_date');
    expect(completed.executionPath.map((step) => step.nodeId)).toContain('velpro_sgp_payment_promise');
    expect(completed.variables.promise_date).toMatchObject({ value: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(closeCount).toBe(1);
  });

  it('executa a escolha de encerramento pela rota nativa de fechamento', async () => {
    const { workflow } = buildVelproFinalWorkflow({ rawLegacyFlow: legacyVelproFixture(), bindings });
    let closeCount = 0;
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry({
        sendResponse: async () => ({ success: true }),
        closeConversation: async () => {
          closeCount += 1;
          return { success: true, closed: true };
        },
      }),
    );
    const mainMenu = await executor.start({ workflow, input: { message: 'Olá' }, conversationId: 'chat-2' });
    const completed = await executor.resume({ resumeToken: mainMenu.resumeToken!, input: { value: '5' } });

    expect(completed.status).toBe('completed');
    expect(closeCount).toBe(1);
    expect(completed.executionPath.map((step) => step.nodeId)).toContain('velpro_close_end');
  });

  it('avisa uma opção inválida e apresenta o mesmo menu novamente sem blocos auxiliares', async () => {
    const { workflow } = buildVelproFinalWorkflow({ rawLegacyFlow: legacyVelproFixture(), bindings });
    const deliveries: string[] = [];
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry({
        sendResponse: async (message) => {
          deliveries.push(message);
          return { success: true };
        },
      }),
    );

    const waiting = await executor.start({ workflow, input: { message: 'Olá' }, conversationId: 'chat-invalid-option' });
    const repeated = await executor.resume({ resumeToken: waiting.resumeToken!, input: { value: 'não existe' } });

    expect(repeated.status).toBe('waiting');
    expect(repeated.currentNodeId).toBe('velpro_main_menu');
    expect(repeated.executionPath.map((step) => step.nodeId)).not.toContain('velpro_main_retry');
    expect(deliveries.at(-1)).toContain('Opção inválida. Escolha uma das opções abaixo.');
    expect(deliveries.at(-1)).toContain('Escolha uma opção de Principal');
  });
});
