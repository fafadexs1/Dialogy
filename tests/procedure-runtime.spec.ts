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

  it('does not emit an invalid transfer action when a handoff step has no explicit destination', async () => {
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
      availableTeams: [{ id: 'support-team', name: 'Suporte' }],
    });

    expect(result.status).toBe('completed');
    expect(result.actions).toHaveLength(0);
    expect(result.response).toContain('Sera necessario que a equipe responsavel');
    expect(result.response).not.toContain('encaminh');
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
});
