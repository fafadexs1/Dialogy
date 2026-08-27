import { describe, expect, it, vi } from 'vitest';

import type { KnowledgeBaseDocument } from '@/lib/types';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import type { AgentToolExecutionResult } from '@/services/agent-tools/types';
import { compileProcedureFromDocument } from '@/services/autopilot/procedure-compiler';
import { advanceProcedure } from '@/services/autopilot/procedure-executor';
import { matchProcedure } from '@/services/autopilot/procedure-matcher';
import type { ProcedureExecutionContext, ProcedureGraph } from '@/services/autopilot/procedure-types';

vi.mock('@/services/autopilot/procedure-store', () => ({
  saveProcedureExecution: vi.fn(async () => undefined),
}));

function tool(name: AgentToolCatalogItem['name']): AgentToolCatalogItem {
  return {
    name,
    version: 'builtin',
    description: 'Ferramenta de teste',
    class: 'retrieval',
    riskLevel: 'low',
    sideEffect: 'none',
    idempotent: true,
    timeoutMs: 8000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: false,
    allowedIntents: ['billing_or_payment', 'troubleshooting', 'support_request'],
    requiredSlots: [],
    fallbackAction: 'handoff',
    source: 'dialogy',
    enabledByDefault: true,
  };
}

function closeTool(): AgentToolCatalogItem {
  return {
    ...tool('close_chat'),
    allowedIntents: ['unknown', 'support_request'],
  };
}

function mcpTool(name: string, description: string): AgentToolCatalogItem {
  return {
    ...tool(name as AgentToolCatalogItem['name']),
    name: name as AgentToolCatalogItem['name'],
    version: 'mcp',
    description,
    source: 'mcp',
    enabledByDefault: false,
    serverId: 'router',
    serverName: 'Router MCP',
    inputSchema: { type: 'object', properties: {} },
  };
}

function contextFor(graph: ProcedureGraph): ProcedureExecutionContext {
  return {
    id: 'exec-1',
    chatId: 'chat-1',
    workspaceId: 'workspace-1',
    systemAgentId: 'agent-1',
    procedureId: graph.id,
    procedureName: graph.documentName,
    currentStepId: graph.steps[0].id,
    status: 'running',
    collectedSlots: {},
    toolResults: {},
    decisions: {},
    retryCount: {},
    startedAt: new Date('2026-05-12T12:00:00Z').toISOString(),
    updatedAt: new Date('2026-05-12T12:00:00Z').toISOString(),
    stepHistory: [],
  };
}

describe('procedure runtime engine', () => {
  it('compiles KB tool procedures and matches them by intent', () => {
    const document: KnowledgeBaseDocument = {
      id: 'kb-procedure-1',
      name: 'Segunda via de boleto',
      content: [
        'Quando o cliente pedir segunda via de boleto, colete CPF/CNPJ.',
        'Consulte @sgp_fetch_contact_panel_data.',
        'Depois informe ao cliente o resultado da fatura.',
      ].join(' '),
    };

    const result = compileProcedureFromDocument({
      document,
      tools: [tool('sgp_fetch_contact_panel_data')],
      enabledToolNames: ['sgp_fetch_contact_panel_data'],
    });

    expect(result.success).toBe(true);
    expect(result.graph).toBeTruthy();
    expect(result.graph?.steps[0]).toMatchObject({
      type: 'gather_data',
      requiredSlots: ['customer_identifier'],
    });
    expect(result.graph?.steps.some((step) => step.type === 'tool_call' && step.toolName === 'sgp_fetch_contact_panel_data')).toBe(true);

    const match = matchProcedure({
      intent: 'billing_or_payment',
      customerMessage: 'Preciso da segunda via do boleto',
      compiledProcedures: [result.graph!],
    });

    expect(match?.graph.id).toBe(result.graph?.id);
  });

  it('prefers Wi-Fi credential lookup over close procedures when the customer asks for username and password', () => {
    const closeGraph: ProcedureGraph = {
      id: 'proc-close',
      documentId: 'doc-close',
      documentName: 'Encerramento de atendimento tecnico',
      version: 1,
      compiledAt: new Date('2026-06-20T02:55:00Z').toISOString(),
      triggerIntents: ['troubleshooting'],
      triggerKeywords: ['reboot'],
      metadata: {},
      steps: [
        {
          id: 'close',
          order: 1,
          type: 'tool_call',
          label: 'Se usar @close_chat, inclua notes objetivas.',
          toolName: 'close_chat',
          nextStepId: null,
        },
      ],
    };
    const wifiGraph: ProcedureGraph = {
      id: 'proc-wifi',
      documentId: 'doc-wifi',
      documentName: 'Roteador e Wi-Fi - consulta, reboot e troca de senha',
      version: 1,
      compiledAt: new Date('2026-06-20T02:55:00Z').toISOString(),
      triggerIntents: ['troubleshooting'],
      triggerKeywords: ['reiniciar', 'status'],
      metadata: {},
      steps: [
        {
          id: 'wifi',
          order: 1,
          type: 'tool_call',
          label: 'Quando o cliente pedir usuario, senha, SSID ou nome da rede, use get_wifi_view.',
          toolName: 'mcp:router:get_wifi_view',
          semanticIntent: 'wifi_credentials_lookup',
          nextStepId: null,
        },
      ],
    };

    const match = matchProcedure({
      intent: 'troubleshooting',
      customerMessage: 'Eu quero o usuario e senha do meu Wi-Fi',
      compiledProcedures: [closeGraph, wifiGraph],
    });

    expect(match?.graph.id).toBe('proc-wifi');
    expect(match?.matchReason).toContain('supports wifi_credentials_lookup');
  });

  it('waits for a tool result, resumes the same step, validates, and responds with AI resolver', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-runtime',
      documentId: 'doc-runtime',
      documentName: 'Consultar contrato antes de responder',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['billing_or_payment'],
      triggerKeywords: ['boleto'],
      metadata: {},
      steps: [
        {
          id: 'gather',
          order: 1,
          type: 'gather_data',
          label: 'Coletar CPF/CNPJ',
          requiredSlots: ['customer_identifier'],
          promptTemplate: 'Me informe o CPF/CNPJ.',
          nextStepId: 'tool',
        },
        {
          id: 'tool',
          order: 2,
          type: 'tool_call',
          label: 'Consultar contratos',
          toolName: 'sgp_fetch_contracts',
          toolPayloadTemplate: {},
          nextStepId: 'validate',
        },
        {
          id: 'validate',
          order: 3,
          type: 'validate',
          label: 'Validar consulta',
          condition: 'consulta SGP sucesso para customer_identifier',
          onFail: 'handoff',
          nextStepId: 'respond',
        },
        {
          id: 'respond',
          order: 4,
          type: 'respond',
          label: 'Responder cliente',
          responseTemplate: 'Contrato localizado para {{customer_identifier}}.',
          useLlm: true,
          nextStepId: null,
        },
      ],
    };
    const context = contextFor(graph);

    const first = await advanceProcedure({
      graph,
      context,
      customerMessage: 'quero segunda via',
    });

    expect(first.status).toBe('waiting_input');
    expect(first.response).toBe('Me informe o CPF/CNPJ.');
    expect(context.currentStepId).toBe('gather');

    const second = await advanceProcedure({
      graph,
      context,
      customerMessage: '529.982.247-25',
    });

    expect(second.status).toBe('waiting_tool');
    expect(second.actions).toHaveLength(1);
    expect(second.actions[0].type).toBe('sgp_fetch_contracts');
    expect(context.currentStepId).toBe('tool');
    expect(context.collectedSlots.customer_identifier).toBe('52998224725');

    const toolResults: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contracts',
        status: 'success',
        input: {
          type: 'sgp_fetch_contracts',
          payload: {},
        },
        output: {
          contracts: [{ id: 'contract-1', status: 'active' }],
        },
      },
    ];

    const third = await advanceProcedure({
      graph,
      context,
      customerMessage: '529.982.247-25',
      toolResults,
      responseResolver: async ({ context: runtimeContext, toolResults: runtimeToolResults }) => (
        `AI: contrato ${runtimeToolResults[0].status} para ${runtimeContext.collectedSlots.customer_identifier}`
      ),
    });

    expect(third.status).toBe('completed');
    expect(third.actions).toHaveLength(0);
    expect(third.response).toBe('AI: contrato success para 52998224725');
    expect(context.toolResults.tool).toEqual(toolResults);
  });

  it('uses decision resolver output to choose the correct branch instead of the first branch', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-decision',
      documentId: 'doc-decision',
      documentName: 'Decidir atendimento',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['support_request'],
      triggerKeywords: ['atendimento'],
      metadata: {},
      steps: [
        {
          id: 'decide',
          order: 1,
          type: 'decide',
          label: 'Decidir rota',
          decisionPrompt: 'Classifique a necessidade do cliente.',
          branches: [
            { condition: 'sem sinal', nextStepId: 'support' },
            { condition: 'financeiro', nextStepId: 'billing' },
          ],
          nextStepId: null,
        },
        {
          id: 'support',
          order: 2,
          type: 'respond',
          label: 'Suporte',
          responseTemplate: 'Vamos verificar seu sinal.',
          nextStepId: null,
        },
        {
          id: 'billing',
          order: 3,
          type: 'respond',
          label: 'Financeiro',
          responseTemplate: 'Vou seguir pelo financeiro.',
          nextStepId: null,
        },
      ],
    };
    const context = contextFor(graph);

    const result = await advanceProcedure({
      graph,
      context,
      customerMessage: 'quero tratar uma pendencia financeira',
      decisionResolver: async () => 'financeiro',
    });

    expect(result.status).toBe('completed');
    expect(result.response).toBe('Vou seguir pelo financeiro.');
    expect(context.decisions.decide).toBe('financeiro');
    expect(result.executedSteps).toEqual(['decide', 'billing']);
  });

  it('does not match unknown close procedures just because the customer intent is unknown', () => {
    const document: KnowledgeBaseDocument = {
      id: 'kb-close-procedure',
      name: 'Encerrar atendimento',
      content: 'Quando o cliente pedir para encerrar o atendimento, utilize a ferramenta @close_chat.',
    };

    const result = compileProcedureFromDocument({
      document,
      tools: [closeTool()],
      enabledToolNames: ['close_chat'],
    });

    expect(result.success).toBe(true);

    const match = matchProcedure({
      intent: 'unknown',
      customerMessage: 'Nao entendi kkk',
      compiledProcedures: [result.graph!],
    });

    expect(match).toBeNull();
  });

  it('does not let a generic visual agent topology hijack an explicit tool request', () => {
    const graph: ProcedureGraph = {
      id: 'flow-canary',
      documentId: 'flow:canary',
      documentName: 'Fluxo visual: Autopilot Conversation Canary',
      version: 1,
      compiledAt: new Date('2026-06-27T19:30:00Z').toISOString(),
      triggerIntents: ['unknown'],
      triggerKeywords: [
        'Agente Canary',
        'Atendimento principal',
        'Consultar pedido',
        'Consulta o status de um pedido sem altera-lo.',
      ],
      metadata: { source: 'visual_flow' },
      steps: [
        {
          id: 'agent',
          order: 1,
          type: 'respond',
          label: 'Agente Canary',
          useLlm: true,
          nextStepId: 'status',
        },
        {
          id: 'status',
          order: 2,
          type: 'tool_call',
          label: 'Consultar pedido',
          toolName: 'mcp:canary:get_order_status',
          nextStepId: null,
        },
      ],
    };

    const match = matchProcedure({
      intent: 'order_or_request_status',
      customerMessage: 'Qual o status do pedido RACE-9001?',
      compiledProcedures: [graph],
    });

    expect(match).toBeNull();
  });

  it('ignores empty title tokens left by trailing punctuation', () => {
    const graph: ProcedureGraph = {
      id: 'unrelated',
      documentId: 'doc-unrelated',
      documentName: 'Fluxo visual completamente alheio',
      version: 1,
      compiledAt: new Date('2026-06-27T19:30:00Z').toISOString(),
      triggerIntents: ['unknown'],
      triggerKeywords: [],
      metadata: {},
      steps: [],
    };

    expect(matchProcedure({
      intent: 'order_or_request_status',
      customerMessage: 'Qual o status do pedido RACE-9001?',
      compiledProcedures: [graph],
    })).toBeNull();
  });

  it('does not select a financial procedure for a connection complaint without financial evidence', () => {
    const graph: ProcedureGraph = {
      id: 'proc-financial-support',
      documentId: 'doc-financial-support',
      documentName: 'Financeiro dentro do suporte tecnico',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['troubleshooting', 'billing_or_payment'],
      triggerKeywords: ['problema', 'pagamento'],
      metadata: {},
      steps: [
        {
          id: 'tool',
          order: 1,
          type: 'tool_call',
          label: 'Consultar cadastro',
          toolName: 'sgp_fetch_contact_panel_data',
          nextStepId: null,
        },
      ],
    };

    const match = matchProcedure({
      intent: 'troubleshooting',
      customerMessage: 'minha internet esta caindo toda hora',
      compiledProcedures: [graph],
    });

    expect(match).toBeNull();
  });

  it('does not select a handoff procedure unless the customer asks for human support', () => {
    const graph: ProcedureGraph = {
      id: 'proc-handoff',
      documentId: 'doc-handoff',
      documentName: 'Transferencia para suporte humano e notas internas',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['troubleshooting', 'human_handoff'],
      triggerKeywords: ['suporte'],
      metadata: {},
      steps: [],
    };

    const match = matchProcedure({
      intent: 'troubleshooting',
      customerMessage: 'minha internet esta caindo toda hora',
      compiledProcedures: [graph],
    });

    expect(match).toBeNull();
  });

  it('does not select an optical LOS procedure for generic fiber instability', () => {
    const graph: ProcedureGraph = {
      id: 'proc-optical-los',
      documentId: 'doc-optical-los',
      documentName: 'Fibra optica - LOS LOSS luz vermelha',
      version: 1,
      compiledAt: new Date('2026-07-02T00:00:00Z').toISOString(),
      triggerIntents: ['troubleshooting'],
      triggerKeywords: ['problema', 'sem sinal'],
      metadata: {},
      steps: [
        {
          id: 'ask',
          order: 1,
          type: 'gather_data',
          label: 'Pergunte sobre a luz LOS.',
          promptTemplate: 'A luz LOS esta vermelha?',
          requiredSlots: [],
          nextStepId: null,
        },
      ],
    };

    expect(matchProcedure({
      intent: 'troubleshooting',
      customerMessage: 'A internet da minha fibra esta falhando toda hora',
      compiledProcedures: [graph],
    })).toBeNull();

    expect(matchProcedure({
      intent: 'troubleshooting',
      customerMessage: 'A luz LOS da ONU esta vermelha',
      compiledProcedures: [graph],
    })?.graph.id).toBe(graph.id);
  });

  it('pauses an open diagnostic question before advancing to tools', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-diagnostic-question',
      documentId: 'doc-diagnostic-question',
      documentName: 'Diagnostico de instabilidade',
      version: 1,
      compiledAt: new Date('2026-07-02T00:00:00Z').toISOString(),
      triggerIntents: ['troubleshooting'],
      triggerKeywords: ['internet'],
      metadata: {},
      steps: [
        {
          id: 'ask',
          order: 1,
          type: 'gather_data',
          label: 'Pergunte se alguem mexeu no cabo.',
          promptTemplate: 'Alguem mexeu no cabo de fibra ou na ONU recentemente?',
          requiredSlots: [],
          nextStepId: 'note',
        },
        {
          id: 'note',
          order: 2,
          type: 'tool_call',
          label: 'Registre o diagnostico.',
          toolName: 'add_internal_note',
          toolPayloadTemplate: {},
          nextStepId: null,
        },
      ],
    };
    const runtimeContext = contextFor(graph);

    const firstTurn = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'Minha internet esta falhando',
    });

    expect(firstTurn.status).toBe('waiting_input');
    expect(firstTurn.response).toBe('Alguem mexeu no cabo de fibra ou na ONU recentemente?');
    expect(firstTurn.actions).toHaveLength(0);
    expect(firstTurn.executedSteps).toEqual(['ask']);
    expect(runtimeContext.currentStepId).toBe('ask');

    const secondTurn = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'Nao, ninguem mexeu',
    });

    expect(secondTurn.status).toBe('waiting_tool');
    expect(secondTurn.actions.map((action) => action.type)).toEqual(['add_internal_note']);
    expect(runtimeContext.collectedSlots.response_ask).toBe('Nao, ninguem mexeu');
  });

  it('uses the response resolver to turn an open procedure instruction into a customer question', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-natural-question',
      documentId: 'doc-natural-question',
      documentName: 'Diagnostico natural',
      version: 1,
      compiledAt: new Date('2026-07-02T00:00:00Z').toISOString(),
      triggerIntents: ['troubleshooting'],
      triggerKeywords: ['internet'],
      metadata: {},
      steps: [
        {
          id: 'ask',
          order: 1,
          type: 'gather_data',
          label: 'Diagnostico interno',
          promptTemplate: 'Diagnostico interno: pergunte se a conexao cai em todos os dispositivos.',
          requiredSlots: [],
          nextStepId: null,
        },
      ],
    };
    const responseResolver = vi.fn(async ({ prompt }) => {
      expect(prompt).toContain('uma unica pergunta curta');
      expect(prompt).toContain('Nao mencione fluxo');
      return 'A conexao cai em todos os seus dispositivos?';
    });

    const result = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'Minha internet esta falhando',
      responseResolver,
      forceLlmRespond: true,
    });

    expect(responseResolver).toHaveBeenCalledOnce();
    expect(result.status).toBe('waiting_input');
    expect(result.response).toBe('A conexao cai em todos os seus dispositivos?');
    expect(result.actions).toHaveLength(0);
  });

  it('does not execute a compiled transfer without explicit consent', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-transfer-consent',
      documentId: 'doc-transfer-consent',
      documentName: 'Transferencia com consentimento',
      version: 1,
      compiledAt: new Date('2026-07-02T00:00:00Z').toISOString(),
      triggerIntents: ['troubleshooting'],
      triggerKeywords: ['suporte'],
      metadata: {},
      steps: [
        {
          id: 'transfer',
          order: 1,
          type: 'tool_call',
          label: 'Com consentimento, use @transfer_chat para o setor Suporte.',
          toolName: 'transfer_chat',
          toolPayloadTemplate: {},
          requiresConfirmation: true,
          nextStepId: null,
        },
      ],
    };

    const blocked = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'Minha internet esta falhando',
    });
    expect(blocked.status).toBe('completed');
    expect(blocked.actions).toHaveLength(0);
    expect(blocked.response).toContain('confirmacao explicita');

    const declined = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'Nao quero',
    });
    expect(declined.actions).toHaveLength(0);
    expect(declined.response).toContain('nao vou transferir');

    const confirmed = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'Sim, pode transferir',
    });
    expect(confirmed.status).toBe('waiting_tool');
    expect(confirmed.actions.map((action) => action.type)).toEqual(['transfer_chat']);
  });

  it('reuses a fresh read-only SGP result passed into a new procedure', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-reuse-sgp',
      documentId: 'doc-reuse-sgp',
      documentName: 'Diagnostico',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['troubleshooting'],
      triggerKeywords: ['internet'],
      metadata: {},
      steps: [
        {
          id: 'lookup',
          order: 1,
          type: 'tool_call',
          label: 'Consultar painel',
          toolName: 'sgp_fetch_contact_panel_data',
          nextStepId: null,
        },
      ],
    };
    const runtimeContext = contextFor(graph);
    const priorToolResults: AgentToolExecutionResult[] = [
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: { contracts: [{ id: 'contract-1' }] },
      },
    ];

    const result = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'minha internet esta caindo',
      priorToolResults,
    });

    expect(result.status).toBe('completed');
    expect(result.actions).toHaveLength(0);
    expect(runtimeContext.stepHistory[0].output).toMatchObject({
      reused: true,
      toolName: 'sgp_fetch_contact_panel_data',
    });
  });

  it('blocks close_chat procedure execution unless the current message explicitly asks to close', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-close',
      documentId: 'doc-close',
      documentName: 'Encerrar atendimento',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['unknown'],
      triggerKeywords: ['encerrar'],
      metadata: {},
      steps: [
        {
          id: 'close',
          order: 1,
          type: 'tool_call',
          label: 'Quando o cliente pedir para encerrar o atendimento, utilize a ferramenta @close_chat.',
          toolName: 'close_chat',
          toolPayloadTemplate: {},
          nextStepId: null,
        },
      ],
    };
    const context = contextFor(graph);

    const result = await advanceProcedure({
      graph,
      context,
      customerMessage: 'Nao entendi kkk',
    });

    expect(result.status).toBe('completed');
    expect(result.actions).toHaveLength(0);
    expect(result.response).toBeNull();
    expect(context.stepHistory[0].output).toMatchObject({
      skipped: true,
    });
  });

  it('allows close_chat when the procedure reaches an explicit finalization step', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-final-close',
      documentId: 'doc-final-close',
      documentName: 'Finalizacao do fluxo',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['unknown'],
      triggerKeywords: ['finalizar'],
      metadata: {},
      steps: [
        {
          id: 'close',
          order: 1,
          type: 'tool_call',
          label: 'Fim do fluxo: apos concluir a coleta, encerre o atendimento com @close_chat.',
          toolName: 'close_chat',
          toolPayloadTemplate: { sendCloseMessage: 'false' },
          nextStepId: null,
        },
      ],
    };
    const context = contextFor(graph);

    const result = await advanceProcedure({
      graph,
      context,
      customerMessage: 'Obrigado',
    });

    expect(result.status).toBe('waiting_tool');
    expect(result.actions.map((action) => action.type)).toEqual(['close_chat']);
  });

  it('builds deterministic content for compiled internal note steps', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-note',
      documentId: 'doc-note',
      documentName: 'Diagnostico tecnico',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['troubleshooting'],
      triggerKeywords: ['diagnostico'],
      metadata: {},
      steps: [
        {
          id: 'note',
          order: 1,
          type: 'tool_call',
          label: 'Registre nota interna com @add_internal_note, incluindo sintomas e testes feitos.',
          toolName: 'add_internal_note',
          toolPayloadTemplate: {},
          nextStepId: null,
        },
      ],
    };

    const result = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'No aguardo!',
    });

    expect(result.status).toBe('waiting_tool');
    expect(result.actions[0]).toMatchObject({
      type: 'add_internal_note',
      payload: {
        content: 'Procedimento "Diagnostico tecnico": Registre nota interna com @add_internal_note, incluindo sintomas e testes feitos.',
      },
    });
  });

  it('falls back safely when a handoff step has no explicit destination and no team is available', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-handoff-no-target',
      documentId: 'doc-handoff-no-target',
      documentName: 'Escalonamento',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['troubleshooting'],
      triggerKeywords: ['equipe'],
      metadata: {},
      steps: [
        {
          id: 'handoff',
          order: 1,
          type: 'handoff',
          label: 'Encaminhe para nossa equipe.',
          handoffReason: 'Encaminhe para nossa equipe.',
          nextStepId: null,
        },
      ],
    };

    const result = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'No aguardo!',
      availableTeams: [],
    });

    expect(result.status).toBe('completed');
    expect(result.actions).toHaveLength(0);
    expect(result.response).toContain('Sera necessario que a equipe responsavel');
    expect(result.response).not.toContain('encaminh');
  });

  it('compiles mixed Wi-Fi router documents into branches and routes credential lookup away from reboot', async () => {
    const tools = [
      tool('sgp_fetch_contact_panel_data'),
      mcpTool('mcp:router:get_wifi_view', 'Consulta SSID, usuario e senha atuais do Wi-Fi do contrato validado.'),
      mcpTool('mcp:router:reboot_router', 'Reinicia o roteador do assinante. Operacao com side effect.'),
      mcpTool('mcp:router:change_wifi_credentials', 'Troca nome SSID e senha do Wi-Fi do roteador.'),
    ];
    const document: KnowledgeBaseDocument = {
      id: 'router-wifi-mixed',
      name: 'Roteador e Wi-Fi - consulta, reboot e troca de senha',
      content: [
        'REINICIAR ROTEADOR',
        'Use @sgp_fetch_contact_panel_data para validar o cliente e o contrato.',
        'Execute @mcp:router:reboot_router somente no roteador correto.',
        '',
        'CONSULTAR WI-FI',
        'Quando o cliente pedir usuario, senha, SSID, nome da rede ou disser que esqueceu a senha, use @mcp:router:get_wifi_view.',
        '',
        'TROCAR NOME/SENHA DO WI-FI',
        'Quando o cliente pedir troca de nome ou senha, confirme os novos dados e execute @mcp:router:change_wifi_credentials.',
      ].join('\n'),
    };

    const result = compileProcedureFromDocument({
      document,
      tools,
      enabledToolNames: tools.map((item) => item.name),
    });

    expect(result.success).toBe(true);
    const graph = result.graph!;
    expect(graph.metadata.sectionAware).toBe(true);
    expect(graph.steps[0]).toMatchObject({ type: 'decide' });
    expect(graph.steps[0].branches?.map((branch) => branch.condition)).toEqual(expect.arrayContaining([
      expect.stringContaining('CONSULTAR WI-FI'),
      expect.stringContaining('REINICIAR ROTEADOR'),
    ]));

    const runtimeContext = contextFor(graph);
    const advance = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'Opa Lucas, esqueci o usuario e senha do Wi-Fi. Voce pode verificar?',
      decisionResolver: async () => 'REINICIAR ROTEADOR',
    });

    expect(advance.status).toBe('waiting_tool');
    expect(advance.actions).toEqual([
      expect.objectContaining({
        type: 'mcp_call_tool',
        payload: expect.objectContaining({
          toolName: 'mcp:router:get_wifi_view',
        }),
      }),
    ]);
    expect(advance.actions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({ toolName: 'mcp:router:reboot_router' }),
      }),
    ]));

    expect(matchProcedure({
      intent: 'troubleshooting',
      customerMessage: 'A internet da minha fibra esta toda hora falhando',
      compiledProcedures: [graph],
    })).toBeNull();
  });

  it('blocks a stale reboot step when the current customer message asks for Wi-Fi credentials', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-stale-reboot',
      documentId: 'doc-stale-reboot',
      documentName: 'Roteador e Wi-Fi',
      version: 1,
      compiledAt: new Date('2026-06-19T12:00:00Z').toISOString(),
      triggerIntents: ['troubleshooting'],
      triggerKeywords: ['wifi', 'roteador'],
      metadata: {},
      steps: [
        {
          id: 'reboot',
          order: 1,
          type: 'tool_call',
          label: 'Execute reboot_router somente no roteador correto.',
          toolName: 'mcp:router:reboot_router',
          semanticIntent: 'router_reboot',
          requiresExplicitCustomerRequest: true,
          sideEffect: 'high',
          nextStepId: null,
        },
      ],
    };

    const result = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'Esqueci a senha e o usuario do Wi-Fi',
    });

    expect(result.status).toBe('completed');
    expect(result.actions).toHaveLength(0);
    expect(result.response).toContain('consultar os dados atuais do Wi-Fi');
  });

  it('uses the first available team when a reached handoff step has no explicit destination', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-handoff-default-team',
      documentId: 'doc-handoff-default-team',
      documentName: 'Escalonamento',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['troubleshooting'],
      triggerKeywords: ['equipe'],
      metadata: {},
      steps: [
        {
          id: 'handoff',
          order: 1,
          type: 'handoff',
          label: 'Encaminhe para nossa equipe.',
          handoffReason: 'Encaminhe para nossa equipe.',
          nextStepId: null,
        },
      ],
    };

    const result = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'No aguardo!',
      availableTeams: [{ id: 'support-team', name: 'Suporte' }],
    });

    expect(result.status).toBe('completed');
    expect(result.actions[0]).toMatchObject({
      type: 'transfer_chat',
      payload: { teamId: 'support-team' },
    });
    expect(result.response).toContain('Encaminhe para nossa equipe');
  });

  it('targets a named team when a procedure handoff explicitly mentions it', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-handoff-target',
      documentId: 'doc-handoff-target',
      documentName: 'Escalonamento suporte',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['troubleshooting'],
      triggerKeywords: ['suporte'],
      metadata: {},
      steps: [
        {
          id: 'handoff',
          order: 1,
          type: 'handoff',
          label: 'Encaminhe para a equipe Suporte.',
          handoffReason: 'Vou encaminhar seu atendimento para a equipe Suporte.',
          nextStepId: null,
        },
      ],
    };

    const result = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'Preciso de suporte',
      availableTeams: [{ id: 'support-team', name: 'Suporte' }],
    });

    expect(result.status).toBe('completed');
    expect(result.actions[0]).toMatchObject({
      type: 'transfer_chat',
      payload: { teamId: 'support-team' },
    });
  });

  it('uses the terminal handoff response instead of concatenating earlier step text', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-handoff-overrides',
      documentId: 'doc-handoff-overrides',
      documentName: 'Risco imediato',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['support_request'],
      triggerKeywords: ['risco'],
      metadata: {},
      steps: [
        {
          id: 'intro',
          order: 1,
          type: 'respond',
          label: 'Acolhimento',
          responseTemplate: 'Vou fazer uma pergunta antes.',
          nextStepId: 'handoff',
        },
        {
          id: 'handoff',
          order: 2,
          type: 'handoff',
          label: 'Transferir para Suporte',
          handoffReason: 'Estou transferindo para a equipe Suporte.',
          nextStepId: null,
        },
      ],
    };

    const result = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'risco agora',
      availableTeams: [{ id: 'support-team', name: 'Suporte' }],
    });

    expect(result.status).toBe('completed');
    expect(result.response).toBe('Estou transferindo para a equipe Suporte.');
    expect(result.actions[0]).toMatchObject({ type: 'transfer_chat' });
  });

  it('pauses question messages and resumes at the next step instead of stacking responses', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-question-pause',
      documentId: 'doc-question-pause',
      documentName: 'Pergunta inicial',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['support_request'],
      triggerKeywords: ['ajuda'],
      metadata: {},
      steps: [
        {
          id: 'welcome',
          order: 1,
          type: 'respond',
          label: 'Boas-vindas',
          visualNodeKind: 'message',
          responseTemplate: 'Ola! Qual e o nome da crianca e o motivo do contato?',
          nextStepId: 'decision',
        },
        {
          id: 'decision',
          order: 2,
          type: 'decide',
          label: 'Classificar',
          branches: [
            { condition: 'triagem', nextStepId: 'triage' },
          ],
        },
        {
          id: 'triage',
          order: 3,
          type: 'respond',
          label: 'Triagem',
          responseTemplate: 'Vamos seguir a triagem.',
          nextStepId: null,
        },
      ],
    };
    const runtimeContext = contextFor(graph);

    const result = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'Oi, preciso de ajuda',
    });

    expect(result.status).toBe('waiting_input');
    expect(result.response).toBe('Ola! Qual e o nome da crianca e o motivo do contato?');
    expect(result.executedSteps).toEqual(['welcome']);
    expect(runtimeContext.currentStepId).toBe('decision');
  });

  it('keeps question message nodes deterministic even when LM Studio forces LLM responses', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-force-llm-message',
      documentId: 'doc-force-llm-message',
      documentName: 'Mensagem deterministica',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['support_request'],
      triggerKeywords: ['ajuda'],
      metadata: {},
      steps: [
        {
          id: 'welcome',
          order: 1,
          type: 'respond',
          label: 'Boas-vindas',
          visualNodeKind: 'message',
          responseTemplate: 'Ola! Qual e a idade e o motivo do contato?',
          nextStepId: 'next',
        },
        {
          id: 'next',
          order: 2,
          type: 'respond',
          label: 'Proximo',
          responseTemplate: 'Nao deve executar agora.',
          nextStepId: null,
        },
      ],
    };
    const responseResolver = vi.fn(async () => 'Resposta indevida do LLM.');
    const runtimeContext = contextFor(graph);

    const result = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'Quero marcar consulta agora, sem pergunta.',
      responseResolver,
      forceLlmRespond: true,
    });

    expect(responseResolver).not.toHaveBeenCalled();
    expect(result.status).toBe('waiting_input');
    expect(result.response).toBe('Ola! Qual e a idade e o motivo do contato?');
    expect(runtimeContext.currentStepId).toBe('next');
  });

  it('does not route medication dosage requests to a high-risk handoff without red flags', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-dosage-triage',
      documentId: 'doc-dosage-triage',
      documentName: 'Dosagem',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['support_request'],
      triggerKeywords: ['febre'],
      metadata: {},
      steps: [
        {
          id: 'risk',
          order: 1,
          type: 'decide',
          label: 'Classificar risco',
          branches: [
            { condition: 'Risco Vermelho Grave emergencia pronto socorro', nextStepId: 'handoff' },
            { condition: 'Triagem Azul Amarelo febre vomito resfriado', nextStepId: 'triage' },
          ],
        },
        {
          id: 'handoff',
          order: 2,
          type: 'handoff',
          label: 'Transferir',
          handoffReason: 'Transferir para equipe.',
          nextStepId: null,
        },
        {
          id: 'triage',
          order: 3,
          type: 'respond',
          label: 'Triagem',
          responseTemplate: 'Nao posso orientar dosagem de medicamento por aqui por seguranca. Qual e a temperatura e ha quanto tempo a febre comecou?',
          nextStepId: null,
        },
      ],
    };

    const result = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'Meu filho tem 5 anos e febre. Quantas gotas de dipirona eu dou?',
      availableTeams: [{ id: 'team', name: 'Equipe' }],
    });

    expect(result.actions).toHaveLength(0);
    expect(result.executedSteps).toEqual(['risk', 'triage']);
    expect(result.response).toContain('Nao posso orientar dosagem');
  });

  it('pauses sub-agent responses even when an end node is connected next', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-subagent-pause',
      documentId: 'doc-subagent-pause',
      documentName: 'Sub agente',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['support_request'],
      triggerKeywords: ['febre'],
      metadata: {},
      steps: [
        {
          id: 'agent',
          order: 1,
          type: 'respond',
          label: 'Sub agente',
          visualNodeKind: 'sub_agent',
          responseTemplate: 'Responda.',
          useLlm: true,
          nextStepId: 'end',
        },
        {
          id: 'end',
          order: 2,
          type: 'respond',
          label: 'Fim',
          responseTemplate: 'Mensagem final que nao deve ser empilhada.',
          nextStepId: null,
        },
      ],
    };
    const runtimeContext = contextFor(graph);

    const result = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'meu filho esta com febre',
      responseResolver: async () => 'Primeira resposta do sub-agente.',
    });

    expect(result.status).toBe('waiting_input');
    expect(result.response).toBe('Primeira resposta do sub-agente.');
    expect(result.executedSteps).toEqual(['agent']);
    expect(runtimeContext.currentStepId).toBe('agent');
  });

  it('lets specialist sub-agents return to the next main-flow step when configured', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-subagent-return',
      documentId: 'doc-subagent-return',
      documentName: 'Sub agente especialista',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['support_request'],
      triggerKeywords: ['financeiro'],
      metadata: {},
      steps: [
        {
          id: 'specialist',
          order: 1,
          type: 'respond',
          label: 'Especialista financeiro',
          visualNodeKind: 'sub_agent',
          responseTemplate: 'Responda como especialista.',
          useLlm: true,
          returnToMainPrompt: true,
          nextStepId: 'main',
        },
        {
          id: 'main',
          order: 2,
          type: 'respond',
          label: 'Agente principal',
          responseTemplate: 'Proximo passo.',
          nextStepId: null,
        },
      ],
    };
    const runtimeContext = contextFor(graph);

    const result = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'preciso de ajuda no financeiro',
      responseResolver: async () => 'Resposta do especialista.',
    });

    expect(result.status).toBe('waiting_input');
    expect(result.response).toBe('Resposta do especialista.');
    expect(result.executedSteps).toEqual(['specialist']);
    expect(runtimeContext.currentStepId).toBe('main');
  });

  it('collects custom typed slots by field definition and does not ask them again', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-custom-slots',
      documentId: 'doc-custom-slots',
      documentName: 'Agendamento com dados customizados',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['scheduling_request'],
      triggerKeywords: ['agendar'],
      metadata: {},
      steps: [
        {
          id: 'collect',
          order: 1,
          type: 'gather_data',
          label: 'Coletar responsavel',
          requiredSlots: ['nome_resp', 'tel_resp'],
          slotDefinitions: [
            { key: 'nome_resp', label: 'Nome completo do responsavel', type: 'name', required: true },
            { key: 'tel_resp', label: 'Telefone de contato', type: 'phone', required: true },
          ],
          promptTemplate: 'Me informe o nome completo do responsavel e telefone com DDD.',
          nextStepId: 'done',
        },
        {
          id: 'done',
          order: 2,
          type: 'respond',
          label: 'Confirmar',
          responseTemplate: 'Recebi os dados: {{nome_resp}} / {{tel_resp}}.',
          nextStepId: null,
        },
      ],
    };
    const runtimeContext = contextFor(graph);

    const first = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'quero agendar',
    });

    expect(first.status).toBe('waiting_input');
    expect(first.response).toContain('nome completo');
    expect(runtimeContext.currentStepId).toBe('collect');

    const second = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'Fabricio de Sousa Soares, telefone 61995215930',
    });

    expect(second.status).toBe('completed');
    expect(second.response).toBe('Recebi os dados: Fabricio de Sousa Soares / 61995215930.');
    expect(runtimeContext.collectedSlots).toMatchObject({
      nome_resp: 'Fabricio de Sousa Soares',
      tel_resp: '61995215930',
    });
  });

  it('keeps a waiting collect step active when the customer asks a generic follow-up', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-resume-collect',
      documentId: 'doc-resume-collect',
      documentName: 'Retomar coleta',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['support_request'],
      triggerKeywords: ['suporte'],
      metadata: {},
      steps: [
        {
          id: 'collect',
          order: 1,
          type: 'gather_data',
          label: 'Coletar telefone',
          requiredSlots: ['phone'],
          slotDefinitions: [{ key: 'phone', label: 'Telefone com DDD', type: 'phone', required: true }],
          promptTemplate: 'Qual e o telefone com DDD?',
          nextStepId: 'done',
        },
        {
          id: 'done',
          order: 2,
          type: 'respond',
          label: 'Final',
          responseTemplate: 'Obrigado.',
          nextStepId: null,
        },
      ],
    };
    const runtimeContext = contextFor(graph);
    runtimeContext.status = 'waiting_input';
    runtimeContext.currentStepId = 'collect';

    const result = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'e agora?',
    });

    expect(result.status).toBe('waiting_input');
    expect(result.response).toBe('Qual e o telefone com DDD?');
    expect(runtimeContext.currentStepId).toBe('collect');
    expect(runtimeContext.collectedSlots.phone).toBeUndefined();
  });

  it('does not collect customer questions as text registration slots', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-registration-question',
      documentId: 'doc-registration-question',
      documentName: 'Pre-cadastro',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['purchase_inquiry'],
      triggerKeywords: ['planos'],
      metadata: {},
      steps: [
        {
          id: 'collect',
          order: 1,
          type: 'gather_data',
          label: 'Pre-Cadastro',
          requiredSlots: ['nome', 'documento', 'telefone', 'endereco'],
          slotDefinitions: [
            { key: 'nome', label: 'Nome Completo', type: 'text', required: true },
            { key: 'documento', label: 'CPF ou CNPJ', type: 'text', required: true },
            { key: 'telefone', label: 'Telefone de Contato', type: 'phone', required: true },
            { key: 'endereco', label: 'Endereco Completo', type: 'text', required: true },
          ],
          promptTemplate: 'Para reservar o plano, me envie seus dados.',
          nextStepId: null,
        },
      ],
    };
    const runtimeContext = contextFor(graph);
    runtimeContext.status = 'waiting_input';
    runtimeContext.currentStepId = 'collect';

    const result = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'E esse Wi-Fi 6 e o que?',
    });

    expect(result.status).toBe('waiting_input');
    expect(result.response).toContain('nome');
    expect(runtimeContext.currentStepId).toBe('collect');
    expect(runtimeContext.collectedSlots).toEqual({});
  });

  it('injects retrieved knowledge chunks into grounded AI responses', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-grounding',
      documentId: 'doc-grounding',
      documentName: 'Responder com base',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['support_request'],
      triggerKeywords: ['febre'],
      metadata: {},
      steps: [
        {
          id: 'knowledge',
          order: 1,
          type: 'retrieve_knowledge',
          label: 'Buscar base',
          knowledgeQueryTemplate: 'febre pediatrica {{customerMessage}}',
          requiredKnowledgeCoverage: 'medium',
          nextStepId: 'respond',
        },
        {
          id: 'respond',
          order: 2,
          type: 'respond',
          label: 'Responder',
          responseTemplate: 'Responda com base nas orientacoes disponiveis.',
          useLlm: true,
          requireGrounding: true,
          requiredKnowledgeCoverage: 'medium',
          nextStepId: null,
        },
      ],
    };
    const prompts: string[] = [];

    const result = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'meu filho esta com febre',
      knowledgeResolver: async () => ({
        coverage: 'medium',
        chunks: [
          {
            documentId: 'doc-1',
            chunkId: 'chunk-1',
            title: 'Febre',
            category: 'pediatria',
            score: 0.91,
            excerpt: 'Ofereca liquidos com frequencia e observe sinais de piora.',
            source: 'knowledge_base',
          },
        ],
      }),
      responseResolver: async ({ prompt }) => {
        prompts.push(prompt);
        return 'Com base nas orientacoes disponiveis, ofereca liquidos com frequencia.';
      },
    });

    expect(result.status).toBe('completed');
    expect(result.response).toContain('Com base nas orientacoes');
    expect(prompts[0]).toContain('Contexto permitido da base de conhecimento');
    expect(prompts[0]).toContain('Ofereca liquidos com frequencia');
  });

  it('blocks grounded responses when knowledge coverage is too low', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-low-coverage',
      documentId: 'doc-low-coverage',
      documentName: 'Baixa cobertura',
      version: 1,
      compiledAt: new Date('2026-05-12T12:00:00Z').toISOString(),
      triggerIntents: ['support_request'],
      triggerKeywords: ['febre'],
      metadata: {},
      steps: [
        {
          id: 'knowledge',
          order: 1,
          type: 'retrieve_knowledge',
          label: 'Buscar base',
          requiredKnowledgeCoverage: 'medium',
          onLowKnowledge: 'pause',
          nextStepId: 'respond',
        },
        {
          id: 'respond',
          order: 2,
          type: 'respond',
          label: 'Responder',
          responseTemplate: 'Nunca deve chegar aqui sem base.',
          useLlm: true,
          requireGrounding: true,
          requiredKnowledgeCoverage: 'medium',
          nextStepId: null,
        },
      ],
    };
    const responseResolver = vi.fn(async () => 'inventado');

    const result = await advanceProcedure({
      graph,
      context: contextFor(graph),
      customerMessage: 'posso dar algum remedio?',
      knowledgeResolver: async () => ({
        coverage: 'low',
        chunks: [],
        reason: 'no_relevant_chunks',
      }),
      responseResolver,
    });

    expect(result.status).toBe('waiting_input');
    expect(result.response).toContain('Nao encontrei orientacao suficiente');
    expect(responseResolver).not.toHaveBeenCalled();
  });
});

describe('procedure studio runtime safety', () => {
  it('pauses a sensitive generic tool until the customer explicitly confirms', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-sensitive-confirmation',
      documentId: 'procedure-studio:test',
      documentName: 'Alterar senha do Wi-Fi',
      version: 1,
      compiledAt: new Date('2026-08-25T12:00:00Z').toISOString(),
      triggerIntents: ['change_request'],
      triggerKeywords: ['trocar senha wifi'],
      metadata: { source: 'procedure_studio' },
      steps: [
        {
          id: 'change',
          order: 1,
          type: 'tool_call',
          label: 'Alterar credenciais do roteador',
          toolName: 'mcp:router:change_wifi_credentials',
          toolPayloadTemplate: { password: '{{wifi_password}}' },
          requiresConfirmation: true,
          confirmationPrompt: 'Os aparelhos serão desconectados. Confirma a alteração?',
          successStepId: 'done',
          errorStepId: 'fallback',
          nextStepId: 'done',
        },
        { id: 'done', order: 2, type: 'respond', label: 'Concluir', responseTemplate: 'Alteração concluída.', nextStepId: null },
        { id: 'fallback', order: 3, type: 'handoff', label: 'Encaminhar falha', handoffReason: 'Encaminhe para o Suporte.', nextStepId: null },
      ],
    };
    const runtimeContext = contextFor(graph);
    runtimeContext.collectedSlots.wifi_password = 'senha-segura';

    const first = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'Quero trocar a senha do Wi-Fi',
    });

    expect(first.status).toBe('waiting_input');
    expect(first.actions).toEqual([]);
    expect(first.response).toBe('Os aparelhos serão desconectados. Confirma a alteração?');
    expect(runtimeContext.currentStepId).toBe('change');

    const confirmed = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'Confirmo',
    });

    expect(confirmed.status).toBe('waiting_tool');
    expect(confirmed.actions).toEqual([
      expect.objectContaining({
        type: 'mcp_call_tool',
        payload: expect.objectContaining({ toolName: 'mcp:router:change_wifi_credentials' }),
      }),
    ]);
    expect(runtimeContext.decisions.confirmation_change).toBe('confirmed');
  });

  it('routes a failed tool result to the configured recovery path', async () => {
    const graph: ProcedureGraph = {
      id: 'proc-tool-error-route',
      documentId: 'procedure-studio:error-route',
      documentName: 'Consultar roteador',
      version: 1,
      compiledAt: new Date('2026-08-25T12:00:00Z').toISOString(),
      triggerIntents: ['support_request'],
      triggerKeywords: ['roteador'],
      metadata: { source: 'procedure_studio' },
      steps: [
        {
          id: 'tool',
          order: 1,
          type: 'tool_call',
          label: 'Consultar roteador',
          toolName: 'mcp:router:get_status',
          toolPayloadTemplate: {},
          successStepId: 'done',
          errorStepId: 'fallback',
          nextStepId: 'done',
        },
        { id: 'done', order: 2, type: 'respond', label: 'Responder', responseTemplate: 'Roteador consultado.', nextStepId: null },
        { id: 'fallback', order: 3, type: 'handoff', label: 'Suporte', handoffReason: 'O Suporte continuará após a falha da consulta.', nextStepId: null },
      ],
    };
    const runtimeContext = contextFor(graph);

    const waiting = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'Consulte o roteador',
    });
    expect(waiting.status).toBe('waiting_tool');

    const failed = await advanceProcedure({
      graph,
      context: runtimeContext,
      customerMessage: 'Consulte o roteador',
      availableTeams: [{ id: 'team-support', name: 'Suporte' }],
      toolResults: [{
        toolName: 'mcp:router:get_status',
        status: 'error',
        input: { type: 'mcp:router:get_status', payload: {} },
        error: 'router_offline',
      } as unknown as AgentToolExecutionResult],
    });

    expect(failed.status).toBe('completed');
    expect(failed.response).toContain('Suporte continuará');
    expect(failed.actions).toEqual([
      expect.objectContaining({ type: 'transfer_chat', payload: { teamId: 'team-support' } }),
    ]);
    expect(runtimeContext.currentStepId).toBe('fallback');
  });
});
