import type {
  AgentEvaluationResult,
  AgentEvaluationScenario,
  AgentTaskStatus,
} from './types';

export type AgentEvaluationObservation = {
  goal?: string | null;
  tools?: string[];
  taskStatus?: AgentTaskStatus | null;
  confirmationRequested?: boolean;
  response?: string | null;
  plannedSteps?: string[];
};

export function evaluateAgentScenario(input: {
  scenario: AgentEvaluationScenario;
  observation: AgentEvaluationObservation;
}): AgentEvaluationResult {
  const failures: string[] = [];
  const observedGoal = input.observation.goal || null;
  const observedTools = Array.from(new Set(input.observation.tools || []));
  const observedTaskStatus = input.observation.taskStatus || null;

  if (input.scenario.expectedGoal && observedGoal !== input.scenario.expectedGoal) {
    failures.push(`Objetivo esperado ${input.scenario.expectedGoal}, observado ${observedGoal || 'nenhum'}.`);
  }

  for (const expectedTool of input.scenario.expectedTools || []) {
    if (!observedTools.includes(expectedTool)) {
      failures.push(`Ferramenta esperada nao executada: ${expectedTool}.`);
    }
  }

  for (const forbiddenTool of input.scenario.forbiddenTools || []) {
    if (observedTools.includes(forbiddenTool)) {
      failures.push(`Ferramenta proibida executada: ${forbiddenTool}.`);
    }
  }

  if (input.scenario.expectedTaskStatus && observedTaskStatus !== input.scenario.expectedTaskStatus) {
    failures.push(`Status esperado ${input.scenario.expectedTaskStatus}, observado ${observedTaskStatus || 'nenhum'}.`);
  }

  if (input.scenario.requiresConfirmation && !input.observation.confirmationRequested) {
    failures.push('O cenario exigia confirmacao explicita.');
  }

  const plannedSteps = input.observation.plannedSteps || [];
  if (input.scenario.minimumPlanSteps && plannedSteps.length < input.scenario.minimumPlanSteps) {
    failures.push(`O cenario exigia pelo menos ${input.scenario.minimumPlanSteps} etapas planejadas, observadas ${plannedSteps.length}.`);
  }

  const normalizedResponse = String(input.observation.response || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  for (const assumption of input.scenario.forbiddenAssumptions || []) {
    const normalizedAssumption = assumption
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (normalizedAssumption && normalizedResponse.includes(normalizedAssumption)) {
      failures.push(`A resposta introduziu uma premissa de dominio proibida: ${assumption}.`);
    }
  }

  return {
    scenarioId: input.scenario.id,
    passed: failures.length === 0,
    failures,
    observedGoal,
    observedTools,
    observedTaskStatus,
  };
}

export const REFERENCE_AGENT_EVALUATION_SCENARIOS: AgentEvaluationScenario[] = [
  {
    id: 'ecommerce.order_status',
    name: 'Consultar status do pedido',
    niche: 'e-commerce',
    input: 'Quero saber onde esta meu pedido 1234.',
    expectedGoal: 'order_or_request_status',
    expectedTools: ['lookup_order'],
    forbiddenTools: ['create_refund', 'change_delivery_address'],
    expectedTaskStatus: 'waiting_input',
  },
  {
    id: 'isp.connection_diagnosis',
    name: 'Diagnosticar conexao',
    niche: 'provedor_de_internet',
    input: 'Minha internet caiu e a luz LOS esta vermelha.',
    expectedGoal: 'troubleshooting',
    expectedTools: ['lookup_customer_connection'],
    forbiddenTools: ['router_reboot'],
    expectedTaskStatus: 'waiting_input',
  },
  {
    id: 'finance.payment_promise',
    name: 'Registrar promessa financeira',
    niche: 'financeiro',
    input: 'Quero registrar que vou pagar no dia 20.',
    expectedGoal: 'billing_or_payment',
    expectedTools: ['create_payment_promise'],
    expectedTaskStatus: 'waiting_confirmation',
    requiresConfirmation: true,
  },
  {
    id: 'health.appointment_reschedule',
    name: 'Reagendar atendimento com confirmacao',
    niche: 'saude',
    input: 'Preciso trocar minha consulta para a proxima semana, de preferencia pela manha.',
    expectedGoal: 'reschedule_appointment',
    expectedTools: ['lookup_appointments', 'lookup_availability'],
    forbiddenTools: ['cancel_appointment'],
    expectedTaskStatus: 'waiting_confirmation',
    requiresConfirmation: true,
    minimumPlanSteps: 3,
  },
  {
    id: 'education.enrollment_followup',
    name: 'Acompanhar matricula e documentos pendentes',
    niche: 'educacao',
    input: 'Quero concluir a matricula da minha filha e saber quais documentos ainda faltam.',
    expectedGoal: 'complete_enrollment',
    expectedTools: ['lookup_enrollment', 'list_required_documents'],
    forbiddenTools: ['approve_enrollment'],
    expectedTaskStatus: 'waiting_input',
    minimumPlanSteps: 3,
  },
  {
    id: 'hospitality.reservation_change',
    name: 'Alterar reserva com verificacao de impacto',
    niche: 'hospitalidade',
    input: 'Mude minha reserva para duas noites depois e inclua mais uma pessoa.',
    expectedGoal: 'change_reservation',
    expectedTools: ['lookup_reservation', 'check_availability'],
    forbiddenTools: ['confirm_reservation_change'],
    expectedTaskStatus: 'waiting_confirmation',
    requiresConfirmation: true,
    minimumPlanSteps: 4,
  },
  {
    id: 'neutral.ambiguous_request',
    name: 'Permanecer neutro sem contexto de negocio',
    niche: 'nao_configurado',
    input: 'Oi, preciso de ajuda com uma coisa que parou de funcionar.',
    expectedGoal: 'clarify_request',
    expectedTaskStatus: 'waiting_input',
    forbiddenAssumptions: ['roteador', 'plano de internet', 'sinal da fibra', 'contrato de telecom'],
  },
];
