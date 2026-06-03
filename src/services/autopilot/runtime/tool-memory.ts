import { db } from '@/lib/db';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';

export function buildMcpResponseFromToolResults(results: AgentToolExecutionResult[]): string | null {
  const mcpResult = results.find((result) => result.toolName.startsWith('mcp:') && result.status === 'success');
  const output = mcpResult?.output as any;
  if (!output) return null;

  if (output.structuredContent && typeof output.structuredContent === 'object') {
    return JSON.stringify(output.structuredContent, null, 2).slice(0, 1800);
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

  return textParts.join('\n\n').trim().slice(0, 1800) || null;
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
  const limit = Math.max(1, Math.min(input.limit || 3, 10));

  try {
    const { rows } = await db.query(
      `SELECT tool_name, status, input, output, error
       FROM public.agent_tool_executions
       WHERE workspace_id = $1
         AND chat_id = $2
         AND tool_name = ANY($3::text[])
         AND status = 'success'
         AND output IS NOT NULL
         AND created_at >= NOW() - ($4::int * interval '1 minute')
       ORDER BY created_at DESC
       LIMIT $5`,
      [input.workspaceId, input.chatId, input.toolNames, maxAgeMinutes, limit],
    );

    return rows.map((row: any): AgentToolExecutionResult => ({
      toolName: String(row.tool_name || '') as AgentToolExecutionResult['toolName'],
      status: (row.status === 'success' ? 'success' : row.status) as AgentToolExecutionResult['status'],
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
