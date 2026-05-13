import type { AgentToolExecutionResult } from '@/services/agent-tools/types';

export const PROCEDURE_SLIM_LIMITS = {
  chatHistoryLines: 8,
  chatHistoryChars: 1200,
  personaChars: 800,
  toolResultsChars: 3500,
  toolOutputChars: 1400,
};

export function compactProcedureText(value: unknown, maxChars: number): string {
  const normalized = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized || maxChars <= 0) return '';
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 3) return normalized.slice(0, maxChars);
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

export function buildProcedureSlimChatHistory(
  chatHistory: string,
  input?: {
    maxLines?: number;
    maxChars?: number;
  },
): string {
  const maxLines = input?.maxLines ?? PROCEDURE_SLIM_LIMITS.chatHistoryLines;
  const maxChars = input?.maxChars ?? PROCEDURE_SLIM_LIMITS.chatHistoryChars;
  const lines = String(chatHistory || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-Math.max(1, maxLines));

  return compactProcedureText(lines.join('\n'), maxChars);
}

function compactToolOutput(result: AgentToolExecutionResult): Record<string, unknown> | null {
  const output = result.output || null;
  if (!output || typeof output !== 'object') return output as Record<string, unknown> | null;
  const raw = output as Record<string, any>;

  if (result.toolName === 'sgp_fetch_contact_panel_data') {
    const contracts = Array.isArray(raw.contracts) ? raw.contracts : [];
    const invoiceGroups = Array.isArray(raw.invoiceGroups) ? raw.invoiceGroups : [];
    return {
      customerName: raw.customerName || null,
      cpfCnpj: raw.cpfCnpj || null,
      contracts: contracts.slice(0, 5).map((contract: any) => ({
        id: contract.id,
        planDescription: contract.planDescription,
        connectionStatus: contract.connectionStatus,
        statusLabel: contract.statusLabel,
        addressLabel: contract.addressLabel,
        ip: contract.ip,
        login: contract.login,
      })),
      invoiceGroups: invoiceGroups.slice(0, 5).map((group: any) => ({
        contractId: group.contractId,
        title: group.title,
        summary: group.summary,
      })),
    };
  }

  if (result.toolName === 'sgp_fetch_contracts') {
    const contracts = Array.isArray(raw.contracts) ? raw.contracts : [];
    return {
      contracts: contracts.slice(0, 6).map((contract: any) => ({
        id: contract.id,
        planDescription: contract.planDescription,
        statusLabel: contract.statusLabel,
        connectionStatus: contract.connectionStatus,
        addressLabel: contract.addressLabel,
      })),
    };
  }

  if (result.toolName.startsWith('mcp:') || result.toolName === 'mcp_call_tool') {
    return {
      content: raw.content || null,
      structuredContent: raw.structuredContent || null,
      isError: raw.isError || false,
    };
  }

  return raw;
}

export function compactProcedureToolResults(
  results: AgentToolExecutionResult[],
  input?: {
    maxChars?: number;
    maxOutputChars?: number;
  },
): Array<Record<string, unknown>> {
  const maxChars = input?.maxChars ?? PROCEDURE_SLIM_LIMITS.toolResultsChars;
  const maxOutputChars = input?.maxOutputChars ?? PROCEDURE_SLIM_LIMITS.toolOutputChars;
  let compacted = (results || []).slice(-4).map((result) => {
    const output = compactToolOutput(result);
    const outputJson = JSON.stringify(output || null);
    return {
      toolName: result.toolName,
      status: result.status,
      error: result.error || null,
      output: outputJson.length <= maxOutputChars
        ? output
        : compactProcedureText(outputJson, maxOutputChars),
    };
  });

  while (JSON.stringify(compacted).length > maxChars && compacted.length > 1) {
    compacted = compacted.slice(1);
  }

  if (JSON.stringify(compacted).length <= maxChars) return compacted;

  return compacted.map((result) => ({
    toolName: result.toolName,
    status: result.status,
    error: result.error,
    output: compactProcedureText(JSON.stringify(result.output || null), Math.min(500, maxOutputChars)),
  }));
}
