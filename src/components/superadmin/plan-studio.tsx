"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  FileText,
  Infinity as InfinityIcon,
  Layers3,
  Loader2,
  MessageSquare,
  Network,
  Plus,
  Plug,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { getPlans, savePlan } from "@/actions/plans";
import { PLANS, UNLIMITED, type PlanLimits } from "@/lib/plans-types";
import {
  PLAN_FIELDS,
  PLAN_SECTIONS,
  displayQuota,
  draftFromPlan,
  isUnlimited,
  planSlug,
  updatePlanLimit,
  type PlanDraft,
  type PlanSection,
  type StudioIntegration,
} from "@/lib/plan-studio";
import { cn } from "@/lib/utils";
import type { Integration, Plan } from "@/lib/types";

const money = (value: number) =>
  Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const sectionIcons = {
  offer: Wallet,
  channels: MessageSquare,
  ai: Sparkles,
  team: Users,
  crm: Layers3,
  automation: Network,
  integrations: Plug,
};
const planIcons = {
  starter: MessageSquare,
  pro: Sparkles,
  business: Layers3,
  enterprise: ShieldCheck,
};
const orderPlans = (plans: Plan[]) =>
  [...plans].sort(
    (a, b) =>
      (a.slug === "enterprise" ? Infinity : Number(a.price)) -
      (b.slug === "enterprise" ? Infinity : Number(b.price)),
  );
const planName = (plan: { name: string; slug?: string }) =>
  plan.slug === "business" && plan.name === "Operacao" ? "Operação" : plan.name;
const quotaRows = [
  ["Conversas / mês", "monthly_chats"],
  ["WhatsApp QR Code", "whatsapp_baileys"],
  ["WhatsApp oficial", "whatsapp_cloud"],
  ["Agentes de IA", "autopilot_agents"],
] as const;

function Status({
  active,
  initial = false,
  custom = false,
}: {
  active: boolean;
  initial?: boolean;
  custom?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        initial
          ? "bg-primary/10 text-primary"
          : active
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-muted text-muted-foreground",
      )}
    >
      {initial ? (
        <CheckCheck className="h-3 w-3" />
      ) : (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            active ? "bg-emerald-500" : "bg-muted-foreground/50",
          )}
        />
      )}
      {initial
        ? "Plano padrão"
        : active
          ? custom
            ? "Exclusivo"
            : "Publicado"
          : "Oculto"}
    </span>
  );
}

function Price({ price }: { price: number }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 text-2xl tracking-tight">
      <span className="font-semibold">
        {price > 0 ? money(price) : "Sob consulta"}
      </span>
      {price > 0 && (
        <span className="text-sm font-normal tracking-normal text-muted-foreground">
          /mês
        </span>
      )}
    </div>
  );
}

function IncludedFeatures({ limits }: { limits: PlanLimits }) {
  const rows = [
    "Usuários ilimitados",
    ...(limits.pipeline ? ["CRM com funil de vendas"] : []),
    ...(limits.nexusflow ? ["Automações com NexusFlow"] : []),
    ...(limits.ai_copilot ? ["Copilot para a equipe"] : []),
    ...(limits.public_api ? ["Acesso à API pública"] : []),
  ];
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li
          key={row}
          className="flex items-start gap-2 text-xs leading-relaxed"
        >
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
          {row}
        </li>
      ))}
    </ul>
  );
}

function QuotaSummary({ limits }: { limits: PlanLimits }) {
  return (
    <div className="space-y-3 border-y border-border/60 py-4">
      {quotaRows.map(([label, key]) => (
        <div
          key={key}
          className="flex items-center justify-between gap-2 text-xs"
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="font-semibold tabular-nums">
            {limits[key] === 0 ? "—" : displayQuota(limits[key])}
          </span>
        </div>
      ))}
    </div>
  );
}

function PlanCard({
  plan,
  onEdit,
  onDuplicate,
  workspaces,
}: {
  plan: Plan;
  onEdit: () => void;
  onDuplicate: () => void;
  workspaces: { id: string; name: string }[];
}) {
  const draft = draftFromPlan(plan);
  const Icon = planIcons[plan.slug as keyof typeof planIcons] || Layers3;
  return (
    <article
      className={cn(
        "group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card transition-shadow hover:shadow-lg hover:shadow-black/5",
        plan.slug === "pro" ? "border-primary/40" : "border-border/80",
      )}
    >
      <div
        className={cn(
          "h-1",
          plan.slug === "pro"
            ? "bg-primary"
            : plan.slug === "business"
              ? "bg-violet-400/60"
              : plan.slug === "enterprise"
                ? "bg-amber-400/60"
                : "bg-sky-400/60",
        )}
      />
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-5 flex items-center justify-between gap-2">
          <span
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl",
              plan.slug === "pro"
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
          <Status active={plan.is_active} custom={plan.scope === "custom"} />
        </div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h3 className="break-words text-lg font-semibold">
            {planName(plan)}
          </h3>
          {plan.is_default && (
            <span title="Plano padrão do catálogo" className="text-primary">
              <CheckCheck className="h-4 w-4" />
            </span>
          )}
        </div>
        <p className="mb-5 min-h-[3.75rem] text-xs leading-5 text-muted-foreground">
          {draft.description}
        </p>
        <Price price={Number(plan.price)} />
        <div className="my-5">
          <QuotaSummary limits={draft.limits} />
        </div>
        {plan.scope === "custom" && (
          <div className="mb-4 rounded-lg bg-violet-500/5 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 dark:text-violet-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              {plan.workspace_ids?.length || 0} workspaces vinculados
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {plan.workspace_ids
                ?.map(
                  (id) =>
                    workspaces.find((w) => w.id === id)?.name ||
                    "Workspace indisponível",
                )
                .join(", ") || "Selecione os workspaces no editor."}
            </p>
          </div>
        )}
        <div className="mb-6 flex-1">
          <IncludedFeatures limits={draft.limits} />
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1 gap-2"
            variant={plan.slug === "pro" ? "default" : "secondary"}
            onClick={onEdit}
            aria-label={`Editar ${planName(plan)}`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Editar plano
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onDuplicate}
            title="Criar uma cópia"
            aria-label={`Duplicar ${planName(plan)}`}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}

function QuotaField({
  field,
  value,
  onChange,
}: {
  field: NonNullable<(typeof PLAN_FIELDS)["channels"]>[number];
  value: number;
  onChange: (value: number) => void;
}) {
  const unlimited = isUnlimited(value);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/40 p-4">
      <div className="min-w-0 flex-1 basis-40">
        <Label htmlFor={`limit-${field.key}`} className="text-sm font-medium">
          {field.label}
        </Label>
        {field.hint && (
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            {field.hint}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div>
          <Input
            id={`limit-${field.key}`}
            aria-label={field.label}
            type={unlimited ? "text" : "number"}
            min={0}
            max={UNLIMITED - 1}
            step={1}
            value={unlimited ? "Ilimitado" : value}
            disabled={unlimited}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-28 bg-background text-center tabular-nums"
          />
          {field.unit && !unlimited && (
            <span className="mt-1 block text-center text-[10px] text-muted-foreground">
              {field.unit}
            </span>
          )}
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <Switch
            aria-label={`${field.label}: ilimitado`}
            checked={unlimited}
            onCheckedChange={(checked) => onChange(checked ? UNLIMITED : 0)}
          />
          <span className="text-[10px] text-muted-foreground">Ilimitado</span>
        </div>
      </div>
    </div>
  );
}

function FeatureToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/40 p-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && (
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function PlanStudio() {
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [catalogTab, setCatalogTab] = useState<"public" | "custom">("public");
  const catalogPlans = plans.filter(
    (p) => (p.scope || "public") === catalogTab,
  );
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [section, setSection] = useState<PlanSection>("offer");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "published" | "hidden">("all");
  const dirty = !!draft && JSON.stringify(draft) !== baseline;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await getPlans();
      if (result.error || !result.plans)
        throw new Error(result.error || "Não foi possível carregar os planos.");
      setPlans(orderPlans(result.plans));
      setWorkspaces(result.workspaces || []);
      setIntegrations(result.availableIntegrations || []);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar os planos.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const preventLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLeave);
    return () => window.removeEventListener("beforeunload", preventLeave);
  }, [dirty]);

  const openEditor = (plan: Plan, duplicate = false) => {
    const next = draftFromPlan(plan);
    next.name = planName(plan);
    if (duplicate) {
      delete next.id;
      next.name = `${next.name} — cópia`;
      next.slug = "";
      next.is_default = false;
      next.is_active = false;
      next.scope = catalogTab;
      next.workspace_ids = [];
    }
    setDraft(next);
    setBaseline(duplicate ? "" : JSON.stringify(next));
    setSection("offer");
    setSaveError("");
    setSearch("");
    setWorkspaceSearch("");
    setTemplateOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const createBlank = () => {
    const limits = { ...PLANS.starter.limits };
    for (const key of Object.keys(limits) as (keyof PlanLimits)[]) {
      (limits as unknown as Record<string, number | boolean>)[key] =
        typeof limits[key] === "boolean" ? false : 0;
    }
    limits.users = UNLIMITED;
    setDraft({
      scope: catalogTab,
      workspace_ids: [],
      slug: "",
      name: "",
      description: "",
      price: 0,
      is_active: false,
      is_default: false,
      limits,
      integrations: [],
    });
    setBaseline("");
    setSection("offer");
    setTemplateOpen(false);
    setSaveError("");
    setSearch("");
    setWorkspaceSearch("");
  };
  const update = (patch: Partial<PlanDraft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));
  const leave = () => {
    if (dirty) setDiscardOpen(true);
    else setDraft(null);
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError("");
    try {
      const result = await savePlan({
        ...draft,
        slug: draft.id ? draft.slug : planSlug(draft.name),
      });
      if (!result.success)
        throw new Error(result.error || "Não foi possível salvar o plano.");
      const saved = {
        ...draft,
        id: result.planId,
        slug: draft.id ? draft.slug : planSlug(draft.name),
      };
      setDraft(saved);
      setBaseline(JSON.stringify(saved));
      toast({
        title: "Plano salvo",
        description:
          draft.scope === "custom"
            ? "O plano exclusivo foi salvo para os workspaces selecionados."
            : draft.is_active
              ? "A oferta está atualizada no catálogo e na página inicial."
              : "O plano está salvo e oculto para novas contratações.",
      });
      await load();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar. Tente novamente.",
      );
    } finally {
      setSaving(false);
    }
  };
  const updateIntegration = (id: string, patch: Partial<StudioIntegration>) => {
    if (!draft) return;
    const current = draft.integrations.find((i) => i.integrationId === id) || {
      integrationId: id,
      isEnabled: false,
      includedQuantity: 0,
      additionalCost: 0,
    };
    update({
      integrations: [
        ...draft.integrations.filter((i) => i.integrationId !== id),
        { ...current, ...patch },
      ],
    });
  };

  if (loading && !plans.length && !draft)
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p>Carregando seu catálogo de planos…</p>
      </div>
    );
  if (loadError && !draft)
    return (
      <div role="alert" className="rounded-2xl border bg-card p-8">
        <h1 className="text-xl font-semibold">
          Não foi possível abrir o catálogo
        </h1>
        <p className="my-4 text-muted-foreground">{loadError}</p>
        <Button onClick={() => void load()}>Tentar novamente</Button>
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-7 pb-10">
      {draft ? (
        <>
          <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b bg-background/95 py-4 backdrop-blur-sm">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={leave}
                disabled={saving}
                aria-label="Voltar ao catálogo"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <p className="mb-1 text-xs text-muted-foreground">
                  {draft.scope === "custom" ? "custom-plans" : "Catálogo"} /{" "}
                  {draft.id ? "Editar plano" : "Novo plano"}
                </p>
                <h1 className="break-words text-xl font-semibold">
                  {draft.name || "Crie sua próxima oferta"}
                </h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span
                aria-live="polite"
                className="text-xs text-muted-foreground"
              >
                {saving
                  ? "Salvando…"
                  : dirty
                    ? "Alterações não salvas"
                    : "Tudo salvo"}
              </span>
              <Button
                className="gap-2"
                onClick={() => void save()}
                disabled={saving || !dirty}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {draft.id ? "Salvar alterações" : "Criar plano"}
              </Button>
            </div>
          </header>
          {saveError && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
            >
              {saveError}
            </div>
          )}
          {loadError && (
            <div role="alert" className="rounded-xl border p-4 text-sm">
              O plano foi salvo, mas não foi possível atualizar a listagem.{" "}
              {loadError}
            </div>
          )}
          <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[215px_minmax(0,1fr)_280px] 2xl:grid-cols-[230px_minmax(0,1fr)_300px]">
            <nav
              aria-label="Configuração do plano"
              className="flex gap-1 overflow-x-auto rounded-2xl border bg-card p-2 xl:sticky xl:top-6 xl:flex-col"
            >
              {PLAN_SECTIONS.map((item) => {
                const Icon = sectionIcons[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={section === item.id ? "page" : undefined}
                    onClick={() => setSection(item.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors",
                      section === item.id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>
                      <span className="block whitespace-nowrap text-xs font-semibold">
                        {item.label}
                      </span>
                      <span className="mt-1 hidden text-[10px] opacity-70 xl:block">
                        {item.description}
                      </span>
                    </span>
                  </button>
                );
              })}
              <div className="m-2 mt-4 hidden border-t pt-4 xl:block">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <InfinityIcon className="h-4 w-4 text-primary" />
                  Sem limite de usuários
                </div>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                  Todos os planos incluem a equipe inteira.
                </p>
              </div>
            </nav>
            <section
              className="min-w-0 rounded-2xl border bg-card p-5 sm:p-6"
              aria-label={PLAN_SECTIONS.find((s) => s.id === section)?.label}
            >
              <div className="mb-6 border-b pb-5">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                  {String(
                    PLAN_SECTIONS.findIndex((s) => s.id === section) + 1,
                  ).padStart(2, "0")}{" "}
                  / Configuração do plano
                </p>
                <h2 className="text-xl font-semibold">
                  {PLAN_SECTIONS.find((s) => s.id === section)?.label}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {section === "offer"
                    ? "Apresente o plano e defina como ele será oferecido aos clientes."
                    : section === "integrations"
                      ? "Escolha as integrações disponíveis neste plano e os valores adicionais."
                      : "Defina o que está incluído. Quantidade zero significa que o recurso não faz parte do plano."}
                </p>
              </div>
              <fieldset disabled={saving} className="min-w-0 space-y-4">
                {section === "offer" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="plan-name">Nome do plano</Label>
                      <Input
                        id="plan-name"
                        value={draft.name}
                        maxLength={100}
                        placeholder="Ex.: Profissional Plus"
                        onChange={(e) => update({ name: e.target.value })}
                        className="h-11 bg-background"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <Label htmlFor="plan-description">
                          Uma frase para apresentar o plano
                        </Label>
                        <span className="text-[10px] text-muted-foreground">
                          {draft.description.length}/500
                        </span>
                      </div>
                      <Textarea
                        id="plan-description"
                        value={draft.description}
                        maxLength={500}
                        rows={3}
                        placeholder="Para equipes que querem…"
                        onChange={(e) =>
                          update({ description: e.target.value })
                        }
                        className="resize-none bg-background"
                      />
                      <p className="text-xs text-muted-foreground">
                        {draft.scope === "custom"
                          ? "Esta descrição aparece apenas para os workspaces vinculados."
                          : "Essa descrição aparece junto ao preço na página inicial."}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-5">
                      <Label htmlFor="plan-price">Mensalidade</Label>
                      <div className="mt-3 flex items-center gap-3">
                        <span className="text-xl text-muted-foreground">
                          R$
                        </span>
                        <Input
                          id="plan-price"
                          type="number"
                          min={draft.slug === "enterprise" ? 0 : 0.01}
                          max={999999.99}
                          step="0.01"
                          value={draft.price}
                          onChange={(e) =>
                            update({ price: Number(e.target.value) })
                          }
                          className="h-12 max-w-52 bg-background text-xl font-semibold"
                        />
                        <span className="text-sm text-muted-foreground">
                          / mês
                        </span>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">
                        {draft.slug === "enterprise"
                          ? "Mantenha zero para apresentar esta oferta como “Sob consulta”."
                          : "Valor para novas assinaturas. Assinaturas já contratadas mantêm a mensalidade vigente."}
                      </p>
                    </div>
                    <div className="pt-2">
                      <h3 className="mb-3 text-sm font-semibold">
                        {draft.scope === "custom"
                          ? "Disponibilidade exclusiva"
                          : "Publicação"}
                      </h3>
                      <div className="space-y-3">
                        <FeatureToggle
                          label={
                            draft.scope === "custom"
                              ? "Disponibilizar aos workspaces vinculados"
                              : "Exibir na página inicial"
                          }
                          hint={
                            draft.scope === "custom"
                              ? "A oferta nunca aparece na página inicial ou para outros workspaces."
                              : "Disponibiliza esta oferta para novas contratações."
                          }
                          checked={draft.is_active}
                          onChange={(value) =>
                            update({
                              is_active: value,
                              ...(!value ? { is_default: false } : {}),
                            })
                          }
                        />
                        {draft.scope !== "custom" && (
                          <FeatureToggle
                            label="Marcar como plano padrão"
                            hint="Identifica a oferta padrão do catálogo. Não altera assinaturas existentes."
                            checked={draft.is_default}
                            onChange={(value) =>
                              update({
                                is_default: value,
                                ...(value ? { is_active: true } : {}),
                              })
                            }
                          />
                        )}
                      </div>
                    </div>
                    {draft.scope === "custom" && (
                      <div className="space-y-4 rounded-xl border border-violet-500/25 bg-violet-500/[0.03] p-4">
                        <div>
                          <h3 className="flex items-center gap-2 text-sm font-semibold">
                            <ShieldCheck className="h-4 w-4 text-violet-500" />
                            Workspaces com acesso
                          </h3>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            Selecione quem pode ver e contratar este plano.
                            Vincular um workspace não troca sua assinatura
                            atual.
                          </p>
                        </div>
                        <div className="relative">
                          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            className="bg-background pl-9"
                            aria-label="Buscar workspace"
                            placeholder="Buscar pelo nome do workspace…"
                            value={workspaceSearch}
                            onChange={(e) => setWorkspaceSearch(e.target.value)}
                          />
                        </div>
                        <p className="text-xs font-medium">
                          {draft.workspace_ids.length}{" "}
                          {draft.workspace_ids.length === 1
                            ? "selecionado"
                            : "selecionados"}
                        </p>
                        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                          {workspaces
                            .filter((w) =>
                              w.name
                                .toLowerCase()
                                .includes(workspaceSearch.toLowerCase()),
                            )
                            .map((w) => (
                              <label
                                key={w.id}
                                className={cn(
                                  "flex cursor-pointer items-center gap-3 rounded-lg border p-3",
                                  draft.workspace_ids.includes(w.id)
                                    ? "border-violet-500/40 bg-violet-500/5"
                                    : "bg-background",
                                )}
                              >
                                <input
                                  type="checkbox"
                                  aria-label={`Vincular ${w.name}`}
                                  checked={draft.workspace_ids.includes(w.id)}
                                  onChange={(e) =>
                                    update({
                                      workspace_ids: e.target.checked
                                        ? [...draft.workspace_ids, w.id]
                                        : draft.workspace_ids.filter(
                                            (id) => id !== w.id,
                                          ),
                                    })
                                  }
                                  className="h-4 w-4 accent-violet-600"
                                />
                                <span className="min-w-0">
                                  <span className="block break-words text-sm font-medium">
                                    {w.name}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    ID {w.id.slice(0, 8)}
                                  </span>
                                </span>
                              </label>
                            ))}
                          {!workspaces.some((w) =>
                            w.name
                              .toLowerCase()
                              .includes(workspaceSearch.toLowerCase()),
                          ) && (
                            <p className="py-4 text-center text-xs text-muted-foreground">
                              Nenhum workspace encontrado.
                            </p>
                          )}
                        </div>
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          Remover um vínculo impede novas contratações.
                          Assinaturas já contratadas continuam vigentes.
                        </p>
                      </div>
                    )}
                    <div className="flex gap-3 rounded-xl bg-primary/5 p-4">
                      <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <p className="text-xs leading-5 text-muted-foreground">
                        A contratação usa a cobrança ASAAS configurada na
                        plataforma, com PIX, boleto ou cartão.{" "}
                        <Link
                          href="/superadmin/billing/settings"
                          target="_blank"
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          Configurar pagamentos{" "}
                          <ExternalLink className="inline h-3 w-3" />
                        </Link>
                      </p>
                    </div>
                  </>
                )}
                {PLAN_FIELDS[section]?.map((field) =>
                  field.kind === "number" ? (
                    <QuotaField
                      key={field.key}
                      field={field}
                      value={Number(draft.limits[field.key]) || 0}
                      onChange={(value) =>
                        update({
                          limits: updatePlanLimit(
                            draft.limits,
                            field.key,
                            value,
                          ),
                        })
                      }
                    />
                  ) : (
                    <FeatureToggle
                      key={field.key}
                      label={field.label}
                      hint={field.hint}
                      checked={Boolean(draft.limits[field.key])}
                      onChange={(value) =>
                        update({
                          limits: updatePlanLimit(
                            draft.limits,
                            field.key,
                            value,
                          ),
                        })
                      }
                    />
                  ),
                )}
                {section === "integrations" && (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        aria-label="Buscar integração"
                        placeholder="Buscar integração…"
                        className="bg-background pl-9"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {draft.integrations.filter((i) => i.isEnabled).length}{" "}
                      habilitadas neste plano. Os valores adicionais configuram
                      o catálogo; cobranças extras precisam de contratação
                      própria.
                    </p>
                    {integrations
                      .filter((i) =>
                        i.name.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((integration) => {
                        const config = draft.integrations.find(
                          (i) => i.integrationId === integration.id,
                        );
                        return (
                          <div
                            key={integration.id}
                            className={cn(
                              "rounded-xl border p-4",
                              config?.isEnabled
                                ? "border-primary/30 bg-primary/[0.03]"
                                : "border-border/70",
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                                <Plug className="h-4 w-4 text-muted-foreground" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-medium">
                                  {integration.name}
                                </h3>
                                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                  {integration.description}
                                </p>
                              </div>
                              <Switch
                                aria-label={`Habilitar ${integration.name}`}
                                checked={config?.isEnabled || false}
                                onCheckedChange={(value) =>
                                  updateIntegration(integration.id, {
                                    isEnabled: value,
                                  })
                                }
                              />
                            </div>
                            {config?.isEnabled && (
                              <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                  <Label
                                    htmlFor={`quantity-${integration.id}`}
                                    className="text-xs"
                                  >
                                    Quantidade incluída
                                  </Label>
                                  <Input
                                    id={`quantity-${integration.id}`}
                                    type="number"
                                    min={0}
                                    max={UNLIMITED}
                                    step={1}
                                    value={config.includedQuantity}
                                    onChange={(e) =>
                                      updateIntegration(integration.id, {
                                        includedQuantity: Number(
                                          e.target.value,
                                        ),
                                      })
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label
                                    htmlFor={`extra-${integration.id}`}
                                    className="text-xs"
                                  >
                                    Unidade adicional (R$)
                                  </Label>
                                  <Input
                                    id={`extra-${integration.id}`}
                                    type="number"
                                    min={0}
                                    max={999999.99}
                                    step="0.01"
                                    value={config.additionalCost}
                                    onChange={(e) =>
                                      updateIntegration(integration.id, {
                                        additionalCost: Number(e.target.value),
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    {!integrations.some((i) =>
                      i.name.toLowerCase().includes(search.toLowerCase()),
                    ) && (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        Nenhuma integração encontrada.
                      </p>
                    )}
                  </>
                )}
              </fieldset>
              <div className="mt-6 flex items-center justify-between gap-3 border-t pt-5">
                <span className="text-xs text-muted-foreground">
                  {PLAN_SECTIONS.findIndex((s) => s.id === section) + 1} de{" "}
                  {PLAN_SECTIONS.length} categorias
                </span>
                {section !== "integrations" && (
                  <Button
                    variant="ghost"
                    className="gap-2 text-xs"
                    onClick={() =>
                      setSection(
                        PLAN_SECTIONS[
                          PLAN_SECTIONS.findIndex((s) => s.id === section) + 1
                        ].id,
                      )
                    }
                  >
                    Próxima categoria
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </section>
            <aside className="space-y-4 xl:sticky xl:top-6">
              <div className="flex items-center justify-between px-1">
                <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Eye className="h-4 w-4" />
                  Prévia da oferta
                </p>
                <span className="flex items-center gap-1.5 text-[10px] text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Ao vivo
                </span>
              </div>
              <div className="overflow-hidden rounded-2xl border border-primary/25 bg-card shadow-lg shadow-primary/5">
                <div className="h-1 bg-primary" />
                <div className="space-y-5 p-5">
                  <div>
                    <h3 className="break-words text-xl font-semibold">
                      {draft.name || "Nome do plano"}
                    </h3>
                    <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                      {draft.description ||
                        "A descrição da sua oferta aparece aqui."}
                    </p>
                  </div>
                  {draft.price > 0 || draft.slug === "enterprise" ? (
                    <Price price={draft.price} />
                  ) : (
                    <p className="text-lg font-semibold text-muted-foreground">
                      Defina a mensalidade
                    </p>
                  )}
                  <QuotaSummary limits={draft.limits} />
                  <IncludedFeatures limits={draft.limits} />
                  <div className="rounded-lg bg-primary p-3 text-center text-xs font-medium text-primary-foreground">
                    {draft.slug === "enterprise" && draft.price === 0
                      ? "Falar com vendas"
                      : "Começar agora"}
                  </div>
                  <p className="text-center text-[10px] text-muted-foreground">
                    Representação da oferta para o cliente
                  </p>
                </div>
              </div>
              <div className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap gap-2">
                  <Status
                    active={draft.is_active}
                    custom={draft.scope === "custom"}
                  />
                  {draft.is_default && <Status active initial />}
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {draft.scope === "custom"
                    ? `Plano exclusivo para ${draft.workspace_ids.length} ${draft.workspace_ids.length === 1 ? "workspace" : "workspaces"}. Não aparece na página inicial.`
                    : draft.is_active
                      ? "Ao salvar, preço e recursos serão atualizados na oferta pública."
                      : "Este plano fica salvo no catálogo, sem aparecer para novos clientes."}
                </p>
              </div>
            </aside>
          </div>
        </>
      ) : (
        <>
          <header className="relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-8">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-44 h-[440px] w-[440px] rounded-full bg-primary/[0.06] blur-3xl"
            />
            <div className="relative flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-2xl">
                <p className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                  <Layers3 className="h-3.5 w-3.5" />
                  Catálogo comercial
                </p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Uma boa oferta começa aqui.
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  Organize suas ofertas públicas e crie planos exclusivos para
                  workspaces específicos.
                </p>
              </div>
              <Button
                onClick={() => setTemplateOpen(true)}
                className="h-11 gap-2 px-5"
              >
                <Plus className="h-4 w-4" />
                {catalogTab === "custom"
                  ? "Criar plano customizado"
                  : "Criar plano"}
              </Button>
            </div>
            <div className="relative mt-7 flex flex-wrap items-center justify-between gap-5 border-t border-border/60 pt-5">
              <div className="flex flex-wrap gap-6 text-sm">
                <span>
                  <strong className="mr-2 text-xl font-semibold tabular-nums">
                    {plans.length}
                  </strong>
                  <span className="text-muted-foreground">
                    planos no catálogo
                  </span>
                </span>
                <span>
                  <strong className="mr-2 text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {
                      plans.filter((p) => p.is_active && p.scope !== "custom")
                        .length
                    }
                  </strong>
                  <span className="text-muted-foreground">públicos ativos</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <InfinityIcon className="h-4 w-4" />
                  Usuários em todos os planos
                </span>
              </div>
              <Link
                href="/#planos"
                target="_blank"
                className="flex items-center gap-2 text-xs font-medium text-primary hover:underline"
              >
                Ver página inicial
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </header>
          <Tabs
            value={catalogTab}
            onValueChange={(value) => {
              setCatalogTab(value as "public" | "custom");
              setFilter("all");
            }}
            className="space-y-6"
          >
            <TabsList
              aria-label="Tipos de planos"
              className="h-auto w-full justify-start gap-5 rounded-none border-b bg-transparent p-0"
            >
              <TabsTrigger
                value="public"
                className="gap-2 rounded-none border-b-2 border-transparent px-2 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <Layers3 className="h-4 w-4" />
                Planos públicos
                <span className="rounded bg-muted px-1.5 text-xs">
                  {plans.filter((p) => p.scope !== "custom").length}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="custom"
                className="gap-2 rounded-none border-b-2 border-transparent px-2 py-3 shadow-none data-[state=active]:border-violet-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <ShieldCheck className="h-4 w-4" />
                custom-plans
                <span className="rounded bg-muted px-1.5 text-xs">
                  {plans.filter((p) => p.scope === "custom").length}
                </span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value={catalogTab} className="space-y-7">
              {catalogTab === "custom" && (
                <div className="flex gap-3 rounded-xl border border-violet-500/20 bg-violet-500/5 p-5">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-violet-500" />
                  <div>
                    <h2 className="text-sm font-semibold">
                      Condições especiais. Acesso exclusivo.
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Planos customizados são visíveis apenas nos workspaces
                      vinculados. Defina a mensalidade e os recursos sem
                      publicar a oferta na página inicial.
                    </p>
                  </div>
                </div>
              )}
              <section aria-label="Catálogo de planos" className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {catalogTab === "custom"
                        ? "Planos por workspace"
                        : "Seus planos públicos"}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Edite uma oferta ou use um plano como ponto de partida.
                    </p>
                  </div>
                  <div
                    className="flex rounded-lg bg-muted p-1"
                    aria-label="Filtrar planos"
                  >
                    {(
                      [
                        ["all", "Todos"],
                        [
                          "published",
                          catalogTab === "custom"
                            ? "Disponíveis"
                            : "Publicados",
                        ],
                        ["hidden", "Ocultos"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        type="button"
                        key={id}
                        onClick={() => setFilter(id)}
                        aria-pressed={filter === id}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                          filter === id
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 min-[1380px]:grid-cols-4">
                  {catalogPlans
                    .filter(
                      (p) =>
                        filter === "all" ||
                        (filter === "published" ? p.is_active : !p.is_active),
                    )
                    .map((plan) => (
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        workspaces={workspaces}
                        onEdit={() => openEditor(plan)}
                        onDuplicate={() => openEditor(plan, true)}
                      />
                    ))}
                </div>
                {!catalogPlans.some(
                  (p) =>
                    filter === "all" ||
                    (filter === "published" ? p.is_active : !p.is_active),
                ) && (
                  <div className="rounded-2xl border border-dashed p-10 text-center">
                    <FileText className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
                    <h3 className="font-medium">
                      {filter === "hidden"
                        ? "Nenhum plano oculto"
                        : filter === "published"
                          ? "Nenhum plano publicado"
                          : catalogTab === "custom"
                            ? "Crie seu primeiro plano exclusivo"
                            : "Seu catálogo começa com o primeiro plano"}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {filter === "all"
                        ? catalogTab === "custom"
                          ? "Use um plano atual como base e escolha os workspaces que terão acesso."
                          : "Crie uma oferta com os recursos que seus clientes precisam."
                        : "Altere a publicação dentro do editor de cada plano."}
                    </p>
                    {filter === "all" && (
                      <Button
                        className="mt-4"
                        onClick={() => setTemplateOpen(true)}
                      >
                        Criar primeiro plano
                      </Button>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <CheckCheck className="h-3.5 w-3.5 text-primary" />
                    Plano padrão do catálogo
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" />
                    {catalogTab === "custom"
                      ? "Exclusivo = disponível apenas aos workspaces vinculados"
                      : "Publicado = disponível na página inicial"}
                  </span>
                </div>
              </section>
              {catalogPlans.length > 1 && (
                <section className="overflow-hidden rounded-2xl border bg-card">
                  <div className="flex items-center gap-3 border-b p-5">
                    <span className="rounded-lg bg-muted p-2">
                      <Layers3 className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold">
                        Compare o que cada plano entrega
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Capacidades atuais salvas no catálogo.
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[650px] text-left text-xs">
                      <thead>
                        <tr className="bg-muted/30">
                          <th className="p-4 pl-5 font-medium text-muted-foreground">
                            Recurso incluído
                          </th>
                          {catalogPlans.map((p) => (
                            <th
                              key={p.id}
                              className="p-4 text-center font-semibold"
                            >
                              {planName(p)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            ["Conversas por mês", "monthly_chats"],
                            ["Agentes de IA", "autopilot_agents"],
                            ["Equipes", "teams"],
                            ["CRM com funil de vendas", "pipeline"],
                            ["Automações NexusFlow", "nexusflow"],
                            ["API pública", "public_api"],
                          ] as const
                        ).map(([label, key]) => (
                          <tr key={key} className="border-t border-border/50">
                            <th className="p-3.5 pl-5 font-normal text-muted-foreground">
                              {label}
                            </th>
                            {catalogPlans.map((p) => {
                              const value = draftFromPlan(p).limits[key];
                              return (
                                <td
                                  key={p.id}
                                  className="p-3.5 text-center font-medium"
                                >
                                  {typeof value === "boolean" ? (
                                    value ? (
                                      <Check
                                        className="mx-auto h-4 w-4 text-emerald-500"
                                        aria-label="Incluído"
                                      />
                                    ) : (
                                      <span
                                        aria-label="Não incluído"
                                        className="text-muted-foreground/40"
                                      >
                                        —
                                      </span>
                                    )
                                  ) : (
                                    displayQuota(value)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </TabsContent>
          </Tabs>
          <div className="grid gap-4 lg:grid-cols-2">
            <Link
              href="/superadmin/billing/settings"
              className="group flex items-center gap-4 rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CreditCard className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h3 className="text-sm font-semibold">Pagamentos com ASAAS</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Configure a conexão para receber por PIX, boleto e cartão.
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link
              href="/superadmin/billing"
              className="group flex items-center gap-4 rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Wallet className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h3 className="text-sm font-semibold">
                  Assinaturas e cobranças
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Acompanhe clientes, pagamentos e a situação de cada
                  assinatura.
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </div>
        </>
      )}
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              Como você quer começar?
            </DialogTitle>
            <DialogDescription>
              Use um dos seus planos como base. Você poderá ajustar tudo antes
              de publicar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-3 sm:grid-cols-2">
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => openEditor(p, true)}
                className="group rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <div className="mb-3 flex items-center justify-between">
                  <Copy className="h-4 w-4 text-primary" />
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                </div>
                <span className="block font-semibold">
                  A partir do {planName(p)}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {Number(p.price) > 0
                    ? `${money(Number(p.price))}/mês`
                    : "Sob consulta"}{" "}
                  · Copiar recursos
                </span>
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            className="h-12 gap-2"
            onClick={createBlank}
          >
            <WandSparkles className="h-4 w-4" />
            Começar do zero
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {catalogTab === "custom"
              ? "Novos planos começam ocultos. Escolha os workspaces antes de disponibilizar."
              : "Novos planos começam ocultos. Publique quando estiver pronto."}
          </p>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
            <AlertDialogDescription>
              Suas alterações ainda não foram salvas. Você pode continuar
              editando ou voltar ao catálogo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDraft(null);
                setSaveError("");
              }}
            >
              Descartar e voltar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
