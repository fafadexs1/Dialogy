import { describe, expect, it } from 'vitest';

import { compileAutopilotConfigToDomainPack } from '@/services/agent-runtime/domain-packs';
import { evaluateAgentScenario } from '@/services/agent-runtime/evaluation';
import {
  buildUniversalAgentRuntimeContext,
  getAgentDomainReadiness,
} from '@/services/agent-runtime/prompt-context';
import type { AgentDomainPack, AgentTaskExecution } from '@/services/agent-runtime/types';

function domainPack(overrides: Partial<AgentDomainPack> = {}): AgentDomainPack {
  return {
    id: 'pack-health-v2',
    workspaceId: 'workspace-1',
    slug: 'clinica-horizonte',
    name: 'Clínica Horizonte',
    version: 2,
    status: 'published',
    definition: {
      identity: {
        businessName: 'Clínica Horizonte',
        niche: 'saúde',
        description: 'Atendimento administrativo para consultas e exames.',
      },
      goals: [{ id: 'reschedule_appointment', label: 'Reagendar consulta' }],
      procedures: [{ id: 'reschedule', name: 'Reagendamento seguro', version: 1, definition: { steps: ['consultar', 'oferecer', 'confirmar'] } }],
      policies: [{ id: 'no_diagnosis', rule: 'Não realizar diagnóstico clínico.', severity: 'critical' }],
      toolNames: ['lookup_appointments', 'check_availability', 'change_appointment'],
      knowledgeSourceIds: ['clinic-policy'],
      responseStyle: { language: 'pt-BR', tone: 'acolhedor e objetivo' },
    },
    createdByUserId: 'user-1',
    publishedAt: '2026-08-24T12:00:00.000Z',
    createdAt: '2026-08-24T12:00:00.000Z',
    updatedAt: '2026-08-24T12:00:00.000Z',
    ...overrides,
  };
}

function activeTask(): AgentTaskExecution {
  return {
    id: 'task-1',
    workspaceId: 'workspace-1',
    chatId: 'chat-1',
    orchestratorRunId: 'run-1',
    systemAgentId: 'agent-1',
    autopilotConfigId: 'config-1',
    domainPackId: 'pack-health-v2',
    goal: 'Reagendar a consulta sem perder a vaga atual',
    goalKey: 'reschedule_appointment',
    procedureId: 'reschedule',
    procedureVersion: 1,
    currentStepId: 'check_availability',
    status: 'active',
    state: {
      taskPlan: {
        currentStep: 'Consultar horários disponíveis',
        nextSteps: [{ id: 'offer_options', label: 'Oferecer opções', status: 'ready' }],
      },
    },
    slots: {},
    confirmations: {},
    decisions: {},
    toolResults: { lookup_appointments: { status: 'success' } },
    nextAction: null,
    activeInterruptionId: null,
    version: 3,
    createdAt: '2026-08-24T12:00:00.000Z',
    updatedAt: '2026-08-24T12:03:00.000Z',
    completedAt: null,
  };
}

describe('universal agent neutrality and complex-task context', () => {
  it('stays sector-neutral when no published context exists', () => {
    const context = buildUniversalAgentRuntimeContext({ fallbackAgentName: 'Atendente Inteligente' }).toLowerCase();

    expect(context).toContain('modo de contexto: universal neutro');
    for (const leakedAssumption of ['telecom', 'internet', 'roteador', 'fibra', 'provedor']) {
      expect(context).not.toContain(leakedAssumption);
    }
  });

  it('injects only the active pack and the capabilities allowed in the turn', () => {
    const context = buildUniversalAgentRuntimeContext({
      domainPack: domainPack(),
      enabledToolNames: ['lookup_appointments', 'check_availability'],
    });

    expect(context).toContain('Clínica Horizonte');
    expect(context).toContain('Reagendamento seguro');
    expect(context).toContain('lookup_appointments');
    expect(context).not.toContain('change_appointment');
  });

  it('carries goal, current step, prior evidence and plan across turns', () => {
    const context = buildUniversalAgentRuntimeContext({
      domainPack: domainPack(),
      task: activeTask(),
      enabledToolNames: ['lookup_appointments'],
    });

    expect(context).toContain('Reagendar a consulta sem perder a vaga atual');
    expect(context).toContain('check_availability');
    expect(context).toContain('lookup_appointments');
    expect(context).toContain('offer_options');
  });

  it('does not promote an old mixed knowledge base into the agent identity', () => {
    const definition = compileAutopilotConfigToDomainPack({
      id: 'config-legacy',
      name: 'Agente Universal',
      knowledgeBase: 'Conteúdo legado com exemplos de um setor antigo que não define este agente.',
      enabledToolNames: [],
    });

    expect(definition.identity?.businessName).toBe('Agente Universal');
    expect(definition.identity?.description).toBeUndefined();
    expect(definition.metadata).toMatchObject({
      compiler: 'autopilot_config_to_agent_domain_pack_v2',
      identitySource: 'neutral_default',
    });
  });

  it('makes readiness gaps explicit for the visual cockpit', () => {
    const readiness = getAgentDomainReadiness(domainPack().definition);

    expect(readiness.score).toBe(100);
    expect(readiness.items.map((item) => item.id)).toEqual([
      'identity', 'knowledge', 'capabilities', 'procedures', 'policies',
    ]);
  });

  it('evaluates plan depth and cross-domain leakage', () => {
    const result = evaluateAgentScenario({
      scenario: {
        id: 'clinic-complex',
        name: 'Reagendamento',
        niche: 'saúde',
        input: 'Quero reagendar.',
        minimumPlanSteps: 3,
        forbiddenAssumptions: ['roteador', 'plano de internet'],
      },
      observation: {
        response: 'Vou consultar a agenda e trazer opções de horário.',
        plannedSteps: ['consultar reserva atual', 'buscar horários', 'confirmar alteração'],
      },
    });

    expect(result.passed).toBe(true);
  });
});
