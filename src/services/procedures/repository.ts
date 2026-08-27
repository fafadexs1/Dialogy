import 'server-only';

import { db } from '@/lib/db';
import type { ProcedureGraph } from '@/services/autopilot/procedure-types';
import {
  ProcedureGraphSchema,
  ProcedureStudioDocumentSchema,
  type ProcedureStudioDocument,
} from './schemas';
import type { ProcedureSimulationReport } from './studio';
import type { ProcedureValidationResult } from './validator';

export type ProcedureStudioMetrics = {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  activeRuns: number;
  completionRate: number;
  lastRunAt: string | null;
};

export type ProcedureStudioVersion = {
  version: number;
  snapshot: ProcedureStudioDocument;
  validation: ProcedureValidationResult | null;
  simulation: ProcedureSimulationReport | null;
  createdAt: string;
  publishedAt: string;
};

export type ProcedureStudioRecord = {
  id: string;
  configId: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'archived';
  priority: number;
  draftRevision: number;
  publishedRevision: number;
  publishedVersion: number | null;
  draft: ProcedureStudioDocument;
  validation: ProcedureValidationResult | null;
  simulation: ProcedureSimulationReport | null;
  updatedAt: string;
  publishedAt: string | null;
  metrics: ProcedureStudioMetrics;
  versions: ProcedureStudioVersion[];
};

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function numberValue(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export async function listProcedureStudioRecords(input: {
  workspaceId: string;
  configId: string;
}): Promise<ProcedureStudioRecord[]> {
  const [definitionsResult, versionsResult] = await Promise.all([
    db.query(
      `SELECT d.id,
              d.autopilot_config_id,
              d.name,
              COALESCE(d.description, '') AS description,
              d.status,
              COALESCE(d.priority, 100) AS priority,
              COALESCE(d.draft_revision, 1) AS draft_revision,
              COALESCE(d.published_revision, 0) AS published_revision,
              d.published_version,
              d.draft_json,
              d.validation_json,
              d.simulation_json,
              d.updated_at,
              d.published_at,
              COALESCE(metrics.total_runs, 0) AS total_runs,
              COALESCE(metrics.completed_runs, 0) AS completed_runs,
              COALESCE(metrics.failed_runs, 0) AS failed_runs,
              COALESCE(metrics.active_runs, 0) AS active_runs,
              metrics.last_run_at
         FROM public.agent_procedure_definitions d
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::integer AS total_runs,
                  COUNT(*) FILTER (WHERE s.status = 'completed')::integer AS completed_runs,
                  COUNT(*) FILTER (WHERE s.status IN ('failed', 'aborted'))::integer AS failed_runs,
                  COUNT(*) FILTER (WHERE s.status IN ('running', 'waiting_input', 'waiting_tool'))::integer AS active_runs,
                  MAX(s.updated_at) AS last_run_at
             FROM public.agent_procedure_sessions s
            WHERE s.workspace_id = d.workspace_id
              AND s.procedure_id = d.id
         ) metrics ON true
        WHERE d.workspace_id = $1
          AND d.autopilot_config_id = $2
          AND d.source = 'procedure_studio'
        ORDER BY CASE d.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
                 d.priority DESC,
                 d.updated_at DESC`,
      [input.workspaceId, input.configId],
    ),
    db.query(
      `SELECT procedure_id, version, snapshot_json, validation_json, simulation_json,
              created_at, published_at
         FROM public.agent_procedure_versions
        WHERE workspace_id = $1
          AND autopilot_config_id = $2
        ORDER BY procedure_id, version DESC`,
      [input.workspaceId, input.configId],
    ),
  ]);

  const versionsByProcedure = new Map<string, ProcedureStudioVersion[]>();
  for (const row of versionsResult.rows) {
    const parsedSnapshot = ProcedureStudioDocumentSchema.safeParse(parseJson(row.snapshot_json));
    if (!parsedSnapshot.success) continue;
    const procedureId = String(row.procedure_id);
    const versions = versionsByProcedure.get(procedureId) || [];
    if (versions.length >= 20) continue;
    versions.push({
      version: numberValue(row.version),
      snapshot: parsedSnapshot.data,
      validation: (parseJson(row.validation_json) as ProcedureValidationResult | null) || null,
      simulation: (parseJson(row.simulation_json) as ProcedureSimulationReport | null) || null,
      createdAt: new Date(row.created_at).toISOString(),
      publishedAt: new Date(row.published_at).toISOString(),
    });
    versionsByProcedure.set(procedureId, versions);
  }

  return definitionsResult.rows.flatMap((row) => {
    const parsedDraft = ProcedureStudioDocumentSchema.safeParse(parseJson(row.draft_json));
    if (!parsedDraft.success) return [];
    const totalRuns = numberValue(row.total_runs);
    const completedRuns = numberValue(row.completed_runs);
    const id = String(row.id);
    return [{
      id,
      configId: String(row.autopilot_config_id),
      name: String(row.name),
      description: String(row.description || ''),
      status: String(row.status) as ProcedureStudioRecord['status'],
      priority: numberValue(row.priority),
      draftRevision: numberValue(row.draft_revision),
      publishedRevision: numberValue(row.published_revision),
      publishedVersion: row.published_version == null ? null : numberValue(row.published_version),
      draft: parsedDraft.data,
      validation: (parseJson(row.validation_json) as ProcedureValidationResult | null) || null,
      simulation: (parseJson(row.simulation_json) as ProcedureSimulationReport | null) || null,
      updatedAt: new Date(row.updated_at).toISOString(),
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      metrics: {
        totalRuns,
        completedRuns,
        failedRuns: numberValue(row.failed_runs),
        activeRuns: numberValue(row.active_runs),
        completionRate: totalRuns > 0 ? Number(((completedRuns / totalRuns) * 100).toFixed(1)) : 0,
        lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
      },
      versions: versionsByProcedure.get(id) || [],
    } satisfies ProcedureStudioRecord];
  });
}

export async function listPublishedProcedureGraphs(input: {
  workspaceId: string;
  configId: string;
}): Promise<ProcedureGraph[]> {
  const result = await db.query(
    `SELECT id, definition_json
       FROM public.agent_procedure_definitions
      WHERE workspace_id = $1
        AND autopilot_config_id = $2
        AND source = 'procedure_studio'
        AND status = 'active'
        AND published_version IS NOT NULL
      ORDER BY priority DESC, published_at DESC`,
    [input.workspaceId, input.configId],
  );
  return result.rows.flatMap((row) => {
    const parsed = ProcedureGraphSchema.safeParse(parseJson(row.definition_json));
    if (!parsed.success) {
      console.error(`[PROCEDURE_STUDIO] Ignoring invalid published procedure ${row.id}:`, parsed.error.flatten());
      return [];
    }
    return [parsed.data as ProcedureGraph];
  });
}
