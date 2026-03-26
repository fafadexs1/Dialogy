"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CheckCircle2,
  Copy,
  Gift,
  Link2,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

import type { ReferralDashboardData } from "@/lib/referrals";
import { formatCurrencyFromCents } from "@/lib/referrals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ReferralsDashboardProps = {
  dashboard: ReferralDashboardData;
};

function formatLongDate(value?: string | null) {
  if (!value) {
    return "Ainda sem bonus";
  }

  return format(new Date(value), "dd 'de' MMM yyyy", { locale: ptBR });
}

function getBillingReasonLabel(reason?: string | null) {
  if (reason === "subscription_create") {
    return "Primeira mensalidade";
  }

  if (reason === "subscription_cycle") {
    return "Recorrencia mensal";
  }

  return "Fatura elegivel";
}

function getReferralStatusMeta(status: ReferralDashboardData["referrals"][number]["status"]) {
  switch (status) {
    case "active":
      return {
        label: "Valida",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
        helper: "Workspace criada e assinatura ativa.",
      };
    case "awaiting_subscription":
      return {
        label: "Aguardando plano",
        className: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50",
        helper: "Ja criou workspace, falta assinar um plano.",
      };
    default:
      return {
        label: "Aguardando workspace",
        className: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50",
        helper: "Ainda nao criou a primeira workspace.",
      };
  }
}

export function ReferralsDashboard({ dashboard }: ReferralsDashboardProps) {
  const [copied, setCopied] = useState(false);

  const summaryCards = useMemo(
    () => [
      {
        label: "Saldo gerado",
        value: formatCurrencyFromCents(dashboard.totals.totalBonusCents),
        icon: Sparkles,
        accent: "text-emerald-600",
      },
      {
        label: "Indicacoes validas",
        value: String(dashboard.totals.validReferrals),
        icon: Users,
        accent: "text-sky-600",
      },
      {
        label: "Cadastros via link",
        value: String(dashboard.totals.totalSignups),
        icon: Gift,
        accent: "text-amber-600",
      },
      {
        label: "Workspaces criadas",
        value: String(dashboard.totals.workspaceCreated),
        icon: TrendingUp,
        accent: "text-violet-600",
      },
    ],
    [dashboard.totals]
  );

  async function handleCopyLink() {
    await navigator.clipboard.writeText(dashboard.referralLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 md:px-6">
      <section className="relative overflow-hidden rounded-[28px] border border-emerald-200/70 bg-[linear-gradient(135deg,#ecfdf5_0%,#f8fafc_55%,#eff6ff_100%)] p-6 shadow-[0_28px_90px_-54px_rgba(15,23,42,0.45)] md:p-8">
        <div className="pointer-events-none absolute -right-12 top-0 h-40 w-40 rounded-full bg-emerald-300/25 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-36 w-36 rounded-full bg-sky-200/30 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-4">
            <Badge className="w-fit border border-emerald-200 bg-white/80 text-emerald-700 hover:bg-white/80">
              Programa de indicacao
            </Badge>
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                Receba {dashboard.bonusPercent}% recorrente por cada cliente indicado.
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-600 md:text-base">
                A indicacao so vira valida quando o indicado cria uma workspace e ativa um plano. A partir da primeira mensalidade paga, voce recebe {dashboard.bonusPercent}% em cada cobranca enquanto essa workspace seguir ativa.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={handleCopyLink}
                className="rounded-full bg-slate-950 px-5 text-white hover:bg-slate-800"
              >
                {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Link copiado" : "Copiar link"}
              </Button>
              <a
                href={dashboard.referralLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-5 text-sm font-medium text-slate-700 transition-colors hover:bg-white hover:text-slate-950"
              >
                <Link2 className="h-4 w-4" />
                Abrir link publico
              </a>
            </div>
          </div>

          <div className="grid gap-3 rounded-[24px] border border-white/80 bg-white/75 p-4 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.35)] sm:grid-cols-2 lg:min-w-[360px]">
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Seu codigo
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{dashboard.referralCode}</p>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Link pronto
              </p>
              <p className="mt-2 line-clamp-2 text-sm text-slate-700">{dashboard.referralLink}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <Card key={card.label} className="border-slate-200/80 bg-white/90 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.35)]">
            <CardContent className="flex items-center justify-between p-6">
              <div className="space-y-2">
                <p className="text-sm text-slate-500">{card.label}</p>
                <p className="text-2xl font-semibold tracking-tight text-slate-950">{card.value}</p>
              </div>
              <div className={cn("rounded-2xl bg-slate-100 p-3", card.accent)}>
                <card.icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <Card className="border-slate-200/80 bg-white/95 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.35)]">
          <CardHeader>
            <CardTitle>Bonificacoes recentes</CardTitle>
            <CardDescription>
              Cada linha representa uma mensalidade elegivel que gerou bonus de {dashboard.bonusPercent}%.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard.recentBonuses.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-sm text-slate-500">
                Ainda nao ha faturas indicadas pagas. Compartilhe seu link para comecar a acumular.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Mensalidade</TableHead>
                    <TableHead>Bonus</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.recentBonuses.map((bonus) => (
                    <TableRow key={bonus.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-slate-950">{bonus.referredName}</p>
                          <p className="text-xs text-slate-500">
                            {bonus.workspaceName || "Workspace ainda nao informado"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>{formatCurrencyFromCents(bonus.invoiceAmountCents, bonus.currency)}</TableCell>
                      <TableCell className="font-semibold text-emerald-700">
                        {formatCurrencyFromCents(bonus.bonusAmountCents, bonus.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="bg-slate-100 text-slate-700 hover:bg-slate-100"
                        >
                          {getBillingReasonLabel(bonus.billingReason)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-slate-500">
                        {formatLongDate(bonus.invoicePaidAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/95 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.35)]">
          <CardHeader>
            <CardTitle>Clientes indicados</CardTitle>
            <CardDescription>
              Uma indicacao so conta como valida quando existir workspace criada com plano ativo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboard.referrals.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center text-sm text-slate-500">
                Nenhum cadastro indicado ainda.
              </div>
            ) : (
              dashboard.referrals.map((referral) => {
                const statusMeta = getReferralStatusMeta(referral.status);

                return (
                  <div
                    key={referral.id}
                    className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium text-slate-950">{referral.name}</p>
                        <p className="text-sm text-slate-500">{referral.email || "E-mail nao informado"}</p>
                        <p className="text-xs text-slate-500">
                          {referral.workspaceName || "Sem workspace criada ainda"}
                        </p>
                      </div>
                      <Badge className={cn(statusMeta.className)}>
                        {statusMeta.label}
                      </Badge>
                    </div>

                    <p className="mt-3 text-xs text-slate-500">{statusMeta.helper}</p>

                    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                      <span className="text-slate-500">Bonus acumulado</span>
                      <span className="font-semibold text-slate-950">
                        {formatCurrencyFromCents(referral.totalBonusCents)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                      <span>Ultimo credito</span>
                      <span>{formatLongDate(referral.lastBonusAt)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
