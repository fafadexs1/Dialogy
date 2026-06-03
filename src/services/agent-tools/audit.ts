import { db } from '@/lib/db';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolRuntimeContext } from './types';
import { redactSensitiveLogValue } from '@/lib/observability/redaction';

export async function auditAgentToolExecution(
  context: AgentToolRuntimeContext,
  result: AgentToolExecutionResult,
  inputOverride?: AgentToolAction
) {
  try {
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
        JSON.stringify(redactSensitiveLogValue(inputOverride || result.input)),
        result.output ? JSON.stringify(redactSensitiveLogValue(result.output)) : null,
        result.error || null,
      ]
    );
  } catch (error) {
    console.error('[AGENT_TOOLS_AUDIT] Failed to audit tool execution:', error);
  }
}
