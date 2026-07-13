import { db } from '@/lib/db';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';

export type ContactVerificationReceipt = {
  toolName: string;
  chatId: string;
  scope: 'contact_identity_context';
  verifiedAt: string;
  expiresAt: string;
  source: 'successful_tool_execution';
};

export function isContactIdentityVerificationToolName(toolName: string): boolean {
  const normalized = toolName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
  if (['sgp_fetch_contracts', 'sgp_fetch_contact_panel_data'].includes(normalized)) return true;
  return (
    /(?:verify|validate|lookup|find|fetch|get|search|buscar|consultar|localizar)_(?:customer|client|contact|account|subscriber|member|cliente|contato|assinante|cadastro)(?:_|$)/.test(normalized)
    || /(?:customer|client|contact|account|subscriber|member|cliente|contato|assinante|cadastro)_(?:profile|identity|details|record|contracts|perfil|identidade|dados|contratos)(?:_|$)/.test(normalized)
  );
}

/**
 * Loads only the fact that an identity/contact lookup succeeded for the same
 * CRM contact. Volatile tool output is deliberately excluded.
 */
export async function loadRecentContactVerificationReceipts(input: {
  workspaceId: string;
  contactId: string;
  toolNames: string[];
  maxAgeDays?: number;
  limit?: number;
}): Promise<ContactVerificationReceipt[]> {
  const toolNames = [...new Set(input.toolNames.filter(isContactIdentityVerificationToolName))];
  if (!input.contactId || toolNames.length === 0) return [];
  const maxAgeDays = Math.max(1, Math.min(input.maxAgeDays || 30, 90));
  const limit = Math.max(1, Math.min(input.limit || 8, 20));
  try {
    const { rows } = await db.query(
      `SELECT execution.tool_name, execution.chat_id, execution.created_at
         FROM public.agent_tool_executions execution
         JOIN public.chats chat ON chat.id = execution.chat_id
        WHERE execution.workspace_id = $1
          AND chat.contact_id = $2
          AND execution.tool_name = ANY($3::text[])
          AND execution.status = 'success'
          AND execution.created_at >= clock_timestamp() - ($4::int * INTERVAL '1 day')
        ORDER BY execution.created_at DESC
        LIMIT $5`,
      [input.workspaceId, input.contactId, toolNames, maxAgeDays, limit],
    );
    const seen = new Set<string>();
    return rows.flatMap((row: any) => {
      const toolName = String(row.tool_name || '').trim();
      const chatId = String(row.chat_id || '').trim();
      const verifiedAtDate = new Date(row.created_at);
      if (!toolName || !chatId || !Number.isFinite(verifiedAtDate.getTime()) || seen.has(toolName)) return [];
      seen.add(toolName);
      return [{
        toolName,
        chatId,
        scope: 'contact_identity_context' as const,
        verifiedAt: verifiedAtDate.toISOString(),
        expiresAt: new Date(verifiedAtDate.getTime() + maxAgeDays * 24 * 60 * 60 * 1000).toISOString(),
        source: 'successful_tool_execution' as const,
      }];
    });
  } catch (error) {
    console.warn('[AUTOPILOT_VERIFICATION_MEMORY] Failed to load contact verification receipts:', error);
    return [];
  }
}

const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  id: 'ID',
  name: 'Nome',
  title: 'Titulo',
  description: 'Descricao',
  status: 'Status',
  price: 'Preco',
  amount: 'Valor',
  availability: 'Disponibilidade',
  available: 'Disponivel',
  stock: 'Estoque',
  date: 'Data',
  time: 'Horario',
  protocol: 'Protocolo',
  order_id: 'Pedido',
  request_id: 'Solicitacao',
  package_code: 'Codigo do pacote',
  pickup_window: 'Janela de coleta',
  tracking_code: 'Codigo de rastreio',
  updated_at: 'Atualizado em',
  ssid: 'Rede Wi-Fi',
  username: 'Usuario',
  password: 'Senha',
};

function customerFieldLabel(key: string): string {
  return CUSTOMER_FIELD_LABELS[key] || key
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (character) => character.toUpperCase());
}

function customerPrimitive(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 'sim' : 'nao';
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text || null;
}

function customerRecordLine(value: unknown): string | null {
  const primitive = customerPrimitive(value);
  if (primitive) return primitive;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const parts = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/\b(raw|stack|command_id|access_token|secret|internal)\b/i.test(key))
    .map(([key, nested]) => {
      const text = customerPrimitive(nested);
      return text ? `${customerFieldLabel(key)}: ${text}` : null;
    })
    .filter((part): part is string => Boolean(part))
    .slice(0, 8);
  return parts.length > 0 ? parts.join(' - ') : null;
}

export function formatMcpStructuredOutputForCustomer(value: unknown): string | null {
  if (!value || typeof value !== 'object') return customerPrimitive(value);
  const record = value as Record<string, unknown>;
  const preferredArrays = [
    'items',
    'products',
    'services',
    'plans',
    'results',
    'availability',
    'slots',
    'documents',
  ];
  const list = Array.isArray(value)
    ? value
    : preferredArrays.map((key) => record[key]).find(Array.isArray)
      || Object.values(record).find(Array.isArray);
  if (Array.isArray(list)) {
    const lines = list
      .slice(0, 8)
      .map(customerRecordLine)
      .filter((line): line is string => Boolean(line));
    return lines.length > 0
      ? ['Consultei as informacoes solicitadas:', ...lines.map((line) => `- ${line}`)].join('\n')
      : null;
  }

  const lines = Object.entries(record)
    .filter(([key]) => !/\b(raw|stack|command_id|access_token|secret|internal)\b/i.test(key))
    .map(([key, nested]) => {
      const primitive = customerPrimitive(nested);
      if (primitive) return `${customerFieldLabel(key)}: ${primitive}`;
      const nestedLine = customerRecordLine(nested);
      return nestedLine ? `${customerFieldLabel(key)}: ${nestedLine}` : null;
    })
    .filter((line): line is string => Boolean(line))
    .slice(0, 10);
  return lines.length > 0 ? lines.join('\n') : null;
}

export function buildMcpResponseFromToolResults(results: AgentToolExecutionResult[]): string | null {
  const mcpResult = results.find((result) => result.toolName.startsWith('mcp:') && result.status === 'success');
  const output = mcpResult?.output as any;
  if (!output) return null;

  if (output.structuredContent && typeof output.structuredContent === 'object') {
    return formatMcpStructuredOutputForCustomer(output.structuredContent)?.slice(0, 1800) || null;
  }

  const textParts = Array.isArray(output.content)
    ? output.content
      .map((item: any) => {
        if (item?.type === 'text' && typeof item.text === 'string') return item.text;
        if (typeof item === 'string') return item;
        return null;
      })
      .filter(Boolean)
    : [];

  const text = textParts.join('\n\n').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return formatMcpStructuredOutputForCustomer(parsed)?.slice(0, 1800) || null;
  } catch {
    return text.slice(0, 1800);
  }
}

export function compactToolOutputForContinuation(result: AgentToolExecutionResult): Record<string, unknown> {
  const output = (result.output || {}) as any;

  if (result.toolName === 'sgp_fetch_contact_panel_data') {
    const contracts = Array.isArray(output.contracts) ? output.contracts : [];
    return {
      customerName: output.customerName || null,
      cpfCnpj: output.cpfCnpj || null,
      contracts: contracts.slice(0, 8).map((contract: any) => ({
        id: contract.id,
        planDescription: contract.planDescription,
        connectionStatus: contract.connectionStatus,
        statusLabel: contract.statusLabel,
        addressLabel: contract.addressLabel,
        ip: contract.ip,
        ipv6: contract.ipv6,
        login: contract.login,
      })),
      invoiceGroups: Array.isArray(output.invoiceGroups)
        ? output.invoiceGroups.slice(0, 8).map((group: any) => ({
          contractId: group.contractId,
          title: group.title,
          summary: group.summary,
        }))
        : [],
    };
  }

  if (result.toolName.startsWith('mcp:')) {
    return {
      content: output.content || null,
      structuredContent: output.structuredContent || null,
      isError: output.isError || false,
    };
  }

  return output;
}

export function buildToolContinuationContext(results: AgentToolExecutionResult[]): string {
  const successfulResults = results.filter((result) => result.status === 'success');
  if (successfulResults.length === 0) return '';

  const payload = successfulResults.map((result) => ({
    toolName: result.toolName,
    output: compactToolOutputForContinuation(result),
  }));

  return [
    '[RESULTADOS DE FERRAMENTAS JA EXECUTADAS]',
    JSON.stringify(payload).slice(0, 5000),
    'REGRAS RIGIDAS: use exclusivamente fatos presentes nesses resultados. Nunca invente, complete ou sugira links, protocolos, prazos, procedimentos, disponibilidade, diagnosticos, valores ou datas ausentes. Nao exponha JSON, nomes internos de campos ou timestamps ISO brutos. Converta datas para dd/MM/yyyy e data-hora para dd/MM/yyyy HH:mm. Se faltar informacao, diga apenas que ela nao esta disponivel e que sera necessario verificar manualmente.',
    'Use estes dados para decidir se ainda falta executar a proxima @tool obrigatoria do procedimento. Se faltar, retorne a proxima action agora. Se o procedimento ja terminou, responda ao cliente apenas com o resultado concreto permitido pelas regras acima.',
  ].join('\n');
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function loadRecentToolResultsForAutopilot(input: {
  workspaceId: string;
  chatId: string;
  toolNames: string[];
  maxAgeMinutes?: number;
  limit?: number;
}): Promise<AgentToolExecutionResult[]> {
  if (input.toolNames.length === 0) return [];

  const maxAgeMinutes = Math.max(1, Math.min(input.maxAgeMinutes || 30, 180));
  const limit = Math.max(1, Math.min(input.limit || 3, 40));

  try {
    const { rows } = await db.query(
      `SELECT tool_name, status, input, output, error
       FROM (
         SELECT tool_name, status, input, output, error, created_at
         FROM public.agent_tool_executions
         WHERE workspace_id = $1
           AND chat_id = $2
           AND tool_name = ANY($3::text[])
           AND status IN ('success', 'error', 'rejected')
           AND (output IS NOT NULL OR error IS NOT NULL)
           AND created_at >= NOW() - ($4::int * interval '1 minute')
         ORDER BY created_at DESC
         LIMIT $5
       ) recent_tool_results
       ORDER BY created_at ASC`,
      [input.workspaceId, input.chatId, input.toolNames, maxAgeMinutes, limit],
    );

    return rows.map((row: any): AgentToolExecutionResult => ({
      toolName: String(row.tool_name || '') as AgentToolExecutionResult['toolName'],
      status: (['success', 'error', 'rejected'].includes(String(row.status)) ? row.status : 'error') as AgentToolExecutionResult['status'],
      input: (parseJsonRecord(row.input) || {
        type: String(row.tool_name || ''),
        payload: {},
      }) as AgentToolAction,
      output: parseJsonRecord(row.output) || row.output || null,
      error: row.error || undefined,
    })).filter((result) => Boolean(result.toolName));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/agent_tool_executions/i.test(message)) {
      console.warn('[AUTOPILOT_TOOL_MEMORY] Failed to load recent tool results:', error);
    }
    return [];
  }
}

export function buildRecentToolMemoryContext(results: AgentToolExecutionResult[]): string {
  const successfulResults = results.filter((result) => result.status === 'success');
  if (successfulResults.length === 0) return '';

  const payload = successfulResults.map((result) => ({
    toolName: result.toolName,
    output: compactToolOutputForContinuation(result),
  }));

  return [
    '[MEMORIA OPERACIONAL RECENTE DO CHAT]',
    JSON.stringify(payload).slice(0, 5000),
    'REGRAS RIGIDAS: use exclusivamente fatos presentes nesses resultados. Nunca invente, complete ou sugira links, protocolos, prazos, procedimentos, disponibilidade, diagnosticos, valores ou datas ausentes. Nao exponha JSON, nomes internos de campos ou timestamps ISO brutos. Converta datas para dd/MM/yyyy e data-hora para dd/MM/yyyy HH:mm. Se faltar informacao, diga apenas que ela nao esta disponivel e que sera necessario verificar manualmente.',
    'Estes dados vieram de ferramentas executadas recentemente neste mesmo atendimento. Use-os para responder follow-ups sem pedir CPF/CNPJ de novo quando a pergunta puder ser respondida com esta memoria. Se o cliente pedir uma atualizacao em tempo real ou uma acao nova, execute a ferramenta apropriada.',
  ].join('\n');
}

export function shouldAnswerFromRecentToolMemory(input: {
  customerMessage: string;
  intent: string;
  recentToolResults: AgentToolExecutionResult[];
}): boolean {
  if (!input.recentToolResults.some((result) => (
    result.status === 'success' &&
    (result.toolName === 'sgp_fetch_contact_panel_data' || result.toolName === 'sgp_fetch_contracts')
  ))) {
    return false;
  }

  if (!['billing_or_payment', 'support_request', 'troubleshooting', 'document_request', 'order_or_request_status'].includes(input.intent)) {
    return false;
  }

  const normalized = input.customerMessage
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const isReadOnlyQuestion = /\b(quais|quantos?|qual|listar|lista|mostra|mostrar|ver|saber|informacoes?|dados|status|situacao|tenho)\b/.test(normalized);
  const mentionsKnownDomain = /\b(contratos?|pontos? de internet|pontos?|internet|conexao|cadastro|faturas?|boletos?|pagamento)\b/.test(normalized);
  const asksForNewAction = /\b(gerar|pagar|pix|promessa|liberar|desbloquear|reiniciar|reinicializar|resetar|abrir chamado|alterar|trocar|cancelar|contratar)\b/.test(normalized);

  return isReadOnlyQuestion && mentionsKnownDomain && !asksForNewAction;
}
