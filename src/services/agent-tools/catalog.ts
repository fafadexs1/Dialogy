import type { AgentToolName } from './types';
import type { AutopilotSlotName, UniversalAutopilotIntent } from '@/services/autopilot/intent-types';
import { resolveMcpToolTimeoutMs } from '@/services/mcp/tool-safety';

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
  displayName?: string;
  category?: 'attendance' | 'crm' | 'sgp' | 'mcp' | 'other';
  version: string;
  description: string;
  class: AgentToolClass;
  riskLevel: 'low' | 'medium' | 'high';
  sideEffect: 'none' | 'low' | 'medium' | 'high';
  idempotent: boolean;
  timeoutMs: number;
  maxAttempts: number;
  requiresHumanApproval: boolean;
  customerVisible: boolean;
  allowedIntents: UniversalAutopilotIntent[];
  requiredSlots: AutopilotSlotName[];
  fallbackAction: 'drop' | 'ask_missing_slot' | 'handoff' | 'configured_fallback';
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
};

export type AgentToolCatalogItem = AgentToolDefinition & {
  source: 'dialogy' | 'mcp';
  enabledByDefault: boolean;
  serverId?: string;
  serverName?: string;
  inputSchema?: Record<string, unknown> | null;
};

function boundedTimeoutMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(5_000, Math.min(120_000, Math.trunc(parsed)));
}

const TOOL_CATALOG: Record<AgentToolName, AgentToolDefinition> = {
  transfer_chat: {
    name: 'transfer_chat',
    displayName: 'Transferir atendimento',
    category: 'attendance',
    version: '2026-04-28',
    description: 'Transfere o atendimento para um agente humano ou equipe do workspace.',
    class: 'handoff',
    riskLevel: 'medium',
    sideEffect: 'medium',
    idempotent: true,
    timeoutMs: Number.parseInt(process.env.AGENT_TOOL_TRANSFER_TIMEOUT_MS || '', 10) || 8000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: [
      'human_handoff',
      'complaint',
      'billing_or_payment',
      'support_request',
      'troubleshooting',
      'cancellation_request',
      'return_or_refund',
      'change_request',
      'document_request',
      'order_or_request_status',
      'unknown',
    ],
    requiredSlots: [],
    fallbackAction: 'configured_fallback',
  },
  close_chat: {
    name: 'close_chat',
    displayName: 'Encerrar conversa',
    category: 'attendance',
    version: '2026-05-09',
    description: 'Encerra o atendimento atual quando o cliente pede explicitamente para finalizar a conversa.',
    class: 'write_non_idempotent',
    riskLevel: 'medium',
    sideEffect: 'high',
    idempotent: true,
    timeoutMs: Number.parseInt(process.env.AGENT_TOOL_CLOSE_TIMEOUT_MS || '', 10) || 8000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: [
      'thanks',
      'unknown',
      'cancellation_request',
      'complaint',
      'support_request',
      'purchase_inquiry',
      'catalog_request',
      'pricing_request',
      'promotion_request',
      'availability_request',
      'billing_or_payment',
      'order_or_request_status',
      'document_request',
      'human_handoff',
    ],
    requiredSlots: [],
    fallbackAction: 'drop',
    inputSchema: {
      type: 'object',
      properties: {
        reasonTagId: { type: ['string', 'null'], description: 'ID opcional da tag de motivo de encerramento.' },
        notes: { type: ['string', 'null'], description: 'Observacao opcional para close_notes.' },
        sendCloseMessage: {
          type: ['boolean', 'null'],
          description: 'Quando true, envia o template de encerramento do workspace apos fechar.',
        },
      },
    },
  },
  add_internal_note: {
    name: 'add_internal_note',
    displayName: 'Adicionar nota interna',
    category: 'attendance',
    version: '2026-04-28',
    description: 'Adiciona nota interna ao atendimento para preservar contexto operacional.',
    class: 'write_idempotent',
    riskLevel: 'low',
    sideEffect: 'low',
    idempotent: true,
    timeoutMs: Number.parseInt(process.env.AGENT_TOOL_NOTE_TIMEOUT_MS || '', 10) || 3000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: false,
    allowedIntents: [
      'human_handoff',
      'complaint',
      'billing_or_payment',
      'support_request',
      'troubleshooting',
      'cancellation_request',
      'return_or_refund',
      'change_request',
      'document_request',
      'order_or_request_status',
      'unknown',
    ],
    requiredSlots: [],
    fallbackAction: 'drop',
  },
  crm_update_contact_custom_fields: {
    name: 'crm_update_contact_custom_fields',
    displayName: 'Atualizar dados do contato',
    category: 'crm',
    version: '2026-04-28',
    description: 'Atualiza campos customizados do CRM apenas no contato do chat atual.',
    class: 'write_idempotent',
    riskLevel: 'medium',
    sideEffect: 'low',
    idempotent: true,
    timeoutMs: 5000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: false,
    allowedIntents: [
      'billing_or_payment',
      'support_request',
      'troubleshooting',
      'order_or_request_status',
      'scheduling_request',
      'document_request',
      'change_request',
      'human_handoff',
      'unknown',
    ],
    requiredSlots: [],
    fallbackAction: 'drop',
  },
  sgp_fetch_contracts: {
    name: 'sgp_fetch_contracts',
    displayName: 'Consultar contratos no SGP',
    category: 'sgp',
    version: '2026-04-28',
    description: 'Consulta contratos do cliente no SGP usando o CPF/CNPJ salvo no CRM.',
    class: 'read_only',
    riskLevel: 'low',
    sideEffect: 'none',
    idempotent: true,
    timeoutMs: 8000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: false,
    allowedIntents: [
      'billing_or_payment',
      'support_request',
      'troubleshooting',
      'order_or_request_status',
      'document_request',
      'purchase_inquiry',
      'availability_request',
      'unknown',
    ],
    requiredSlots: ['customer_identifier'],
    fallbackAction: 'ask_missing_slot',
  },
  sgp_fetch_contact_panel_data: {
    name: 'sgp_fetch_contact_panel_data',
    displayName: 'Consultar painel do cliente no SGP',
    category: 'sgp',
    version: '2026-04-28',
    description: 'Consulta resumo do cliente, contratos, conexao e faturas no SGP usando o CPF/CNPJ salvo no CRM. Aceita contractId opcional para restringir a consulta de suporte a um contrato especifico.',
    class: 'read_only',
    riskLevel: 'low',
    sideEffect: 'none',
    idempotent: true,
    timeoutMs: boundedTimeoutMs(
      process.env.SGP_CONTACT_PANEL_TOOL_TIMEOUT_MS,
      30_000,
    ),
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: false,
    allowedIntents: [
      'billing_or_payment',
      'support_request',
      'troubleshooting',
      'order_or_request_status',
      'document_request',
      'purchase_inquiry',
      'availability_request',
      'unknown',
    ],
    requiredSlots: ['customer_identifier'],
    fallbackAction: 'ask_missing_slot',
    inputSchema: {
      type: 'object',
      properties: {
        contractId: {
          type: ['string', 'null'],
          description: 'ID opcional de um contrato SGP especifico. Quando informado, deve ser real e conter somente digitos.',
        },
      },
    },
  },
  sgp_generate_invoice_pix: {
    name: 'sgp_generate_invoice_pix',
    displayName: 'Gerar PIX de uma fatura',
    category: 'sgp',
    version: '2026-04-28',
    description: 'Gera PIX somente quando uma consulta atual de sgp_fetch_contact_panel_data nao retornou pixCode para a fatura solicitada. Consulte primeiro, identifique invoiceId e contractId reais e confirme qual fatura o cliente quer quando houver ambiguidade. Se pixCode ja existir, entregue esse codigo sem gerar outro.',
    class: 'write_idempotent',
    riskLevel: 'medium',
    sideEffect: 'medium',
    idempotent: true,
    timeoutMs: 8000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: ['billing_or_payment'],
    requiredSlots: ['customer_identifier', 'invoice_or_payment_id'],
    fallbackAction: 'ask_missing_slot',
    inputSchema: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', pattern: '^\\d+$', description: 'ID real da fatura em aberto retornada pela consulta atual ao SGP.' },
        contractId: { type: 'string', pattern: '^\\d+$', description: 'ID real do contrato ao qual pertence a fatura consultada.' },
      },
      required: ['invoiceId', 'contractId'],
      additionalProperties: false,
    },
  },
  sgp_create_payment_promise: {
    name: 'sgp_create_payment_promise',
    displayName: 'Registrar promessa de pagamento',
    category: 'sgp',
    version: '2026-04-28',
    description: 'Registra promessa de pagamento no SGP para contrato informado.',
    class: 'write_non_idempotent',
    riskLevel: 'high',
    sideEffect: 'high',
    idempotent: false,
    timeoutMs: 10000,
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: ['billing_or_payment'],
    requiredSlots: ['customer_identifier', 'date'],
    fallbackAction: 'ask_missing_slot',
  },
  sgp_open_support_ticket: {
    name: 'sgp_open_support_ticket',
    displayName: 'Abrir chamado no SGP',
    category: 'sgp',
    version: '2026-04-28',
    description: 'Bloqueada para IA: abertura de chamado/OS no SGP deve permanecer humana.',
    class: 'write_non_idempotent',
    riskLevel: 'high',
    sideEffect: 'high',
    idempotent: false,
    timeoutMs: 10000,
    maxAttempts: 1,
    requiresHumanApproval: true,
    customerVisible: true,
    allowedIntents: [],
    requiredSlots: ['customer_identifier'],
    fallbackAction: 'handoff',
  },
  mcp_call_tool: {
    name: 'mcp_call_tool',
    displayName: 'Executar ferramenta MCP',
    category: 'mcp',
    version: '2026-04-30',
    description: 'Executa uma ferramenta externa descoberta via MCP quando ela estiver habilitada no agente.',
    class: 'retrieval',
    riskLevel: 'medium',
    sideEffect: 'medium',
    idempotent: false,
    timeoutMs: resolveMcpToolTimeoutMs(),
    maxAttempts: 1,
    requiresHumanApproval: false,
    customerVisible: true,
    allowedIntents: [
      'purchase_inquiry',
      'catalog_request',
      'pricing_request',
      'promotion_request',
      'availability_request',
      'billing_or_payment',
      'scheduling_request',
      'order_or_request_status',
      'support_request',
      'troubleshooting',
      'change_request',
      'return_or_refund',
      'cancellation_request',
      'document_request',
      'complaint',
    ],
    requiredSlots: [],
    fallbackAction: 'handoff',
  },
};

export function getAgentToolDefinition(name: AgentToolName): AgentToolDefinition | null {
  return TOOL_CATALOG[name] ?? null;
}

export function listAgentToolDefinitions() {
  return Object.values(TOOL_CATALOG);
}

/**
 * Tools with no permitted intent are intentionally blocked operations. They
 * must stay visible to administrators when needed, but never be offered in a
 * model output schema where choosing one would guarantee a rejection.
 */
export function listModelCallableAgentToolDefinitions() {
  return listAgentToolDefinitions().filter((definition) => definition.allowedIntents.length > 0);
}

export function listAgentToolCatalogItems(): AgentToolCatalogItem[] {
  return listAgentToolDefinitions()
    .filter((definition) => definition.name !== 'mcp_call_tool')
    .map((definition) => ({
    ...definition,
    source: 'dialogy',
    enabledByDefault: false,
  }));
}
