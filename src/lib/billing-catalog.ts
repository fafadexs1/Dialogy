import { type PlanDetails, type PlanLimits, UNLIMITED } from "./plans-types";

export type OfferedPlan = Omit<PlanDetails, "id"> & {
  scope?: "public" | "custom";
  id: string;
  active: boolean;
};
export function planHighlights(limits: PlanLimits): string[] {
  const quantity = (n: number) =>
    n >= UNLIMITED || n === 9999 ? "Ilimitados" : n.toLocaleString("pt-BR");
  return [
    "Usuários ilimitados",
    ...(limits.monthly_chats
      ? [`${quantity(limits.monthly_chats)} conversas por mês`]
      : []),
    ...(limits.whatsapp_baileys
      ? [`${quantity(limits.whatsapp_baileys)} conexões WhatsApp`]
      : []),
    ...(limits.whatsapp_cloud
      ? [`${quantity(limits.whatsapp_cloud)} canais WhatsApp oficial`]
      : []),
    ...(limits.instagram ? ["Instagram"] : []),
    ...(limits.messenger ? ["Messenger"] : []),
    ...(limits.autopilot_agents
      ? [
          `${quantity(limits.autopilot_agents)} ${limits.autopilot_agents === 1 ? "agente" : "agentes"} de IA`,
        ]
      : []),
    ...(limits.pipeline ? ["CRM com funil de vendas"] : []),
    ...(limits.nexusflow ? ["Automações com NexusFlow"] : []),
    ...(limits.public_api ? ["API pública"] : []),
    ...(limits.webhook_dispatcher ? ["Webhooks"] : []),
    ...(limits.history_months
      ? [
          limits.history_months === 9999 || limits.history_months >= UNLIMITED
            ? "Histórico ilimitado"
            : `Histórico de ${limits.history_months} meses`,
        ]
      : []),
  ];
}

export function validPlanLimits(limits: Record<string, unknown>) {
  return Object.entries(limits).every(
    ([key, value]) =>
      typeof value === "boolean" ||
      (typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= UNLIMITED) ||
      (key === "campaigns" && ["moderate", "high"].includes(String(value))),
  );
}
