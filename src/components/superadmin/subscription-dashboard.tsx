"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CreditCard,
  Wallet,
  Clock3,
  AlertCircle,
  Settings2,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { getAsaasAdminAction } from "@/actions/asaas";
import { paymentLabel } from "@/lib/asaas-billing";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function SubscriptionDashboard() {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof getAsaasAdminAction>
  > | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState("all");
  async function load() {
    setBusy(true);
    setError("");
    try {
      setData(await getAsaasAdminAction());
    } catch {
      setError(
        "Não foi possível carregar os dados de cobrança. Verifique a conexão e a migração ASAAS.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const filtered =
    data?.invoices.filter(
      (p) =>
        (status === "all" || p.status === status) &&
        `${p.workspace} ${p.plan}`.toLowerCase().includes(filter.toLowerCase()),
    ) || [];
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-7">
      <header className="flex flex-wrap justify-between gap-5">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[.2em] text-primary">
            Dialogy · Gestão de assinaturas
          </span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Seu negócio, em perspectiva.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Planos ofertados, clientes e recebimentos conectados ao ASAAS.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" asChild><Link href="/superadmin/billing/costs">Custos da infraestrutura</Link></Button>
          <Button
            variant="outline"
            onClick={load}
            disabled={busy}
            aria-label="Atualizar painel"
          >
            <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
          </Button>
          <Button asChild>
            <Link href="/superadmin/billing/settings">
              <Settings2 size={16} /> Configurar ASAAS
            </Link>
          </Button>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {!data && !error && <Loader2 className="animate-spin" />}
      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
            <div className="flex items-center gap-3">
              <CreditCard size={20} className="text-primary" />
              <div>
                <p className="text-sm font-medium">
                  ASAAS ·{" "}
                  {data.config.environment === "production"
                    ? "Produção"
                    : "Sandbox"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {!data.config.apiKeyConfigured
                    ? "Configure sua conta para começar a receber."
                    : data.config.lastEvent
                      ? "Notificações de cobrança recebidas."
                      : "Credencial cadastrada. Aguardando o primeiro evento."}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {["PIX", "Boleto", "Cartão"].map((m) => (
                <Badge key={m} variant="outline">
                  {m}
                </Badge>
              ))}
            </div>
          </div>
          <section
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Resumo financeiro"
          >
            {[
              {
                title: "Recebido neste mês",
                value: money(data.totals.received),
                note: "Valores recebidos no ASAAS",
                icon: Wallet,
              },
              {
                title: "Confirmado a receber",
                value: money(data.totals.confirmed),
                note: "Pagamentos ainda não liquidados",
                icon: CreditCard,
              },
              {
                title: "Cobranças em aberto",
                value: String(data.totals.pending),
                note: "Faturas aguardando pagamento",
                icon: Clock3,
              },
              {
                title: "Valor em atraso",
                value: money(data.totals.overdue),
                note: "Faturas vencidas sem pagamento",
                icon: AlertCircle,
              },
            ].map((m) => (
              <Card key={m.title}>
                <CardContent className="p-5">
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{m.title}</span>
                    <m.icon size={17} />
                  </div>
                  <p className="mt-5 text-3xl font-semibold tracking-tight">
                    {m.value}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">{m.note}</p>
                </CardContent>
              </Card>
            ))}
          </section>
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  Seu portfólio de planos
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  O mesmo catálogo publicado na página inicial.
                </p>
              </div>
              <Button variant="ghost" asChild>
                <Link href="/superadmin/plans">
                  Gerenciar planos <ArrowUpRight size={15} />
                </Link>
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {data.plans.map((p) => {
                const counts = data.counts.find((c) => c.slug === p.id);
                return (
                  <Card
                    key={p.id}
                    className={p.highlighted ? "border-primary/40" : ""}
                  >
                    <CardContent className="p-5">
                      <div className="flex justify-between gap-2">
                        <span className="font-semibold">{p.label}</span>
                        <Badge variant={p.active ? "secondary" : "outline"}>
                          {p.active ? "Na vitrine" : "Oculto"}
                        </Badge>
                      </div>
                      <p className="mt-4 text-2xl font-semibold">
                        {p.id === "enterprise"
                          ? "Sob consulta"
                          : money(p.price)}
                        {p.id !== "enterprise" && (
                          <span className="text-xs font-normal text-muted-foreground">
                            /mês
                          </span>
                        )}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {p.limits.monthly_chats.toLocaleString("pt-BR")}{" "}
                        conversas · usuários ilimitados
                      </p>
                      <div className="mt-6 flex justify-between border-t pt-4 text-sm">
                        <span>
                          <strong>{counts?.active || 0}</strong> ativos
                        </span>
                        <span className="text-muted-foreground">
                          {counts?.trials || 0} em teste
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
          <Card>
            <CardHeader>
              <CardTitle>Últimas cobranças</CardTitle>
              <CardDescription>
                Histórico registrado a partir do ASAAS. Valores brutos, antes
                das tarifas.
              </CardDescription>
              <div className="flex flex-wrap gap-3 pt-3">
                <Input
                  className="max-w-sm"
                  aria-label="Buscar workspace ou plano"
                  placeholder="Buscar workspace ou plano..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <select
                  aria-label="Filtrar situação da cobrança"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="all">Todas as situações</option>
                  {[
                    "PENDING",
                    "CONFIRMED",
                    "RECEIVED",
                    "OVERDUE",
                    "REFUNDED",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {paymentLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardContent>
              {filtered.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left text-sm">
                    <thead className="border-b text-xs text-muted-foreground">
                      <tr>
                        {[
                          "Cliente / plano",
                          "Vencimento",
                          "Valor",
                          "Situação",
                          "Fatura",
                        ].map((h) => (
                          <th key={h} className="pb-3 pr-4 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="py-4">
                            <p className="font-medium">{p.workspace}</p>
                            <p className="text-xs text-muted-foreground">
                              {p.plan}
                            </p>
                          </td>
                          <td>
                            {new Date(
                              `${p.due_date}T12:00:00`,
                            ).toLocaleDateString("pt-BR")}
                          </td>
                          <td className="font-medium">{money(p.amount)}</td>
                          <td>
                            <Badge variant="outline">
                              {paymentLabel(p.status)}
                            </Badge>
                          </td>
                          <td>
                            {p.invoice_url && (
                              <a
                                href={p.invoice_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary"
                              >
                                Abrir
                                <ArrowUpRight size={14} />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-12 text-center">
                  <Wallet className="mx-auto mb-3 text-muted-foreground" />
                  <p className="font-medium">
                    {data.invoices.length
                      ? "Nenhuma cobrança corresponde aos filtros"
                      : "Seu histórico começa com a primeira cobrança"}
                  </p>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                    {data.invoices.length
                      ? "Experimente outro nome ou situação."
                      : "Conecte o ASAAS. Os pagamentos e renovações serão registrados aqui automaticamente."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
