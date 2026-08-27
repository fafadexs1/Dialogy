import { db } from '@/lib/db';
import type { JsonObject } from './types';
import type { AgentEvaluationResult, AgentEvaluationRun } from './types';

type EvaluationRunRow = {
  id: string;
  workspace_id: string;
  domain_pack_id: string | null;
  scenario_id: string;
  input: JsonObject | null;
  observation: JsonObject | null;
  passed: boolean;
  failures: unknown;
  metrics: JsonObject | null;
  created_at: string | Date;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 200) : [];
}

function mapRun(row: EvaluationRunRow): AgentEvaluationRun {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    domainPackId: row.domain_pack_id,
    scenarioId: row.scenario_id,
    input: row.input || {},
    observation: row.observation || {},
    passed: Boolean(row.passed),
    failures: arrayOfStrings(row.failures),
    metrics: row.metrics || {},
    createdAt: timestamp(row.created_at),
  };
}

function missingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /agent_evaluation_runs/.test(message) && /does not exist|undefined table|relation .* does not exist/i.test(message);
}

export async function recordAgentEvaluationRun(input: {
  workspaceId: string;
  domainPackId?: string | null;
  scenarioId: string;
  scenarioInput?: JsonObject;
  observation?: JsonObject;
  result: AgentEvaluationResult;
  metrics?: JsonObject;
}): Promise<AgentEvaluationRun | null> {
  if (!input.workspaceId || !input.scenarioId) return null;
  try {
    const result = await db.query<EvaluationRunRow>(
      `INSERT INTO public.agent_evaluation_runs (
        workspace_id,
        domain_pack_id,
        scenario_id,
        input,
        observation,
        passed,
        failures,
        metrics
      ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8::jsonb)
      RETURNING *`,
      [
        input.workspaceId,
        input.domainPackId ?? null,
        input.scenarioId,
        JSON.stringify(input.scenarioInput || {}),
        JSON.stringify(input.observation || {}),
        input.result.passed,
        JSON.stringify(input.result.failures),
        JSON.stringify(input.metrics || {}),
      ],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  } catch (error) {
    if (!missingTable(error)) console.error('[AGENT_EVALUATION:record]', error);
    return null;
  }
}

export async function listAgentEvaluationRuns(input: {
  workspaceId: string;
  scenarioId?: string | null;
  limit?: number;
}): Promise<AgentEvaluationRun[]> {
  if (!input.workspaceId) return [];
  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit || 50)));
  try {
    const result = await db.query<EvaluationRunRow>(
      `SELECT *
         FROM public.agent_evaluation_runs
        WHERE workspace_id = $1
          AND ($2::text IS NULL OR scenario_id = $2::text)
        ORDER BY created_at DESC
        LIMIT $3`,
      [input.workspaceId, input.scenarioId ?? null, limit],
    );
    return result.rows.map(mapRun);
  } catch (error) {
    if (!missingTable(error)) console.error('[AGENT_EVALUATION:list]', error);
    return [];
  }
}

