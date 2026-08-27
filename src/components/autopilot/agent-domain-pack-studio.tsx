'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Database,
  Eye,
  FileText,
  GitBranch,
  Layers3,
  Loader2,
  LockKeyhole,
  PlayCircle,
  RefreshCw,
  Rocket,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  Wrench,
} from 'lucide-react';

import type { AutopilotConfig, KnowledgeBaseDocument } from '@/lib/types';
import {
  compileAutopilotConfigDomainPackAction,
  linkAgentDomainPackToAutopilotAction,
  listAgentDomainPacksAction,
  publishAgentDomainPackAction,
} from '@/actions/agent-runtime';
import { getAgentDomainReadiness } from '@/services/agent-runtime/prompt-context';
import type { AgentDomainPack } from '@/services/agent-runtime/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type AgentDomainPackStudioProps = {
  workspaceId?: string | null;
  config: AutopilotConfig | null;
  knowledgeDocuments: KnowledgeBaseDocument[];
  enabledToolNames: string[];
};

type BusyState = 'load' | 'compile' | 'activate' | null;

const READINESS_ICONS = {
  identity: Building2,
  knowledge: Database,
  capabilities: Wrench,
  procedures: Route,
  policies: LockKeyhole,
} as const;

function packStatusLabel(status: AgentDomainPack['status']): string {
  if (status === 'published') return 'Publicada';
  if (status === 'archived') return 'Arquivada';
  return 'Rascunho';
}

function activationStepState(input: {
  step: 1 | 2 | 3;
  pack: AgentDomainPack | null;
  linkedPackId: string | null;
}) {
  const generated = Boolean(input.pack);
  const published = input.pack?.status === 'published';
  const active = Boolean(input.pack && input.pack.id === input.linkedPackId);
  if (input.step === 1) return generated ? 'done' : 'current';
  if (input.step === 2) return published ? 'done' : generated ? 'current' : 'upcoming';
  return active ? 'done' : published ? 'current' : 'upcoming';
}

function ContextList({ title, empty, values }: { title: string; empty: string; values: string[] }) {
  return (
    <div className="rounded-2xl border border-border bg-background/70 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      {values.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {values.slice(0, 12).map((value) => (
            <Badge key={value} variant="secondary" className="max-w-full rounded-full px-3 py-1 font-medium">
              <span className="truncate">{value}</span>
            </Badge>
          ))}
          {values.length > 12 && <Badge variant="outline" className="rounded-full">+{values.length - 12}</Badge>}
        </div>
      ) : (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

export function AgentDomainPackStudio({
  workspaceId,
  config,
  knowledgeDocuments,
  enabledToolNames,
}: AgentDomainPackStudioProps) {
  const [packs, setPacks] = useState<AgentDomainPack[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [linkedPackId, setLinkedPackId] = useState<string | null>(config?.agent_domain_pack_id || null);
  const [businessName, setBusinessName] = useState(config?.name || '');
  const [niche, setNiche] = useState('');
  const [description, setDescription] = useState('');
  const [tone, setTone] = useState('humano, claro e objetivo');
  const [slug, setSlug] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setLinkedPackId(config?.agent_domain_pack_id || null);
    setBusinessName((current) => current || config?.name || '');
  }, [config?.agent_domain_pack_id, config?.name]);

  const loadPacks = useCallback(async (preferredPackId?: string | null) => {
    if (!workspaceId) return;
    setBusy('load');
    try {
      const result = await listAgentDomainPacksAction(workspaceId);
      const nextPacks = result.packs || [];
      setPacks(nextPacks);
      setSelectedPackId((current) => {
        const retained = current && nextPacks.some((pack) => pack.id === current) ? current : null;
        return preferredPackId
          || retained
          || linkedPackId
          || nextPacks.find((pack) => pack.status === 'draft')?.id
          || nextPacks[0]?.id
          || null;
      });
      if (result.error) setFeedback(result.error);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível carregar as versões.');
    } finally {
      setBusy(null);
    }
  }, [linkedPackId, workspaceId]);

  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  const selectedPack = useMemo(
    () => packs.find((pack) => pack.id === selectedPackId) || null,
    [packs, selectedPackId],
  );
  const readiness = useMemo(
    () => getAgentDomainReadiness(selectedPack?.definition),
    [selectedPack],
  );
  const sourceSteps = [
    {
      label: 'Identidade do negócio',
      ready: Boolean(businessName.trim() && description.trim()),
      detail: description.trim() ? 'Contexto explícito, sem depender de suposições.' : 'Explique em uma frase o que o negócio faz.',
    },
    {
      label: 'Conhecimento confiável',
      ready: knowledgeDocuments.length > 0,
      detail: `${knowledgeDocuments.length} documento(s) disponível(is) como fonte de verdade.`,
    },
    {
      label: 'Capacidades reais',
      ready: enabledToolNames.length > 0,
      detail: `${enabledToolNames.length} ferramenta(s) autorizada(s) para executar ações.`,
    },
    {
      label: 'Processos em etapas',
      ready: Boolean(config?.flow_graph || config?.workflow_definition),
      detail: config?.flow_graph || config?.workflow_definition
        ? 'Existe um fluxo que pode ser retomado passo a passo.'
        : 'Adicione um fluxo para automatizar tarefas de várias etapas.',
    },
  ];
  const sourceScore = Math.round((sourceSteps.filter((step) => step.ready).length / sourceSteps.length) * 100);
  const displayedScore = selectedPack ? readiness.score : sourceScore;
  const identity = selectedPack?.definition.identity;

  useEffect(() => {
    if (!selectedPack) return;
    setBusinessName(selectedPack.definition.identity?.businessName || config?.name || '');
    setNiche(selectedPack.definition.identity?.niche || '');
    setDescription(selectedPack.definition.identity?.description || '');
    setTone(selectedPack.definition.responseStyle?.tone || 'humano, claro e objetivo');
    setSlug(selectedPack.slug || '');
  }, [config?.name, selectedPack]);

  const compile = async () => {
    if (!workspaceId || !config) return;
    if (!businessName.trim() || !description.trim()) {
      setFeedback('Preencha o nome e a descrição do negócio para gerar um contexto realmente neutro e preciso.');
      return;
    }
    setBusy('compile');
    setFeedback(null);
    try {
      const result = await compileAutopilotConfigDomainPackAction({
        workspaceId,
        autopilotConfigId: config.id,
        businessName: businessName.trim(),
        niche: niche.trim() || null,
        description: description.trim(),
        tone: tone.trim() || null,
        language: 'pt-BR',
        responseConstraints: [
          'Respostas claras, escaneáveis e orientadas ao próximo passo.',
          'Nunca presumir informações de outra área de atuação.',
          'Distinguir fatos confirmados, ações executadas e pendências.',
        ],
        slug: slug.trim() || null,
      });
      if (result.success && result.pack) {
        await loadPacks(result.pack.id);
        setSelectedPackId(result.pack.id);
        setFeedback(`Versão ${result.pack.version} criada. Confira o mapa abaixo e ative quando estiver pronta.`);
      } else {
        setFeedback(result.error || 'Não foi possível gerar a versão.');
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível gerar a versão.');
    } finally {
      setBusy(null);
    }
  };

  const activate = async () => {
    if (!workspaceId || !config || !selectedPack) return;
    setBusy('activate');
    setFeedback(null);
    try {
      let packToActivate = selectedPack;
      if (packToActivate.status !== 'published') {
        const publishResult = await publishAgentDomainPackAction({ workspaceId, packId: packToActivate.id });
        if (!publishResult.success || !publishResult.pack) {
          setFeedback(publishResult.error || 'Não foi possível publicar esta versão.');
          return;
        }
        packToActivate = publishResult.pack;
      }

      const linkResult = await linkAgentDomainPackToAutopilotAction({
        workspaceId,
        autopilotConfigId: config.id,
        domainPackId: packToActivate.id,
      });
      if (!linkResult.success) {
        setFeedback(linkResult.error || 'A versão foi publicada, mas não pôde ser ativada.');
        return;
      }
      setLinkedPackId(packToActivate.id);
      await loadPacks(packToActivate.id);
      setFeedback(`Versão ${packToActivate.version} ativa. As próximas conversas já usarão este contexto.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível ativar esta versão.');
    } finally {
      setBusy(null);
    }
  };

  const activationSteps = [
    { step: 1 as const, label: 'Gerar', detail: 'Transforma a configuração em uma versão revisável.' },
    { step: 2 as const, label: 'Publicar', detail: 'Congela a versão para garantir rastreabilidade.' },
    { step: 3 as const, label: 'Ativar', detail: 'Passa a usar o contexto nas próximas conversas.' },
  ];

  return (
    <div className="grid gap-5 pb-8">
      <section className="relative overflow-hidden rounded-[32px] border border-primary/15 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.18),transparent_38%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--muted)/0.42))] p-6 shadow-sm sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border border-primary/10" />
        <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center">
          <div>
            <Badge className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-700 shadow-none dark:text-emerald-300">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Núcleo universal ativo
            </Badge>
            <h2 className="mt-5 max-w-4xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Uma IA neutra por padrão. Especialista no seu negócio por contexto.
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">
              Defina a identidade uma vez. A Dialogy combina conhecimento, ferramentas, políticas e processos sem carregar premissas de outros setores — e preserva tarefas complexas entre os turnos.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {[
                { icon: BrainCircuit, label: 'Sem viés setorial' },
                { icon: Layers3, label: 'Contexto versionado' },
                { icon: Route, label: 'Execução em etapas' },
                { icon: ShieldCheck, label: 'Ações verificáveis' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-2 text-xs font-medium text-foreground backdrop-blur">
                  <Icon className="h-3.5 w-3.5 text-primary" /> {label}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-border bg-background/80 p-5 shadow-sm backdrop-blur">
            <div className="flex items-center gap-4">
              <div
                className="grid h-24 w-24 shrink-0 place-items-center rounded-full p-[7px]"
                style={{ background: `conic-gradient(hsl(var(--primary)) ${displayedScore * 3.6}deg, hsl(var(--muted)) 0deg)` }}
              >
                <div className="grid h-full w-full place-items-center rounded-full bg-background text-center">
                  <div><span className="text-2xl font-semibold text-foreground">{displayedScore}</span><span className="text-xs text-muted-foreground">%</span></div>
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Clareza do contexto</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{displayedScore === 100 ? 'Pronto para operar' : 'Ainda pode evoluir'}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">O núcleo neutro permanece ativo mesmo enquanto você completa o contexto.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Card className="overflow-hidden rounded-[28px] border-border bg-card shadow-sm">
        <CardHeader className="gap-3 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Badge variant="outline" className="rounded-full"><Building2 className="mr-1.5 h-3.5 w-3.5" /> 1. Ensine o contexto</Badge>
              <CardTitle className="mt-4 text-2xl">O que esta IA representa?</CardTitle>
              <CardDescription className="mt-2 max-w-2xl text-sm leading-6">
                Escreva como explicaria o negócio para uma nova pessoa da equipe. Essa definição substitui qualquer suposição implícita.
              </CardDescription>
            </div>
            <Button variant="ghost" className="rounded-full" onClick={() => setAdvanced((current) => !current)}>
              {advanced ? <Eye className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
              {advanced ? 'Ocultar detalhes' : 'Ver detalhes técnicos'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-7 border-t border-border p-6 sm:p-8 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="grid gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="agent-business-name">Empresa, marca ou operação</Label>
                <Input id="agent-business-name" value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Ex.: Clínica Horizonte" />
                <p className="text-xs leading-5 text-muted-foreground">Quem a IA representa ao conversar.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-domain-pack-niche">Área de atuação</Label>
                <Input id="agent-domain-pack-niche" value={niche} onChange={(event) => setNiche(event.target.value)} placeholder="Ex.: saúde, educação, varejo, serviços" />
                <p className="text-xs leading-5 text-muted-foreground">Serve para adaptar linguagem, nunca para inventar regras.</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-business-description">O que o negócio faz e para quem?</Label>
              <Textarea
                id="agent-business-description"
                value={description}
                onChange={(event) => setDescription(event.target.value.slice(0, 2000))}
                placeholder="Ex.: Ajudamos famílias a agendar consultas e exames, acompanhar autorizações e receber orientações administrativas. Não oferecemos diagnóstico médico pelo atendimento virtual."
                className="min-h-32 resize-y leading-6"
              />
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>Inclua limites importantes e o principal resultado esperado.</span><span>{description.trim().length}/2000</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-response-tone">Como deve soar?</Label>
              <Input id="agent-response-tone" value={tone} onChange={(event) => setTone(event.target.value)} placeholder="Humano, claro e objetivo" />
            </div>
            {advanced && (
              <div className="space-y-2 rounded-2xl border border-dashed border-border bg-muted/20 p-4">
                <Label htmlFor="agent-domain-pack-slug">Identificador técnico da versão</Label>
                <Input id="agent-domain-pack-slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="clinica-horizonte" />
                <p className="text-xs leading-5 text-muted-foreground">Use o mesmo identificador para publicar novas versões do mesmo contexto.</p>
              </div>
            )}
            <Button className="h-11 w-full rounded-full sm:w-fit sm:px-6" onClick={() => void compile()} disabled={!config || busy !== null}>
              {busy === 'compile' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Gerar nova versão do contexto
            </Button>
          </div>

          <div className="grid content-start gap-3 rounded-3xl border border-border bg-muted/20 p-4 sm:p-5">
            <div className="mb-1 flex items-center justify-between gap-3">
              <div><div className="text-sm font-semibold text-foreground">O que será compilado</div><div className="mt-1 text-xs text-muted-foreground">Uma visão antes de gerar.</div></div>
              <Badge variant="secondary" className="rounded-full">{sourceScore}%</Badge>
            </div>
            {sourceSteps.map((step) => (
              <div key={step.label} className="flex gap-3 rounded-2xl border border-border bg-background/70 p-3.5">
                {step.ready ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/35" />}
                <div className="min-w-0"><div className="text-sm font-semibold text-foreground">{step.label}</div><div className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</div></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-[28px] border-border bg-card shadow-sm">
        <CardHeader className="gap-4 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Badge variant="outline" className="rounded-full"><GitBranch className="mr-1.5 h-3.5 w-3.5" /> 2. Revise e ative</Badge>
              <CardTitle className="mt-4 text-2xl">Mapa de inteligência</CardTitle>
              <CardDescription className="mt-2 max-w-2xl text-sm leading-6">Veja de forma concreta quem a IA representa, o que sabe, o que pode executar e quais tarefas consegue conduzir em etapas.</CardDescription>
            </div>
            <Button variant="outline" className="rounded-full" onClick={() => void loadPacks()} disabled={busy !== null}>
              {busy === 'load' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Atualizar
            </Button>
          </div>
        </CardHeader>

        <CardContent className="grid gap-6 border-t border-border p-6 sm:p-8">
          {busy === 'load' && packs.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando versões…</div>
          ) : packs.length === 0 ? (
            <div className="grid min-h-52 place-items-center rounded-3xl border border-dashed border-border bg-muted/10 p-8 text-center">
              <div><BrainCircuit className="mx-auto h-9 w-9 text-primary/70" /><div className="mt-4 font-semibold text-foreground">Nenhuma versão criada ainda</div><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Complete a identidade acima e gere a primeira versão. Nada muda no atendimento até você ativá-la.</p></div>
            </div>
          ) : (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {packs.map((pack) => {
                  const isActive = pack.id === linkedPackId;
                  const isSelected = pack.id === selectedPackId;
                  return (
                    <button key={pack.id} type="button" onClick={() => setSelectedPackId(pack.id)} className={`min-w-[220px] rounded-2xl border p-4 text-left transition-all ${isSelected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-background hover:border-primary/35'}`}>
                      <span className="flex items-center justify-between gap-2"><span className="font-semibold text-foreground">Versão {pack.version}</span>{isActive && <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Versão ativa" />}</span>
                      <span className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Badge variant={pack.status === 'published' ? 'secondary' : 'outline'} className="rounded-full">{packStatusLabel(pack.status)}</Badge>{isActive && <span className="font-medium text-emerald-600 dark:text-emerald-400">Em uso</span>}</span>
                    </button>
                  );
                })}
              </div>

              {selectedPack && (
                <div className="grid gap-6">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {readiness.items.map((item) => {
                      const Icon = READINESS_ICONS[item.id];
                      return (
                        <div key={item.id} className={`rounded-2xl border p-4 ${item.ready ? 'border-emerald-500/20 bg-emerald-500/[0.06]' : 'border-amber-500/20 bg-amber-500/[0.06]'}`}>
                          <div className="flex items-center justify-between gap-3"><Icon className={`h-5 w-5 ${item.ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`} /><span className="text-xs font-semibold text-muted-foreground">{item.count}</span></div>
                          <div className="mt-3 text-sm font-semibold text-foreground">{item.label}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
                    <div className="rounded-3xl border border-border bg-muted/10 p-5 sm:p-6">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div><div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Identidade ativa nesta versão</div><h3 className="mt-2 text-xl font-semibold text-foreground">{identity?.businessName || selectedPack.name}</h3><p className="mt-1 text-sm text-muted-foreground">{identity?.niche || 'Área não definida — comportamento setorial permanece neutro.'}</p></div>
                        <Badge variant="outline" className="rounded-full">{selectedPack.slug}</Badge>
                      </div>
                      <p className="mt-5 rounded-2xl border border-border bg-background/70 p-4 text-sm leading-7 text-foreground/85">{identity?.description || 'Esta versão ainda não possui uma descrição explícita do negócio.'}</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <ContextList title="Objetivos reconhecidos" empty="Os objetivos serão identificados pela mensagem e pelos fluxos atuais." values={(selectedPack.definition.goals || []).map((goal) => goal.label)} />
                        <ContextList title="Ferramentas autorizadas" empty="A IA responde e coleta dados, mas não executa operações externas." values={selectedPack.definition.toolNames || []} />
                        <ContextList title="Processos em etapas" empty="Nenhum processo complexo foi vinculado a esta versão." values={(selectedPack.definition.procedures || []).map((procedure) => procedure.name)} />
                        <ContextList title="Políticas explícitas" empty="Adicione políticas para tornar decisões sensíveis mais previsíveis." values={(selectedPack.definition.policies || []).map((policy) => policy.rule)} />
                      </div>
                    </div>

                    <div className="grid content-start gap-4 rounded-3xl border border-border bg-background p-5 sm:p-6">
                      <div><div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Publicação segura</div><h3 className="mt-2 text-lg font-semibold text-foreground">Como esta versão entra em operação</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">A ativação é reversível: versões publicadas ficam preservadas para auditoria.</p></div>
                      <div className="grid gap-2">
                        {activationSteps.map((item, index) => {
                          const state = activationStepState({ step: item.step, pack: selectedPack, linkedPackId });
                          return (
                            <div key={item.step} className="relative flex gap-3 rounded-2xl border border-border bg-muted/15 p-3.5">
                              {index < activationSteps.length - 1 && <div className="absolute left-[25px] top-10 h-7 w-px bg-border" />}
                              <div className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold ${state === 'done' ? 'border-emerald-500 bg-emerald-500 text-white' : state === 'current' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground'}`}>{state === 'done' ? <Check className="h-4 w-4" /> : item.step}</div>
                              <div><div className="text-sm font-semibold text-foreground">{item.label}</div><div className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.detail}</div></div>
                            </div>
                          );
                        })}
                      </div>
                      {selectedPack.id === linkedPackId ? (
                        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-4 text-sm font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5 shrink-0" /> Esta é a versão usada nas próximas conversas.</div>
                      ) : (
                        <Button className="h-11 w-full rounded-full" onClick={() => void activate()} disabled={busy !== null || selectedPack.status === 'archived'}>
                          {busy === 'activate' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />} Publicar e ativar esta versão {busy !== 'activate' && <ArrowRight className="ml-2 h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-3xl border border-primary/15 bg-primary/[0.04] p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
                    <PlayCircle className="h-6 w-6 text-primary" />
                    <div><div className="font-semibold text-foreground">Como tarefas complexas são executadas</div><div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-4">{['Entender o objetivo', 'Quebrar em etapas', 'Executar e verificar', 'Retomar sem perder contexto'].map((label, index) => (<div key={label} className="flex items-center gap-2 rounded-xl border border-border bg-background/70 px-3 py-2.5"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{index + 1}</span><span className="text-xs font-medium text-foreground/80">{label}</span></div>))}</div></div>
                  </div>

                  {advanced && (
                    <details open className="rounded-3xl border border-border bg-muted/15 p-5">
                      <summary className="cursor-pointer text-sm font-semibold text-foreground">Definição técnica compilada</summary>
                      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><FileText className="h-3.5 w-3.5" /> Somente para auditoria e diagnóstico.</div>
                      <pre className="mt-4 max-h-[460px] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-background p-4 text-xs leading-5 text-muted-foreground">{JSON.stringify(selectedPack.definition, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )}
            </>
          )}

          {feedback && <div role="status" aria-live="polite" className="rounded-2xl border border-primary/15 bg-primary/[0.05] px-4 py-3 text-sm leading-6 text-foreground">{feedback}</div>}
        </CardContent>
      </Card>

      <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/15 px-4 py-3 text-xs leading-5 text-muted-foreground">
        <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>A neutralidade é garantida pelo núcleo. O pacote adiciona contexto explícito; conhecimento e ferramentas continuam limitados ao workspace e ao turno atual.</span>
      </div>
    </div>
  );
}
