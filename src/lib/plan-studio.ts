import {
  PLANS,
  UNLIMITED,
  normalizePlanLimits,
  type PlanType,
  type PlanLimits,
} from "./plans-types";
import type { Plan } from "./types";

export const PLAN_SECTIONS = [
  {
    id: "offer",
    label: "Oferta e preço",
    description: "Nome, mensalidade e publicação",
  },
  {
    id: "channels",
    label: "Canais e atendimento",
    description: "Conversas, conexões e histórico",
  },
  {
    id: "ai",
    label: "Inteligência artificial",
    description: "Agentes, conhecimento e Copilot",
  },
  {
    id: "team",
    label: "Equipe e permissões",
    description: "Distribuição e organização",
  },
  {
    id: "crm",
    label: "CRM e campanhas",
    description: "Vendas e relacionamento",
  },
  {
    id: "automation",
    label: "Automações e API",
    description: "Fluxos, integrações e relatórios",
  },
  {
    id: "integrations",
    label: "Integrações adicionais",
    description: "Disponibilidade e adicionais",
  },
] as const;
export type PlanSection = (typeof PLAN_SECTIONS)[number]["id"];
type Field = {
  key: keyof PlanLimits;
  label: string;
  hint?: string;
  kind: "number" | "toggle";
  unit?: string;
};
export const PLAN_FIELDS: Partial<Record<PlanSection, Field[]>> = {
  channels: [
    {
      key: "monthly_chats",
      label: "Conversas por mês",
      hint: "Volume mensal de conversas incluído no plano.",
      kind: "number",
    },
    { key: "whatsapp_baileys", label: "WhatsApp por QR Code", kind: "number" },
    {
      key: "whatsapp_cloud",
      label: "WhatsApp oficial",
      hint: "As tarifas da Meta são cobradas separadamente.",
      kind: "number",
    },
    { key: "instagram", label: "Contas do Instagram", kind: "number" },
    { key: "messenger", label: "Páginas do Messenger", kind: "number" },
    { key: "telegram", label: "Bots do Telegram", kind: "number" },
    {
      key: "history_months",
      label: "Histórico de conversas",
      unit: "meses",
      kind: "number",
    },
    { key: "shortcuts", label: "Respostas rápidas", kind: "number" },
    { key: "interactive_lists", label: "Listas interativas", kind: "toggle" },
    { key: "chat_export", label: "Exportação de conversas", kind: "toggle" },
  ],
  ai: [
    { key: "autopilot_agents", label: "Agentes de IA", kind: "number" },
    {
      key: "knowledge_docs",
      label: "Documentos de conhecimento",
      kind: "number",
    },
    { key: "transcription", label: "Transcrição de áudios", kind: "toggle" },
    {
      key: "ai_copilot",
      label: "Copilot para a equipe",
      hint: "Sugestões para ajudar os atendentes a responder.",
      kind: "toggle",
    },
    { key: "ai_byok", label: "Chave própria de IA", kind: "toggle" },
    { key: "case_memory", label: "Memória de atendimentos", kind: "toggle" },
    { key: "private_agents", label: "Agentes privados", kind: "toggle" },
  ],
  team: [
    { key: "teams", label: "Equipes e departamentos", kind: "number" },
    {
      key: "auto_distribution",
      label: "Distribuição automática",
      kind: "toggle",
    },
    {
      key: "team_transfer",
      label: "Transferência entre equipes",
      kind: "toggle",
    },
    { key: "business_hours", label: "Horário de atendimento", kind: "toggle" },
    {
      key: "custom_roles",
      label: "Perfis de acesso personalizados",
      kind: "toggle",
    },
    {
      key: "granular_permissions",
      label: "Permissões por recurso",
      kind: "toggle",
    },
    {
      key: "team_shortcuts",
      label: "Respostas rápidas por equipe",
      kind: "toggle",
    },
    {
      key: "close_reason_tags",
      label: "Motivos de encerramento",
      kind: "toggle",
    },
    { key: "team_tags", label: "Etiquetas por equipe", kind: "toggle" },
    { key: "tag_categories", label: "Categorias de etiquetas", kind: "toggle" },
  ],
  crm: [
    { key: "custom_fields", label: "Campos personalizados", kind: "number" },
    { key: "campaigns_per_month", label: "Campanhas por mês", kind: "number" },
    { key: "pipeline", label: "Funil de vendas", kind: "toggle" },
    { key: "lead_scoring", label: "Pontuação de leads", kind: "toggle" },
    { key: "nlp_segments", label: "Segmentação inteligente", kind: "toggle" },
    {
      key: "conversion_tracking",
      label: "Rastreamento de conversões",
      kind: "toggle",
    },
    { key: "parallel_dispatch", label: "Disparos em paralelo", kind: "toggle" },
    { key: "api_dispatch", label: "Disparos pela API", kind: "toggle" },
  ],
  automation: [
    { key: "system_agents", label: "Automações do sistema", kind: "number" },
    { key: "nexusflow", label: "NexusFlow", kind: "toggle" },
    { key: "crm_automations", label: "Automações do CRM", kind: "toggle" },
    { key: "webhook_dispatcher", label: "Envio de webhooks", kind: "toggle" },
    { key: "public_api", label: "API pública", kind: "toggle" },
    {
      key: "developer_portal",
      label: "Portal do desenvolvedor",
      kind: "toggle",
    },
    {
      key: "agent_performance",
      label: "Desempenho dos atendentes",
      kind: "toggle",
    },
    {
      key: "first_response_time",
      label: "Tempo de primeira resposta",
      kind: "toggle",
    },
    { key: "fcr_rate", label: "Resolução no primeiro contato", kind: "toggle" },
    {
      key: "conversion_metrics",
      label: "Métricas de conversão",
      kind: "toggle",
    },
    { key: "crm_dashboard", label: "Painel do CRM", kind: "toggle" },
    { key: "data_export", label: "Exportação de relatórios", kind: "toggle" },
  ],
};
export type StudioIntegration = {
  integrationId: string;
  isEnabled: boolean;
  includedQuantity: number;
  additionalCost: number;
};
export type PlanDraft = {
  scope: "public" | "custom";
  workspace_ids: string[];
  id?: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  is_active: boolean;
  is_default: boolean;
  limits: PlanLimits;
  integrations: StudioIntegration[];
};
export function draftFromPlan(plan: Plan): PlanDraft {
  const fallback = Object.hasOwn(PLANS, plan.slug || "")
    ? PLANS[plan.slug as PlanType]
    : undefined;
  return {
    scope: plan.scope || "public",
    workspace_ids: [...(plan.workspace_ids || [])],
    id: plan.id,
    slug: plan.slug || "",
    name: plan.name,
    description:
      !plan.description ||
      /^plan(o)?\s+(Essencial|Profissional|Operacao|Operação|Enterprise)$/i.test(
        plan.description,
      )
        ? fallback?.description || ""
        : plan.description,
    price: Number(plan.price),
    is_active: plan.is_active,
    is_default: plan.is_default,
    limits: normalizePlanLimits(plan.limits, plan.slug as PlanType),
    integrations: plan.integrations.map((i) => ({
      integrationId: i.integration_id,
      isEnabled: i.is_enabled,
      includedQuantity: Number(i.included_quantity),
      additionalCost: Number(i.additional_cost),
    })),
  };
}
export function planSlug(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}
export function updatePlanLimit(
  limits: PlanLimits,
  key: keyof PlanLimits,
  value: number | boolean,
): PlanLimits {
  const next = { ...limits, [key]: value, users: UNLIMITED };
  if (key === "public_api") next.api = Boolean(value);
  if (key === "whatsapp_baileys" || key === "whatsapp_cloud")
    next.whatsapp = Math.min(
      UNLIMITED,
      next.whatsapp_baileys + next.whatsapp_cloud,
    );
  if (key === "teams") next.departments = Number(value) > 0;
  if (key === "campaigns_per_month") next.campaigns = Number(value) > 0;
  return next;
}
export function isUnlimited(value: number) {
  return value === 9999 || value >= UNLIMITED;
}
export function displayQuota(value: number) {
  return isUnlimited(value) ? "Ilimitado" : value.toLocaleString("pt-BR");
}
