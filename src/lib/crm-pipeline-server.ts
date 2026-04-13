"use server";

import { db } from "@/lib/db";
import {
  DEFAULT_PIPELINE_STAGES,
  PIPELINE_STAGE_CATEGORY,
  type PipelineStage,
} from "@/lib/crm-pipeline";

let pipelineTagSchemaEnsured = false;

export async function ensurePipelineTagSchema(): Promise<void> {
  if (!pipelineTagSchemaEnsured) {
    await db.query(`
      ALTER TABLE "tags"
      ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'general'
    `);
    await db.query(`
      ALTER TABLE "tags"
      ADD COLUMN IF NOT EXISTS "sort_order" INTEGER
    `);
    pipelineTagSchemaEnsured = true;
  }

  await db.query(`
    UPDATE "tags"
    SET
      "category" = $1,
      "sort_order" = CASE "value"
        WHEN 'novo' THEN 100
        WHEN 'qualificado' THEN 200
        WHEN 'proposta' THEN 300
        WHEN 'negociacao' THEN 400
        WHEN 'fechamento' THEN 450
        WHEN 'ganho' THEN 500
        WHEN 'perdido' THEN 600
        ELSE "sort_order"
      END
    WHERE "value" IN ('novo', 'qualificado', 'proposta', 'negociacao', 'fechamento', 'ganho', 'perdido')
      AND COALESCE("category", 'general') = 'general'
  `, [PIPELINE_STAGE_CATEGORY]);
}

export async function ensureDefaultPipelineStages(workspaceId: string): Promise<void> {
  await ensurePipelineTagSchema();

  const existingRes = await db.query(
    `
      SELECT COUNT(*)::int AS total
      FROM "tags"
      WHERE "workspace_id" = $1
        AND "category" = $2
    `,
    [workspaceId, PIPELINE_STAGE_CATEGORY],
  );

  if ((existingRes.rows[0]?.total || 0) > 0) {
    return;
  }

  for (const stage of DEFAULT_PIPELINE_STAGES) {
    await db.query(
      `
        INSERT INTO "tags" ("workspace_id", "label", "value", "color", "is_close_reason", "category", "sort_order")
        VALUES ($1, $2, $3, $4, false, $5, $6)
        ON CONFLICT ("workspace_id", "value") DO UPDATE
        SET
          "label" = EXCLUDED."label",
          "color" = EXCLUDED."color",
          "category" = EXCLUDED."category",
          "sort_order" = COALESCE("tags"."sort_order", EXCLUDED."sort_order")
      `,
      [workspaceId, stage.label, stage.value, stage.color, PIPELINE_STAGE_CATEGORY, stage.sort_order ?? null],
    );
  }
}

export async function getPipelineStagesForWorkspace(workspaceId: string): Promise<PipelineStage[]> {
  await ensureDefaultPipelineStages(workspaceId);

  const res = await db.query(
    `
      SELECT "id", "label", "value", "color", "is_close_reason", "team_ids", "category", "sort_order"
      FROM "tags"
      WHERE "workspace_id" = $1
        AND "category" = $2
      ORDER BY COALESCE("sort_order", 2147483647), "label"
    `,
    [workspaceId, PIPELINE_STAGE_CATEGORY],
  );

  return res.rows;
}

export async function getDefaultPipelineStageValueForWorkspace(workspaceId: string): Promise<string> {
  const stages = await getPipelineStagesForWorkspace(workspaceId);
  return stages[0]?.value ?? DEFAULT_PIPELINE_STAGES[0].value;
}
