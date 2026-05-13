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
});
