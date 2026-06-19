import { describe, expect, it } from 'vitest';

import { decideAgentNextAction } from '@/services/autopilot/agent-decision-engine';

const baseIntent = {
  intent: 'billing_or_payment' as const,
  workflowId: 'billing',
  confidence: 0.91,
  reason: 'Cliente pediu segunda via de boleto.',
};

describe('agent decision engine', () => {
  it('prioritizes missing slots over tool execution', () => {
    const decision = decideAgentNextAction({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      stage: 'workflow_plan',
      intentResolution: baseIntent,
      workflowPlan: {
        executionMode: 'pre_response_tools',
        missingSlots: ['customer_identifier'],
        actions: [{ type: 'sgp_fetch_contact_panel_data', payload: {} }],
        reason: 'Consulta exige CPF/CNPJ.',
        handledByWorkflow: true,
      },
    });

    expect(decision.decisionType).toBe('ask_slot');
    expect(decision.requiredSlots).toEqual(['customer_identifier']);
    expect(decision.ledgerEntry).toMatchObject({
      decisionStage: 'workflow_plan',
      decisionType: 'ask_slot',
      goal: 'billing_or_payment',
      workflowId: 'billing',
    });
  });

  it('records a redacted slot summary in the ledger metadata', () => {
    const decision = decideAgentNextAction({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      stage: 'workflow_plan',
      intentResolution: baseIntent,
      workflowPlan: {
        executionMode: 'pre_response_tools',
        missingSlots: ['invoice_or_payment_id'],
        actions: [{ type: 'sgp_fetch_contact_panel_data', payload: {} }],
        reason: 'Consulta exige identificador da fatura.',
        handledByWorkflow: true,
        slotExtraction: {
          slots: { customer_identifier: '52998224725' },
          details: [{
            name: 'customer_identifier',
            value: '52998224725',
            source: 'message',
            confidence: 0.98,
          }],
          invalidSlots: [{
            name: 'date',
            value: '32/13',
            reason: 'Data invalida.',
          }],
        },
      },
    });

    expect(decision.presentSlots).toEqual([{
      name: 'customer_identifier',
      source: 'message',
      confidence: 0.98,
    }]);
    expect(decision.invalidSlots).toEqual([{
      name: 'date',
      reason: 'Data invalida.',
    }]);
    expect(decision.ledgerEntry.metadata?.slotSummary).toEqual({
      presentSlots: [{
        name: 'customer_identifier',
        source: 'message',
        confidence: 0.98,
      }],
      missingSlots: ['invoice_or_payment_id'],
      invalidSlots: [{
        name: 'date',
        reason: 'Data invalida.',
      }],
    });
    expect(JSON.stringify(decision.ledgerEntry.metadata)).not.toContain('52998224725');
  });

  it('keeps switch route alternatives in the ledger metadata', () => {
    const decision = decideAgentNextAction({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      stage: 'workflow_plan',
      intentResolution: {
        intent: 'troubleshooting' as const,
        workflowId: 'support',
        confidence: 0.89,
        reason: 'Cliente relatou problema no Wi-Fi.',
      },
      switchResolution: {
        switchNodeId: 'switch-wifi',
        routeId: 'lentidao_wifi',
        routeLabel: 'Lentidao no Wi-Fi',
        targetNodeId: 'diagnosticar-lentidao',
        confidence: 0.82,
        fallbackUsed: false,
        evidence: ['Termos relacionados: lento, travando'],
        candidateRoutes: [
          {
            routeId: 'lentidao_wifi',
            routeLabel: 'Lentidao no Wi-Fi',
            targetNodeId: 'diagnosticar-lentidao',
            confidence: 0.82,
            selected: true,
            fallback: false,
            evidence: ['Termos relacionados: lento, travando'],
          },
          {
            routeId: 'alterar_wifi',
            routeLabel: 'Alterar nome/senha',
            targetNodeId: 'coletar-wifi',
            confidence: 0.22,
            selected: false,
            fallback: false,
            evidence: [],
            rejectedReason: 'Confianca 0.22 abaixo do minimo 0.70.',
          },
        ],
        rejectedRoutes: [
          {
            routeId: 'alterar_wifi',
            routeLabel: 'Alterar nome/senha',
            targetNodeId: 'coletar-wifi',
            confidence: 0.22,
            selected: false,
            fallback: false,
            evidence: [],
            rejectedReason: 'Confianca 0.22 abaixo do minimo 0.70.',
          },
        ],
      },
    });

    expect(decision.ledgerEntry.metadata?.switchResolution).toMatchObject({
      switchNodeId: 'switch-wifi',
      routeId: 'lentidao_wifi',
      candidateRoutes: [
        expect.objectContaining({ routeId: 'lentidao_wifi', selected: true }),
        expect.objectContaining({ routeId: 'alterar_wifi', selected: false }),
      ],
      rejectedRoutes: [
        expect.objectContaining({
          routeId: 'alterar_wifi',
          rejectedReason: 'Confianca 0.22 abaixo do minimo 0.70.',
        }),
      ],
    });
  });

  it('selects tool execution when planner approves an operational action', () => {
    const decision = decideAgentNextAction({
      workspaceId: 'workspace-1',
      stage: 'tool_planner',
      intentResolution: baseIntent,
      workflowPlan: {
        executionMode: 'pre_response_tools',
        actions: [{ type: 'sgp_fetch_contact_panel_data', payload: {} }],
        reason: 'Cliente quer consultar fatura.',
      },
      toolPlanner: {
        actions: [{ type: 'sgp_fetch_contact_panel_data', payload: {} }],
        rejectedActions: [],
      },
      policyContext: {
        allowedToolNames: ['sgp_fetch_contact_panel_data'],
      },
    });

    expect(decision.decisionType).toBe('call_tool');
    expect(decision.selectedTools).toEqual(['sgp_fetch_contact_panel_data']);
    expect(decision.ledgerEntry.policyResult).toMatchObject({
      allowedToolNames: ['sgp_fetch_contact_panel_data'],
    });
  });

  it('records blocked tools as fallback evidence', () => {
    const decision = decideAgentNextAction({
      workspaceId: 'workspace-1',
      stage: 'tool_planner',
      intentResolution: baseIntent,
      toolPlanner: {
        actions: [],
        rejectedActions: [
          {
            action: { type: 'sgp_generate_invoice_pix', payload: { invoiceId: '1' } },
            reason: 'Geracao de PIX exige contractId.',
            missingSlots: ['invoice_or_payment_id'],
            code: 'missing_slots',
          },
        ],
        responseOverride: 'Para seguir, me informe a fatura.',
      },
    });

    expect(decision.decisionType).toBe('ask_slot');
    expect(decision.blockedTools).toEqual([
      {
        toolName: 'sgp_generate_invoice_pix',
        reason: 'Geracao de PIX exige contractId.',
        missingSlots: ['invoice_or_payment_id'],
      },
    ]);
    expect(decision.evidence.map((item) => item.source)).toContain('tool_policy_gate');
  });

  it('classifies confirmation policy blocks as wait_confirmation', () => {
    const decision = decideAgentNextAction({
      workspaceId: 'workspace-1',
      stage: 'tool_execution',
      intentResolution: {
        intent: 'troubleshooting' as const,
        workflowId: 'support',
        confidence: 0.87,
        reason: 'Cliente pediu reinicio do equipamento.',
      },
      toolPlanner: {
        actions: [],
        rejectedActions: [
          {
            action: {
              type: 'mcp_call_tool',
              payload: {
                toolName: 'mcp:router:reboot_router',
                arguments: { contract_id: '123' },
              },
            },
            reason: '[tool_policy:confirmation_required] Preciso da confirmacao explicita do cliente antes de executar mcp:router:reboot_router.',
            code: 'step_not_allowed',
          },
        ],
      },
    });

    expect(decision.decisionType).toBe('wait_confirmation');
    expect(decision.ledgerEntry.decisionType).toBe('wait_confirmation');
    expect(decision.blockedTools[0]).toMatchObject({
      toolName: 'mcp:router:reboot_router',
    });
  });

  it('attaches procedure context to the ledger entry', () => {
    const decision = decideAgentNextAction({
      workspaceId: 'workspace-1',
      stage: 'tool_planner',
      intentResolution: baseIntent,
      procedure: {
        activeProcedureId: 'exec-1',
        procedureId: 'proc-billing',
        procedureName: 'Financeiro',
        currentStepId: 'collect-cpf',
        status: 'waiting_input',
      },
    });

    expect(decision.decisionType).toBe('ask_slot');
    expect(decision.ledgerEntry).toMatchObject({
      procedureExecutionId: 'exec-1',
      procedureId: 'proc-billing',
      stepId: 'collect-cpf',
    });
  });

  it('classifies procedure runtime tool actions as auditable tool calls', () => {
    const decision = decideAgentNextAction({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      runId: 'run-1',
      autopilotConfigId: 'config-1',
      stage: 'procedure_runtime',
      intentResolution: {
        intent: 'troubleshooting' as const,
        workflowId: 'support',
        confidence: 0.88,
        reason: 'Cliente relatou lentidao no Wi-Fi.',
      },
      workflowPlan: {
        executionMode: 'pre_response_tools',
        handledByWorkflow: true,
        reason: 'Procedimento pediu consulta tecnica.',
        actions: [{ type: 'sgp_fetch_contact_panel_data', payload: {} }],
      },
      procedure: {
        activeProcedureId: 'exec-wifi',
        procedureId: 'proc-wifi',
        procedureName: 'Diagnosticar Wi-Fi',
        currentStepId: 'inspect-contract',
        status: 'running',
        matchScore: 0.92,
        matchReason: 'Procedimento casou com reclamacao de lentidao.',
      },
      policyContext: {
        procedureRuntimeSource: 'matched',
        procedureStatus: 'running',
        executedSteps: ['inspect-contract'],
        actionCount: 1,
      },
      metadata: {
        procedureRuntime: true,
      },
    });

    expect(decision.decisionType).toBe('call_tool');
    expect(decision.selectedTools).toEqual(['sgp_fetch_contact_panel_data']);
    expect(decision.ledgerEntry).toMatchObject({
      decisionStage: 'procedure_runtime',
      procedureExecutionId: 'exec-wifi',
      procedureId: 'proc-wifi',
      stepId: 'inspect-contract',
      selectedTool: 'sgp_fetch_contact_panel_data',
    });
    expect(decision.ledgerEntry.evidence?.map((item) => item.source)).toContain('procedure_matcher');
  });

  it('keeps procedure runtime responses as answer decisions when no tool is needed', () => {
    const decision = decideAgentNextAction({
      workspaceId: 'workspace-1',
      stage: 'procedure_runtime',
      intentResolution: baseIntent,
      workflowPlan: {
        executionMode: 'direct_response',
        handledByWorkflow: true,
        reason: 'Procedimento respondeu com instrucao final ao cliente.',
        actions: [],
      },
      procedure: {
        activeProcedureId: 'exec-2',
        procedureId: 'proc-billing',
        procedureName: 'Financeiro',
        currentStepId: 'respond-result',
        status: 'completed',
      },
    });

    expect(decision.decisionType).toBe('answer');
    expect(decision.selectedTools).toEqual([]);
    expect(decision.ledgerEntry.metadata?.workflowPlan).toMatchObject({
      executionMode: 'direct_response',
      handledByWorkflow: true,
    });
  });
});
