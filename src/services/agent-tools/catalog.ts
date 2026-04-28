import type { AgentToolName } from './types';

export type AgentToolClass =
  | 'read_only'
  | 'compute_only'
  | 'retrieval'
  | 'write_idempotent'
  | 'write_non_idempotent'
  | 'long_running'
  | 'handoff';

export type AgentToolDefinition = {
  name: AgentToolName;
  version: string;
  description: string;
  class: AgentToolClass;
  riskLevel: 'low' | 'medium' | 'high';
  idempotent: boolean;
  timeoutMs: number;
  maxAttempts: number;
  requiresHumanApproval: boolean;
};

const TOOL_CATALOG: Record<AgentToolName, AgentToolDefinition> = {
  transfer_chat: {
    name: 'transfer_chat',
    version: '2026-04-28',
    description: 'Transfere o atendimento para um agente humano ou equipe do workspace.',
    class: 'handoff',
    riskLevel: 'medium',
    idempotent: true,
    timeoutMs: Number.parseInt(process.env.AGENT_TOOL_TRANSFER_TIMEOUT_MS || '', 10) || 8000,
    maxAttempts: 1,
    requiresHumanApproval: false,
  },
  add_internal_note: {
    name: 'add_internal_note',
    version: '2026-04-28',
    description: 'Adiciona nota interna ao atendimento para preservar contexto operacional.',
    class: 'write_idempotent',
    riskLevel: 'low',
    idempotent: true,
    timeoutMs: Number.parseInt(process.env.AGENT_TOOL_NOTE_TIMEOUT_MS || '', 10) || 3000,
    maxAttempts: 1,
    requiresHumanApproval: false,
  },
  crm_update_contact_custom_fields: {
    name: 'crm_update_contact_custom_fields',
    version: '2026-04-28',
    description: 'Atualiza campos customizados do CRM apenas no contato do chat atual.',
    class: 'write_idempotent',
    riskLevel: 'medium',
    idempotent: true,
    timeoutMs: 5000,
    maxAttempts: 1,
    requiresHumanApproval: false,
  },
  sgp_fetch_contracts: {
    name: 'sgp_fetch_contracts',
    version: '2026-04-28',
    description: 'Consulta contratos do cliente no SGP usando o CPF/CNPJ salvo no CRM.',
    class: 'read_only',
    riskLevel: 'low',
    idempotent: true,
    timeoutMs: 8000,
    maxAttempts: 1,
    requiresHumanApproval: false,
  },
  sgp_fetch_contact_panel_data: {
    name: 'sgp_fetch_contact_panel_data',
    version: '2026-04-28',
    description: 'Consulta resumo do cliente, contratos, conexao e faturas no SGP usando o CPF/CNPJ salvo no CRM.',
    class: 'read_only',
    riskLevel: 'low',
    idempotent: true,
    timeoutMs: 10000,
    maxAttempts: 1,
    requiresHumanApproval: false,
  },
  sgp_generate_invoice_pix: {
    name: 'sgp_generate_invoice_pix',
    version: '2026-04-28',
    description: 'Gera codigo PIX de uma fatura SGP existente.',
    class: 'write_idempotent',
    riskLevel: 'medium',
    idempotent: true,
    timeoutMs: 8000,
    maxAttempts: 1,
    requiresHumanApproval: false,
  },
  sgp_create_payment_promise: {
    name: 'sgp_create_payment_promise',
    version: '2026-04-28',
    description: 'Registra promessa de pagamento no SGP para contrato informado.',
    class: 'write_non_idempotent',
    riskLevel: 'high',
    idempotent: false,
    timeoutMs: 10000,
    maxAttempts: 1,
    requiresHumanApproval: false,
  },
  sgp_open_support_ticket: {
    name: 'sgp_open_support_ticket',
    version: '2026-04-28',
    description: 'Bloqueada para IA: abertura de chamado/OS no SGP deve permanecer humana.',
    class: 'write_non_idempotent',
    riskLevel: 'high',
    idempotent: false,
    timeoutMs: 10000,
    maxAttempts: 1,
    requiresHumanApproval: true,
  },
};

export function getAgentToolDefinition(name: AgentToolName): AgentToolDefinition | null {
  return TOOL_CATALOG[name] ?? null;
}

export function listAgentToolDefinitions() {
  return Object.values(TOOL_CATALOG);
}
