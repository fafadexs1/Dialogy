import { describe, expect, it } from 'vitest';

import { matchProcedure } from '@/services/autopilot/procedure-matcher';
import type { ProcedureGraph } from '@/services/autopilot/procedure-types';
import {
  materializeProcedureAiBlueprint,
  ProcedureAiBlueprintSchema,
} from '@/services/procedures/ai-builder';
import type { ProcedureToolOption } from '@/services/procedures/schemas';
import {
  createWifiCredentialsProcedure,
  materializeProcedureGraph,
  simulateProcedureSuite,
} from '@/services/procedures/studio';
import { validateProcedureStudioDocument } from '@/services/procedures/validator';

const CONFIG_ID = '11111111-1111-4111-8111-111111111111';

function procedureTool(input: Partial<ProcedureToolOption> & Pick<ProcedureToolOption, 'name'>): ProcedureToolOption {
  return {
    name: input.name,
    displayName: input.displayName || input.name,
    description: input.description || 'Ferramenta de teste',
    riskLevel: input.riskLevel || 'low',
    sideEffect: input.sideEffect || 'none',
    requiresHumanApproval: input.requiresHumanApproval || false,
    enabled: input.enabled ?? true,
    requiredSlots: input.requiredSlots || [],
    inputSchema: input.inputSchema || null,
  };
}

const wifiTools = [
  procedureTool({ name: 'sgp_fetch_contact_panel_data' }),
  procedureTool({
    name: 'mcp:router:change_wifi_credentials',
    displayName: 'Alterar credenciais do Wi-Fi',
    riskLevel: 'high',
    sideEffect: 'high',
    requiresHumanApproval: true,
  }),
];

describe('procedure studio', () => {
  it('creates a publishable Wi-Fi procedure with explicit success and failure simulations', () => {
    const procedure = createWifiCredentialsProcedure(CONFIG_ID, wifiTools);
    const validation = validateProcedureStudioDocument({ procedure, tools: wifiTools });
    const simulation = simulateProcedureSuite({ procedure, tools: wifiTools });

    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(simulation.passed).toBe(true);
    expect(simulation.cases.map((item) => item.id)).toEqual([
      'happy_path',
      'decision:choose_change:0',
      'decision:choose_change:1',
      'decision:choose_change:2',
      'tool_failure:lookup_contract',
      'tool_failure:change_wifi_name',
      'tool_failure:change_wifi_password',
      'tool_failure:change_wifi_both',
    ]);
    expect(simulation.cases[0]).toMatchObject({ terminal: 'responded', passed: true });
    expect(simulation.cases.slice(1, 4).every((item) => item.terminal === 'responded' && item.passed)).toBe(true);
    expect(simulation.cases.slice(4).every((item) => item.terminal === 'handoff' && item.passed)).toBe(true);
  });

  it('blocks publication when an API has no explicit failure route', () => {
    const procedure = createWifiCredentialsProcedure(CONFIG_ID, wifiTools);
    const unsafe = {
      ...procedure,
      steps: procedure.steps.map((step) => step.id === 'change_wifi_name' ? { ...step, errorStepId: null } : step),
    };
    const validation = validateProcedureStudioDocument({ procedure: unsafe, tools: wifiTools });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'tool_without_error_route', stepId: 'change_wifi_name' }),
    ]));
  });

  it('blocks an API payload that depends on data missing from one branch', () => {
    const procedure = createWifiCredentialsProcedure(CONFIG_ID, wifiTools);
    const unsafe = {
      ...procedure,
      steps: procedure.steps.map((step) => step.id === 'change_wifi_name'
        ? { ...step, toolPayloadTemplate: { ...step.toolPayloadTemplate, password: '{{wifi_password}}' } }
        : step),
    };
    const validation = validateProcedureStudioDocument({ procedure: unsafe, tools: wifiTools });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsafe_tool_payload_variable', stepId: 'change_wifi_name' }),
    ]));
  });

  it('materializes only published-safe metadata and honors trigger exclusions', () => {
    const graph = materializeProcedureGraph(createWifiCredentialsProcedure(CONFIG_ID, wifiTools), 4, '2026-08-25T12:00:00.000Z');

    expect(graph).toMatchObject({
      version: 4,
      metadata: {
        source: 'procedure_studio',
        priority: 300,
      },
    });
    expect(matchProcedure({
      intent: 'support_request',
      customerMessage: 'Minha internet está lenta',
      compiledProcedures: [graph],
    })).toBeNull();
    expect(matchProcedure({
      intent: 'change_request',
      customerMessage: 'Quero trocar a senha do Wi-Fi',
      compiledProcedures: [graph],
    })?.graph.id).toBe(graph.id);
  });

  it('uses procedure priority to resolve an otherwise identical match', () => {
    const base = materializeProcedureGraph(createWifiCredentialsProcedure(CONFIG_ID, wifiTools), 1, '2026-08-25T12:00:00.000Z');
    const low: ProcedureGraph = { ...base, id: 'proc_low_priority', metadata: { ...base.metadata, priority: 10 } };
    const high: ProcedureGraph = { ...base, id: 'proc_high_priority', metadata: { ...base.metadata, priority: 900 } };

    const match = matchProcedure({
      intent: 'change_request',
      customerMessage: 'Quero alterar o nome e a senha do Wi-Fi',
      compiledProcedures: [low, high],
    });

    expect(match?.graph.id).toBe('proc_high_priority');
  });

  it('forces confirmation for sensitive AI-generated actions and rejects invented tools', () => {
    const highRiskTool = procedureTool({
      name: 'router.change_credentials',
      riskLevel: 'high',
      sideEffect: 'high',
      requiresHumanApproval: true,
    });
    const blueprint = ProcedureAiBlueprintSchema.parse({
      summary: 'Troca dados com confirmação e saída segura.',
      name: 'Alterar roteador',
      description: 'Procedimento criado por IA.',
      goal: 'Alterar os dados do roteador.',
      priority: 200,
      trigger: {
        intents: ['change_request'],
        phrases: ['Quero trocar o nome do Wi-Fi', 'Preciso mudar a senha do Wi-Fi', 'Altere os dados da rede'],
        keywords: ['trocar wifi'],
        exclusions: ['Quero consultar a senha', 'Minha internet está lenta'],
      },
      steps: [
        {
          key: 'execute',
          type: 'tool_call',
          label: 'Alterar roteador',
          instruction: 'Confirma que posso alterar e desconectar os aparelhos?',
          toolName: 'router.change_credentials',
          requiresConfirmation: false,
          successKey: 'done',
          errorKey: 'fallback',
        },
        { key: 'done', type: 'respond', label: 'Confirmar', instruction: 'Alteração confirmada pelo sistema.' },
        { key: 'fallback', type: 'handoff', label: 'Encaminhar', instruction: 'Encaminhe para o suporte técnico.' },
      ],
    });
    const materialized = materializeProcedureAiBlueprint({
      configId: CONFIG_ID,
      procedureId: 'proc_ai_safe',
      blueprint,
      tools: [highRiskTool],
    });
    const toolStep = materialized.procedure.steps.find((step) => step.type === 'tool_call');

    expect(toolStep).toMatchObject({
      toolName: 'router.change_credentials',
      requiresConfirmation: true,
      sideEffect: 'high',
      successStepId: 'done',
      errorStepId: 'fallback',
    });

    const inventedBlueprint = ProcedureAiBlueprintSchema.parse({
      ...blueprint,
      steps: blueprint.steps.map((step) => step.type === 'tool_call' ? { ...step, toolName: 'invented.delete_everything' } : step),
    });
    const invented = materializeProcedureAiBlueprint({
      configId: CONFIG_ID,
      procedureId: 'proc_ai_invented',
      blueprint: inventedBlueprint,
      tools: [highRiskTool],
    });
    const validation = validateProcedureStudioDocument({ procedure: invented.procedure, tools: [highRiskTool] });

    expect(invented.warnings[0]).toContain('não existe');
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'tool_missing')).toBe(true);
  });
});
