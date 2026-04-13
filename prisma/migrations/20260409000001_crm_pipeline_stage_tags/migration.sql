ALTER TABLE "tags"
    ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'general';

ALTER TABLE "tags"
    ADD COLUMN IF NOT EXISTS "sort_order" INTEGER;

UPDATE "tags"
SET
    "category" = 'pipeline_stage',
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
  AND COALESCE("category", 'general') = 'general';

CREATE INDEX IF NOT EXISTS "idx_tags_workspace_category_sort_order"
    ON "tags" ("workspace_id", "category", "sort_order");
