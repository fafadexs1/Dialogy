import type { AgentToolClass } from '@/services/agent-tools/catalog';
import type { McpToolConfig } from './types';

export type McpToolSafety = {
  class: AgentToolClass;
  riskLevel: 'low' | 'medium' | 'high';
  sideEffect: 'none' | 'medium' | 'high';
  idempotent: boolean;
  requiresHumanApproval: false;
  inferredFrom: 'annotation' | 'semantics' | 'default';
};

export function resolveMcpToolTimeoutMs(): number {
  const configured = Number.parseInt(process.env.MCP_TOOL_TIMEOUT_MS || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 30000;
}

function normalize(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toolText(toolName: string, tool?: Partial<McpToolConfig> | null): string {
  return normalize([
    toolName,
    tool?.name,
    tool?.title,
    tool?.description,
    tool?.inputSchema ? JSON.stringify(tool.inputSchema) : '',
  ].filter(Boolean).join(' '));
}

export function classifyMcpToolSafety(
  toolName: string,
  tool?: Partial<McpToolConfig> | null,
): McpToolSafety {
  if (tool?.annotations?.destructiveHint === true) {
    return {
      class: 'write_non_idempotent',
      riskLevel: 'high',
      sideEffect: 'high',
      idempotent: Boolean(tool.annotations.idempotentHint),
      requiresHumanApproval: false,
      inferredFrom: 'annotation',
    };
  }
  if (tool?.annotations?.readOnlyHint === true) {
    return {
      class: 'read_only',
      riskLevel: 'low',
      sideEffect: 'none',
      idempotent: true,
      requiresHumanApproval: false,
      inferredFrom: 'annotation',
    };
  }

  const text = toolText(toolName, tool);
  const isHighRisk = (
    /\b(reboot|restart|reinici|factory reset|resetar|erase|drop)\b/.test(text) ||
    /\b(queue set parameters|set parameter|setparameter|change wifi|alterar wifi|trocar wifi|mudar wifi)\b/.test(text) ||
    /\b(delete|remove|cancel|terminate|refund|estornar|reembolsar|excluir|remover|cancelar)\b/.test(text) ||
    /\b(clear pending|limpar comandos|import mesh|importar topologia)\b/.test(text)
  );
  if (isHighRisk) {
    return {
      class: 'write_non_idempotent',
      riskLevel: 'high',
      sideEffect: 'high',
      idempotent: Boolean(tool?.annotations?.idempotentHint),
      requiresHumanApproval: false,
      inferredFrom: 'semantics',
    };
  }

  const isReadOnly = (
    /\b(get|find|list|view|read|fetch|search|lookup|status|summary|consult|consulta|localiz|verific)\b/.test(text) ||
    /\b(scan|diagnos|neighbor|vizinh|connected devices|dispositivos conectados|cached|cache|topology|topologia)\b/.test(text) ||
    /\b(queue get parameters|getparameter|refresh wifi|sync mesh)\b/.test(text)
  );
  if (isReadOnly) {
    return {
      class: 'read_only',
      riskLevel: 'low',
      sideEffect: 'none',
      idempotent: true,
      requiresHumanApproval: false,
      inferredFrom: 'semantics',
    };
  }

  return {
    class: 'retrieval',
    riskLevel: 'medium',
    sideEffect: 'medium',
    idempotent: Boolean(tool?.annotations?.idempotentHint),
    requiresHumanApproval: false,
    inferredFrom: 'default',
  };
}
