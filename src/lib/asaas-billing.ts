export const ASAAS_PAID_STATUSES = ["CONFIRMED", "RECEIVED"];
export function nextMonthlyDate(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}
export function billingDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function paymentLabel(status: string): string {
  return (
    (
      {
        CONFIRMED: "Confirmado",
        RECEIVED: "Recebido",
        PENDING: "Aguardando pagamento",
        OVERDUE: "Vencido",
        REFUNDED: "Estornado",
        DELETED: "Cancelado",
        CHARGEBACK_REQUESTED: "Contestação",
        CHARGEBACK_DISPUTE: "Contestação",
        AWAITING_CHARGEBACK_REVERSAL: "Contestação",
        RECEIVED_IN_CASH: "Recebido em dinheiro",
      } as Record<string, string>
    )[status] || status
  );
}
