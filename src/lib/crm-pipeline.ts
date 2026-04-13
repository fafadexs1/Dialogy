import type { Tag } from "@/lib/types";

export const PIPELINE_STAGE_CATEGORY = "pipeline_stage";

export const LEGACY_PIPELINE_STAGE_VALUES = [
  "novo",
  "qualificado",
  "proposta",
  "negociacao",
  "fechamento",
  "ganho",
  "perdido",
] as const;

export type PipelineStage = Tag & {
  category?: string;
  sort_order?: number | null;
};

export const DEFAULT_PIPELINE_STAGES: Array<
  Pick<PipelineStage, "value" | "label" | "color" | "sort_order">
> = [
  { value: "novo", label: "Novo", color: "#3b82f6", sort_order: 100 },
  { value: "qualificado", label: "Qualificado", color: "#eab308", sort_order: 200 },
  { value: "proposta", label: "Proposta", color: "#a855f7", sort_order: 300 },
  { value: "negociacao", label: "Negociacao", color: "#f97316", sort_order: 400 },
  { value: "ganho", label: "Ganho", color: "#22c55e", sort_order: 500 },
  { value: "perdido", label: "Perdido", color: "#ef4444", sort_order: 600 },
];

export function normalizePipelineStageValue(label: string): string {
  return String(label || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function labelizePipelineStageValue(value: string): string {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function sortPipelineStages<T extends { label: string; sort_order?: number | null }>(
  stages: T[],
): T[] {
  return [...stages].sort((left, right) => {
    const leftOrder = left.sort_order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sort_order ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.label.localeCompare(right.label, "pt-BR");
  });
}

export function buildFallbackPipelineStages(): PipelineStage[] {
  return DEFAULT_PIPELINE_STAGES.map((stage, index) => ({
    id: `virtual-stage-${index}`,
    value: stage.value,
    label: stage.label,
    color: stage.color,
    is_close_reason: false,
    category: PIPELINE_STAGE_CATEGORY,
    sort_order: stage.sort_order,
  }));
}

export function getDefaultPipelineStageValue(stages?: PipelineStage[]): string {
  return sortPipelineStages(stages && stages.length > 0 ? stages : buildFallbackPipelineStages())[0]?.value ?? "novo";
}

export function isPipelineStageValue(value?: string | null): boolean {
  if (!value) return false;
  return LEGACY_PIPELINE_STAGE_VALUES.includes(value as (typeof LEGACY_PIPELINE_STAGE_VALUES)[number]);
}
