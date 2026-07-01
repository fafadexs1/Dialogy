import { db } from '@/lib/db';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolRuntimeContext } from './types';
import { fingerprintAuditedToolOperation } from './action-fingerprint';
import { redactSensitiveLogValue } from '@/lib/observability/redaction';

export function buildAuditedAgentToolInput(input: AgentToolAction): unknown {
  const redactedInput = redactSensitiveLogValue(input);
  return redactedInput && typeof redactedInput === 'object' && !Array.isArray(redactedInput)
    ? {
        ...redactedInput as Record<string, unknown>,
        operationFingerprint: fingerprintAuditedToolOperation(input),
      }
    : redactedInput;
}

export async function auditAgentToolExecution(
  context: AgentToolRuntimeContext,
  result: AgentToolExecutionResult,
  inputOverride?: AgentToolAction
) {
  try {
    const rawInput = inputOverride || result.input;
    const auditInput = buildAuditedAgentToolInput(rawInput);
    await db.query(
      `INSERT INTO agent_tool_executions (
        workspace_id,
        chat_id,
        system_agent_id,
        autopilot_config_id,
        tool_name,
        status,
        input,
        output,
        error,
        requires_human_approval
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)`,
      [
        context.workspaceId,
        context.chat.id,
        context.systemAgentId,
        context.autopilotConfig.id,
        result.toolName,
        result.status,
        JSON.stringify(auditInput),
        result.output ? JSON.stringify(redactSensitiveLogValue(result.output)) : null,
        result.error || null,
      ]
    );
  } catch (error) {
    console.error('[AGENT_TOOLS_AUDIT] Failed to audit tool execution:', error);
  }
}
