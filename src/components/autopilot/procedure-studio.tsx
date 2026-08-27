'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Blocks,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Copy,
  FileClock,
  GitBranch,
  History,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  WandSparkles,
  Webhook,
  XCircle,
} from 'lucide-react';

import {
  archiveProcedureAction,
  generateProcedureWithAiAction,
  listProcedureStudioAction,
  publishProcedureAction,
  restoreProcedureVersionAction,
  saveProcedureDraftAction,
  simulateProcedureAction,
} from '@/actions/procedures';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ProcedureStudioRecord } from '@/services/procedures/repository';
import {
  PROCEDURE_INTENTS,
  PROCEDURE_STEP_TYPES,
  type ProcedureStudioDocument,
  type ProcedureStudioStep,
  type ProcedureToolOption,
} from '@/services/procedures/schemas';
import {
  createBlankProcedure,
  createProcedureStep,
  createWifiCredentialsProcedure,
  resequenceProcedureSteps,
  type ProcedureSimulationReport,
} from '@/services/procedures/studio';
import { validateProcedureStudioDocument } from '@/services/procedures/validator';

type StudioView = 'build' | 'quality' | 'history';
type BusyAction = 'load' | 'save' | 'publish' | 'simulate' | 'generate' | 'archive' | 'restore' | null;

const STEP_META: Record<ProcedureStudioStep['type'], {
  label: string;
  description: string;
  color: string;
  surface: string;
  icon: typeof Blocks;
}> = {
  gather_data: { label: 'Perguntar', description: 'Coleta um dado obrigatório', color: 'text-sky-300', surface: 'border-sky-500/30 bg-sky-500/10', icon: Send },
  retrieve_knowledge: { label: 'Consultar', description: 'Busca na base do agente', color: 'text-violet-300', surface: 'border-violet-500/30 bg-violet-500/10', icon: Bot },
  validate: { label: 'Validar', description: 'Confere uma regra', color: 'text-amber-300', surface: 'border-amber-500/30 bg-amber-500/10', icon: ShieldCheck },
  tool_call: { label: 'Executar', description: 'Chama ferramenta ou API', color: 'text-orange-300', surface: 'border-orange-500/30 bg-orange-500/10', icon: Webhook },
  decide: { label: 'Decidir', description: 'Abre caminhos condicionais', color: 'text-fuchsia-300', surface: 'border-fuchsia-500/30 bg-fuchsia-500/10', icon: GitBranch },
  respond: { label: 'Responder', description: 'Fala com o cliente', color: 'text-emerald-300', surface: 'border-emerald-500/30 bg-emerald-500/10', icon: CheckCircle2 },
  handoff: { label: 'Encaminhar', description: 'Entrega para uma equipe', color: 'text-rose-300', surface: 'border-rose-500/30 bg-rose-500/10', icon: ArrowUp },
};

const INTENT_LABELS: Record<(typeof PROCEDURE_INTENTS)[number], string> = {
  greeting: 'Saudação',
  human_handoff: 'Pedir atendente',
  purchase_inquiry: 'Interesse de compra',
  catalog_request: 'Pedir catálogo',
  pricing_request: 'Preço',
  promotion_request: 'Promoção',
  availability_request: 'Disponibilidade',
  billing_or_payment: 'Cobrança ou pagamento',
  scheduling_request: 'Agendamento',
  order_or_request_status: 'Status de pedido',
  support_request: 'Suporte',
  troubleshooting: 'Diagnóstico',
  change_request: 'Alteração',
  return_or_refund: 'Devolução ou reembolso',
  cancellation_request: 'Cancelamento',
  document_request: 'Documento',
  complaint: 'Reclamação',
  thanks: 'Agradecimento',
  unknown: 'Outro',
};

function lines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function commaList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function stepTargetOptions(procedure: ProcedureStudioDocument, currentId: string) {
  return [...procedure.steps]
    .sort((a, b) => a.order - b.order)
    .filter((step) => step.id !== currentId);
}

function stepSummary(step: ProcedureStudioStep, tools: ProcedureToolOption[]) {
  if (step.type === 'gather_data') return (step.requiredSlots || []).join(', ') || 'Resposta livre';
  if (step.type === 'retrieve_knowledge') return step.knowledgeQueryTemplate || 'Consulta não definida';
  if (step.type === 'validate') return step.condition || 'Regra não definida';
  if (step.type === 'tool_call') return tools.find((tool) => tool.name === step.toolName)?.displayName || step.toolName || 'Escolha uma ferramenta';
  if (step.type === 'decide') return `${step.branches?.length || 0} caminhos`;
  if (step.type === 'respond') return step.responseTemplate || 'Resposta não definida';
  return step.handoffReason || 'Destino não definido';
}

function PathSelect({
  value,
  procedure,
  currentId,
  onChange,
  allowEnd = true,
}: {
  value?: string | null;
  procedure: ProcedureStudioDocument;
  currentId: string;
  onChange: (value: string | null) => void;
  allowEnd?: boolean;
}) {
  return (
    <select
      value={value || ''}
      onChange={(event) => onChange(event.target.value || null)}
      className="h-10 w-full rounded-xl border border-white/10 bg-[#0e1116] px-3 text-sm text-slate-200 outline-none focus:border-cyan-500/60"
    >
      <option value="">{allowEnd ? 'Encerrar aqui' : 'Escolha uma peça'}</option>
      {stepTargetOptions(procedure, currentId).map((candidate) => (
        <option key={candidate.id} value={candidate.id}>
          {candidate.order}. {candidate.label}
        </option>
      ))}
    </select>
  );
}

function JsonPayloadEditor({ value, onChange }: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}) {
  const serialized = useMemo(() => JSON.stringify(value || {}, null, 2), [value]);
  const [draft, setDraft] = useState(serialized);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(serialized), [serialized]);

  const commit = () => {
    try {
      const parsed = JSON.parse(draft) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some((item) => typeof item !== 'string')) {
        throw new Error('Use um objeto JSON com valores em texto.');
      }
      setError(null);
      onChange(parsed as Record<string, string>);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'JSON inválido.');
    }
  };

  return (
    <div className="space-y-1.5">
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        rows={6}
        spellCheck={false}
        className="border-white/10 bg-[#0e1116] font-mono text-xs text-slate-200"
      />
      <p className={cn('text-[11px]', error ? 'text-rose-300' : 'text-slate-500')}>
        {error || 'Variáveis disponíveis usam o formato {{nome_do_campo}}.'}
      </p>
    </div>
  );
}

function StepInspector({
  procedure,
  step,
  tools,
  onChange,
}: {
  procedure: ProcedureStudioDocument;
  step: ProcedureStudioStep;
  tools: ProcedureToolOption[];
  onChange: (step: ProcedureStudioStep) => void;
}) {
  const patch = (change: Partial<ProcedureStudioStep>) => onChange({ ...step, ...change } as ProcedureStudioStep);
  const enabledTools = tools.filter((tool) => tool.enabled);
  const selectedTool = tools.find((tool) => tool.name === step.toolName);

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-xs text-slate-400">Nome da peça</Label>
        <Input value={step.label} onChange={(event) => patch({ label: event.target.value })} className="mt-1.5 border-white/10 bg-[#0e1116]" />
      </div>

      {step.type === 'gather_data' && (
        <>
          <div>
            <Label className="text-xs text-slate-400">Pergunta para o cliente</Label>
            <Textarea value={step.promptTemplate || ''} onChange={(event) => patch({ promptTemplate: event.target.value })} rows={3} className="mt-1.5 border-white/10 bg-[#0e1116]" />
          </div>
          <div>
            <Label className="text-xs text-slate-400">Campos a coletar</Label>
            <Input
              value={(step.requiredSlots || []).join(', ')}
              onChange={(event) => {
                const slots = commaList(event.target.value).map((key) => key.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                patch({
                  requiredSlots: slots,
                  slotDefinitions: slots.map((key) => step.slotDefinitions?.find((slot) => slot.key === key) || ({ key, label: key.replace(/_/g, ' '), type: 'text', required: true, aliases: [] })),
                });
              }}
              placeholder="cpf, novo_nome_wifi"
              className="mt-1.5 border-white/10 bg-[#0e1116]"
            />
            <p className="mt-1 text-[11px] text-slate-500">Separe por vírgula e use nomes simples, sem espaço.</p>
          </div>
        </>
      )}

      {step.type === 'retrieve_knowledge' && (
        <>
          <div>
            <Label className="text-xs text-slate-400">O que procurar</Label>
            <Textarea value={step.knowledgeQueryTemplate || ''} onChange={(event) => patch({ knowledgeQueryTemplate: event.target.value })} rows={3} className="mt-1.5 border-white/10 bg-[#0e1116]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-400">Cobertura mínima</Label>
              <select value={step.requiredKnowledgeCoverage || 'medium'} onChange={(event) => patch({ requiredKnowledgeCoverage: event.target.value as ProcedureStudioStep['requiredKnowledgeCoverage'] })} className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-[#0e1116] px-3 text-sm">
                <option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option><option value="none">Nenhuma</option>
              </select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Se não souber</Label>
              <select value={step.onLowKnowledge || 'handoff'} onChange={(event) => patch({ onLowKnowledge: event.target.value as ProcedureStudioStep['onLowKnowledge'] })} className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-[#0e1116] px-3 text-sm">
                <option value="handoff">Encaminhar</option><option value="pause">Pausar</option><option value="continue">Continuar</option>
              </select>
            </div>
          </div>
        </>
      )}

      {step.type === 'validate' && (
        <>
          <div>
            <Label className="text-xs text-slate-400">Regra verificável</Label>
            <Textarea value={step.condition || ''} onChange={(event) => patch({ condition: event.target.value })} rows={3} className="mt-1.5 border-white/10 bg-[#0e1116]" />
          </div>
          <div>
            <Label className="text-xs text-slate-400">Se a regra falhar</Label>
            <select value={step.onFail || 'handoff'} onChange={(event) => patch({ onFail: event.target.value as ProcedureStudioStep['onFail'] })} className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-[#0e1116] px-3 text-sm">
              <option value="handoff">Encaminhar</option><option value="retry">Tentar novamente</option><option value="skip">Pular</option><option value="abort">Abortar</option>
            </select>
          </div>
        </>
      )}

      {step.type === 'tool_call' && (
        <>
          <div>
            <Label className="text-xs text-slate-400">Ferramenta/API exata</Label>
            <select value={step.toolName || ''} onChange={(event) => {
              const tool = tools.find((item) => item.name === event.target.value);
              patch({
                toolName: event.target.value,
                sideEffect: tool?.sideEffect || 'none',
                requiresConfirmation: Boolean(tool && (tool.requiresHumanApproval || tool.riskLevel === 'high' || tool.sideEffect === 'high')),
              });
            }} className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-[#0e1116] px-3 text-sm">
              <option value="">Selecione uma ferramenta habilitada</option>
              {enabledTools.map((tool) => <option key={tool.name} value={tool.name}>{tool.displayName || tool.name}</option>)}
            </select>
            {selectedTool && <p className="mt-1.5 text-[11px] leading-5 text-slate-500">{selectedTool.description}</p>}
            {enabledTools.length === 0 && <p className="mt-1.5 text-xs text-amber-300">Ative uma habilidade no agente antes de publicar.</p>}
          </div>
          <div>
            <Label className="text-xs text-slate-400">Dados enviados para a ferramenta</Label>
            <div className="mt-1.5"><JsonPayloadEditor value={step.toolPayloadTemplate || {}} onChange={(value) => patch({ toolPayloadTemplate: value })} /></div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-sm font-medium text-slate-200">Pedir confirmação</p><p className="text-[11px] text-slate-500">Obrigatório para ações sensíveis.</p></div>
              <Switch checked={Boolean(step.requiresConfirmation)} onCheckedChange={(checked) => patch({ requiresConfirmation: checked })} />
            </div>
            {step.requiresConfirmation && <Textarea value={step.confirmationPrompt || ''} onChange={(event) => patch({ confirmationPrompt: event.target.value })} rows={2} placeholder="Explique o efeito e peça uma confirmação clara." className="mt-3 border-white/10 bg-[#0e1116]" />}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label className="text-xs text-emerald-300">Se funcionar</Label><div className="mt-1.5"><PathSelect value={step.successStepId} procedure={procedure} currentId={step.id} onChange={(value) => patch({ successStepId: value, nextStepId: value })} allowEnd={false} /></div></div>
            <div><Label className="text-xs text-rose-300">Se falhar</Label><div className="mt-1.5"><PathSelect value={step.errorStepId} procedure={procedure} currentId={step.id} onChange={(value) => patch({ errorStepId: value })} allowEnd={false} /></div></div>
          </div>
        </>
      )}

      {step.type === 'decide' && (
        <>
          <div>
            <Label className="text-xs text-slate-400">Pergunta da decisão</Label>
            <Textarea value={step.decisionPrompt || ''} onChange={(event) => patch({ decisionPrompt: event.target.value })} rows={2} className="mt-1.5 border-white/10 bg-[#0e1116]" />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between"><Label className="text-xs text-slate-400">Caminhos</Label><Button type="button" size="sm" variant="ghost" onClick={() => patch({ branches: [...(step.branches || []), { condition: (step.branches || []).length ? 'Caso contrário' : 'Quando esta condição for verdadeira', nextStepId: '' }] })}><Plus className="mr-1 h-3.5 w-3.5" />Caminho</Button></div>
            {(step.branches || []).map((branch, index) => (
              <div key={`${step.id}:branch:${index}`} className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] p-3">
                <div className="flex gap-2">
                  <Input value={branch.condition} onChange={(event) => patch({ branches: (step.branches || []).map((item, itemIndex) => itemIndex === index ? { ...item, condition: event.target.value } : item) })} placeholder="Ex.: Cliente quer trocar a senha" className="border-white/10 bg-[#0e1116]" />
                  <Button type="button" size="icon" variant="ghost" onClick={() => patch({ branches: (step.branches || []).filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4 text-rose-300" /></Button>
                </div>
                <div className="mt-2"><PathSelect value={branch.nextStepId} procedure={procedure} currentId={step.id} onChange={(value) => patch({ branches: (step.branches || []).map((item, itemIndex) => itemIndex === index ? { ...item, nextStepId: value || '' } : item) })} allowEnd={false} /></div>
              </div>
            ))}
          </div>
        </>
      )}

      {step.type === 'respond' && (
        <>
          <div><Label className="text-xs text-slate-400">Resposta ou instrução</Label><Textarea value={step.responseTemplate || ''} onChange={(event) => patch({ responseTemplate: event.target.value })} rows={5} className="mt-1.5 border-white/10 bg-[#0e1116]" /></div>
          <div className="flex items-center justify-between rounded-xl border border-white/10 p-3"><div><p className="text-sm text-slate-200">Deixar a IA adaptar o texto</p><p className="text-[11px] text-slate-500">Mantém os fatos e ajusta o tom ao contexto.</p></div><Switch checked={Boolean(step.useLlm)} onCheckedChange={(checked) => patch({ useLlm: checked })} /></div>
        </>
      )}

      {step.type === 'handoff' && (
        <div><Label className="text-xs text-slate-400">Motivo e destino do encaminhamento</Label><Textarea value={step.handoffReason || ''} onChange={(event) => patch({ handoffReason: event.target.value })} rows={5} className="mt-1.5 border-white/10 bg-[#0e1116]" /></div>
      )}

      {!['tool_call', 'decide', 'handoff'].includes(step.type) && (
        <div><Label className="text-xs text-slate-400">Próxima peça</Label><div className="mt-1.5"><PathSelect value={step.nextStepId} procedure={procedure} currentId={step.id} onChange={(value) => patch({ nextStepId: value })} /></div></div>
      )}
    </div>
  );
}

export function ProcedureStudio({ configId, tools }: { configId: string; tools: ProcedureToolOption[] }) {
  const [records, setRecords] = useState<ProcedureStudioRecord[]>([]);
  const [procedure, setProcedure] = useState<ProcedureStudioDocument>(() => createBlankProcedure(configId));
  const [savedSnapshot, setSavedSnapshot] = useState<string>('');
  const [revision, setRevision] = useState<number | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(procedure.steps[0]?.id || null);
  const [view, setView] = useState<StudioView>('build');
  const [busy, setBusy] = useState<BusyAction>('load');
  const [aiDescription, setAiDescription] = useState('');
  const [simulation, setSimulation] = useState<ProcedureSimulationReport | null>(null);
  const [expandedSimulationId, setExpandedSimulationId] = useState<string | null>(null);

  const selectedRecord = useMemo(() => records.find((record) => record.id === procedure.id) || null, [records, procedure.id]);
  const selectedStep = useMemo(() => procedure.steps.find((step) => step.id === selectedStepId) || null, [procedure.steps, selectedStepId]);
  const validation = useMemo(() => validateProcedureStudioDocument({ procedure, tools }), [procedure, tools]);
  const isDirty = savedSnapshot !== JSON.stringify(procedure);
  const isBusy = busy !== null && busy !== 'load';
  const hasUnpublishedDraft = isDirty
    || !selectedRecord
    || revision == null
    || selectedRecord.status !== 'active'
    || selectedRecord.draftRevision !== selectedRecord.publishedRevision;

  const selectDocument = useCallback((next: ProcedureStudioDocument, nextRevision: number | null = null) => {
    setProcedure(next);
    setRevision(nextRevision);
    setSavedSnapshot(nextRevision == null ? '' : JSON.stringify(next));
    setSelectedStepId([...next.steps].sort((a, b) => a.order - b.order)[0]?.id || null);
    setSimulation(null);
    setView('build');
  }, []);

  const load = useCallback(async (preferredId?: string) => {
    setBusy('load');
    const result = await listProcedureStudioAction(configId);
    setBusy(null);
    if (!result.success || !result.data) {
      toast({ title: 'Não foi possível carregar os procedimentos', description: result.error, variant: 'destructive' });
      return;
    }
    setRecords(result.data.procedures);
    const next = result.data.procedures.find((record) => record.id === preferredId) || result.data.procedures[0];
    if (next) selectDocument(next.draft, next.draftRevision);
  }, [configId, selectDocument]);

  useEffect(() => { void load(); }, [load]);

  const patchProcedure = (change: Partial<ProcedureStudioDocument>) => setProcedure((current) => ({ ...current, ...change }));
  const updateStep = (nextStep: ProcedureStudioStep) => setProcedure((current) => ({
    ...current,
    steps: current.steps.map((step) => step.id === nextStep.id ? nextStep : step),
  }));

  const addStep = (type: ProcedureStudioStep['type']) => {
    const next = createProcedureStep(type, procedure.steps.length);
    setProcedure((current) => {
      const ordered = [...current.steps].sort((a, b) => a.order - b.order);
      const last = ordered.at(-1);
      const steps = ordered.map((step) => step.id === last?.id && !step.nextStepId && !['respond', 'handoff', 'decide'].includes(step.type)
        ? { ...step, nextStepId: next.id }
        : step);
      return { ...current, steps: resequenceProcedureSteps([...steps, next]) };
    });
    setSelectedStepId(next.id);
  };

  const moveStep = (stepId: string, direction: -1 | 1) => setProcedure((current) => {
    const ordered = [...current.steps].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((step) => step.id === stepId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return current;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    return { ...current, steps: resequenceProcedureSteps(ordered) };
  });

  const duplicateStep = (step: ProcedureStudioStep) => {
    const id = `step_${Date.now().toString(36)}_${procedure.steps.length + 1}`;
    const copy = { ...step, id, label: `${step.label} (cópia)`, order: procedure.steps.length + 1 };
    setProcedure((current) => ({ ...current, steps: resequenceProcedureSteps([...current.steps, copy]) }));
    setSelectedStepId(id);
  };

  const removeStep = (step: ProcedureStudioStep) => {
    if (procedure.steps.length === 1) {
      toast({ title: 'O procedimento precisa ter ao menos uma peça.' });
      return;
    }
    const fallback = step.nextStepId || null;
    setProcedure((current) => ({
      ...current,
      steps: resequenceProcedureSteps(current.steps.filter((item) => item.id !== step.id).map((item) => ({
        ...item,
        nextStepId: item.nextStepId === step.id ? fallback : item.nextStepId,
        successStepId: item.successStepId === step.id ? fallback : item.successStepId,
        errorStepId: item.errorStepId === step.id ? fallback : item.errorStepId,
        branches: item.branches?.map((branch) => branch.nextStepId === step.id ? { ...branch, nextStepId: fallback || '' } : branch),
      }))),
    }));
    setSelectedStepId(procedure.steps.find((item) => item.id !== step.id)?.id || null);
  };

  const save = async (silent = false) => {
    setBusy('save');
    const result = await saveProcedureDraftAction({ configId, expectedRevision: revision, procedure });
    setBusy(null);
    if (!result.success || !result.data) {
      toast({ title: 'Rascunho não salvo', description: result.error, variant: 'destructive' });
      return null;
    }
    const record = result.data.procedure;
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    setProcedure(record.draft);
    setRevision(record.draftRevision);
    setSavedSnapshot(JSON.stringify(record.draft));
    setSimulation(record.simulation);
    if (!silent) toast({ title: 'Rascunho salvo', description: `Revisão ${record.draftRevision} protegida.` });
    return record;
  };

  const publish = async () => {
    const current = isDirty || revision == null ? await save(true) : selectedRecord;
    const expectedRevision = current?.draftRevision || revision;
    if (!expectedRevision) return;
    setBusy('publish');
    const result = await publishProcedureAction({ configId, procedureId: procedure.id, expectedRevision });
    setBusy(null);
    if (!result.success || !result.data) {
      toast({ title: 'Publicação bloqueada', description: result.error, variant: 'destructive' });
      setView('quality');
      return;
    }
    const record = result.data.procedure;
    setRecords((currentRecords) => [record, ...currentRecords.filter((item) => item.id !== record.id)]);
    setProcedure(record.draft);
    setRevision(record.draftRevision);
    setSavedSnapshot(JSON.stringify(record.draft));
    setSimulation(record.simulation);
    toast({ title: `Procedimento publicado em v${record.publishedVersion}`, description: 'O agente já pode usar esta versão no atendimento.' });
  };

  const simulate = async () => {
    setBusy('simulate');
    const result = await simulateProcedureAction({ configId, procedure });
    setBusy(null);
    if (!result.success || !result.data) {
      toast({ title: 'Simulação falhou', description: result.error, variant: 'destructive' });
      return;
    }
    setSimulation(result.data.report);
    setExpandedSimulationId(result.data.report.cases[0]?.id || null);
    setView('quality');
    toast({ title: result.data.report.passed ? 'Todos os caminhos passaram' : 'Há caminhos para corrigir' });
  };

  const generate = async () => {
    if (aiDescription.trim().length < 4) {
      toast({ title: 'Descreva o que o agente deve resolver.' });
      return;
    }
    setBusy('generate');
    const result = await generateProcedureWithAiAction({
      configId,
      description: aiDescription,
      currentProcedure: revision == null ? null : procedure,
    });
    setBusy(null);
    if (!result.success || !result.data) {
      toast({ title: 'A IA não conseguiu montar um LEGO seguro', description: result.error, variant: 'destructive' });
      return;
    }
    const proposal = result.data.proposal;
    setProcedure(proposal.procedure);
    setSelectedStepId(proposal.procedure.steps[0]?.id || null);
    setSimulation(proposal.simulation);
    setAiDescription('');
    toast({ title: 'Procedimento montado pela IA', description: proposal.summary });
  };

  const archive = async () => {
    if (!selectedRecord) return;
    setBusy('archive');
    const result = await archiveProcedureAction({ configId, procedureId: selectedRecord.id, expectedRevision: selectedRecord.draftRevision });
    setBusy(null);
    if (!result.success) {
      toast({ title: 'Não foi possível arquivar', description: result.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Procedimento arquivado', description: 'O histórico foi preservado e o agente não o executará.' });
    await load();
  };

  const restore = async (version: number) => {
    if (!selectedRecord) return;
    setBusy('restore');
    const result = await restoreProcedureVersionAction({ configId, procedureId: selectedRecord.id, version });
    setBusy(null);
    if (!result.success || !result.data) {
      toast({ title: 'Versão não restaurada', description: result.error, variant: 'destructive' });
      return;
    }
    const record = result.data.procedure;
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    selectDocument(record.draft, record.draftRevision);
    toast({ title: `Versão ${version} restaurada como rascunho`, description: 'Revise e publique para colocá-la em uso.' });
  };

  const orderedSteps = [...procedure.steps].sort((a, b) => a.order - b.order);

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#101317] shadow-2xl">
      <div className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_12%_0%,rgba(34,211,238,0.12),transparent_35%),#11151a] p-4 sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300"><WandSparkles className="h-4 w-4" />Arquiteto de procedimentos</div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Textarea
                value={aiDescription}
                onChange={(event) => setAiDescription(event.target.value)}
                placeholder="Ex.: Quando o cliente quiser trocar o nome ou a senha do Wi-Fi, identifique o contrato, colete os novos dados, confirme e chame a API. Se falhar, encaminhe ao suporte."
                rows={2}
                className="min-h-[70px] flex-1 resize-none border-white/10 bg-black/20 text-slate-100 placeholder:text-slate-600"
              />
              <Button type="button" onClick={() => void generate()} disabled={isBusy} className="h-[70px] rounded-xl bg-cyan-400 px-5 font-semibold text-slate-950 hover:bg-cyan-300">
                {busy === 'generate' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Montar com IA
              </Button>
            </div>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 xl:flex xl:w-auto xl:shrink-0 xl:self-end">
            <Button type="button" variant="outline" onClick={() => void simulate()} disabled={isBusy} className="min-w-0 rounded-xl border-white/10 bg-white/[0.03] px-2 sm:px-4"><Play className="mr-1.5 h-4 w-4 sm:mr-2" />Simular</Button>
            <Button type="button" variant="outline" onClick={() => void save()} disabled={isBusy || !isDirty} className="min-w-0 rounded-xl border-white/10 bg-white/[0.03] px-2 sm:px-4">{busy === 'save' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin sm:mr-2" /> : <Save className="mr-1.5 h-4 w-4 sm:mr-2" />}Salvar</Button>
            <Button type="button" onClick={() => void publish()} disabled={isBusy || !validation.valid || !hasUnpublishedDraft} className="min-w-0 rounded-xl bg-emerald-500 px-2 text-emerald-950 hover:bg-emerald-400 sm:px-4">{busy === 'publish' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin sm:mr-2" /> : <Check className="mr-1.5 h-4 w-4 sm:mr-2" />}Publicar</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:min-h-[720px] xl:grid-cols-[245px_minmax(0,1fr)]">
        <aside className="border-b border-white/[0.08] bg-[#0c0f13] p-3 xl:border-b-0 xl:border-r">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => selectDocument(createBlankProcedure(configId))} className="border-white/10 bg-white/[0.03] text-xs"><Plus className="mr-1.5 h-3.5 w-3.5" />Em branco</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => selectDocument(createWifiCredentialsProcedure(configId, tools))} className="border-white/10 bg-white/[0.03] text-xs"><Blocks className="mr-1.5 h-3.5 w-3.5" />Wi-Fi</Button>
          </div>
          <div className="mt-4 flex items-center justify-between px-1"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Seus procedimentos</p>{busy === 'load' && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}</div>
          <ScrollArea className="mt-2 h-[140px] xl:h-[620px]">
            <div className="space-y-2 pr-2">
              {records.map((record) => (
                <button key={record.id} type="button" onClick={() => selectDocument(record.draft, record.draftRevision)} className={cn('w-full rounded-xl border p-3 text-left transition', record.id === procedure.id ? 'border-cyan-500/35 bg-cyan-500/10' : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05]')}>
                  <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-slate-200">{record.name}</span><CircleDot className={cn('h-3.5 w-3.5 shrink-0', record.status === 'active' ? 'text-emerald-400' : record.status === 'archived' ? 'text-slate-600' : 'text-amber-400')} /></div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{record.description || record.draft.goal}</p>
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500"><span>{record.draft.steps.length} peças</span><span>•</span><span>{record.publishedVersion ? `v${record.publishedVersion}` : 'rascunho'}</span></div>
                </button>
              ))}
              {records.length === 0 && busy !== 'load' && <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs leading-5 text-slate-500">Seu primeiro procedimento já está aberto. Monte, simule e salve.</div>}
            </div>
          </ScrollArea>
        </aside>

        <section className="min-w-0">
          <div className="flex flex-col gap-3 border-b border-white/[0.08] p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Input value={procedure.name} onChange={(event) => patchProcedure({ name: event.target.value })} className="h-9 max-w-xl border-transparent bg-transparent px-0 text-lg font-semibold text-white focus-visible:ring-0" />
                <Badge className={cn('border-0', selectedRecord?.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300')}>{selectedRecord?.status === 'active' ? `Publicado v${selectedRecord.publishedVersion}` : 'Rascunho'}</Badge>
                {selectedRecord && selectedRecord.draftRevision !== selectedRecord.publishedRevision && <Badge className="border-0 bg-violet-500/15 text-violet-300">Rascunho r{selectedRecord.draftRevision}</Badge>}
                {isDirty && <Badge variant="outline" className="border-cyan-500/25 text-cyan-300">Alterado</Badge>}
              </div>
              <Input value={procedure.description} onChange={(event) => patchProcedure({ description: event.target.value })} placeholder="Uma frase explicando quando este procedimento resolve o atendimento." className="h-8 max-w-3xl border-transparent bg-transparent px-0 text-xs text-slate-400 focus-visible:ring-0" />
            </div>
            <div className="flex rounded-xl border border-white/10 bg-black/20 p-1">
              {([{ id: 'build', label: 'Construir', icon: Blocks }, { id: 'quality', label: 'Qualidade', icon: ShieldCheck }, { id: 'history', label: 'Versões', icon: History }] as const).map((item) => <button key={item.id} type="button" onClick={() => setView(item.id)} className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition', view === item.id ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300')}><item.icon className="h-3.5 w-3.5" />{item.label}</button>)}
            </div>
          </div>

          {view === 'build' && (
            <div className="grid min-h-[635px] lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0 border-b border-white/[0.08] p-4 lg:border-b-0 lg:border-r">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                  <div><Label className="text-[11px] text-slate-500">Objetivo</Label><Textarea value={procedure.goal} onChange={(event) => patchProcedure({ goal: event.target.value })} rows={2} className="mt-1 border-white/10 bg-black/20" /></div>
                  <div><Label className="text-[11px] text-slate-500">Prioridade</Label><Input type="number" min={0} max={1000} value={procedure.priority} onChange={(event) => patchProcedure({ priority: Number(event.target.value || 0) })} className="mt-1 border-white/10 bg-black/20" /><p className="mt-1 text-[10px] text-slate-600">Maior vence empate</p></div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div><Label className="text-[11px] text-slate-500">Frases que ligam este procedimento</Label><Textarea value={procedure.trigger.phrases.join('\n')} onChange={(event) => patchProcedure({ trigger: { ...procedure.trigger, phrases: lines(event.target.value) } })} rows={3} className="mt-1 border-white/10 bg-black/20" /></div>
                  <div><Label className="text-[11px] text-slate-500">Frases que NÃO devem ligar</Label><Textarea value={procedure.trigger.exclusions.join('\n')} onChange={(event) => patchProcedure({ trigger: { ...procedure.trigger, exclusions: lines(event.target.value) } })} rows={3} className="mt-1 border-white/10 bg-black/20" /></div>
                  <div><Label className="text-[11px] text-slate-500">Intenção principal</Label><select value={procedure.trigger.intents[0] || 'support_request'} onChange={(event) => patchProcedure({ trigger: { ...procedure.trigger, intents: [event.target.value as (typeof PROCEDURE_INTENTS)[number]] } })} className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm">{PROCEDURE_INTENTS.map((intent) => <option key={intent} value={intent}>{INTENT_LABELS[intent]}</option>)}</select></div>
                  <div><Label className="text-[11px] text-slate-500">Palavras-chave, separadas por vírgula</Label><Input value={procedure.trigger.keywords.join(', ')} onChange={(event) => patchProcedure({ trigger: { ...procedure.trigger, keywords: commaList(event.target.value) } })} className="mt-1 border-white/10 bg-black/20" /></div>
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-white">Peças do procedimento</p><p className="text-[11px] text-slate-500">Clique numa peça para configurar. As setas mudam a ordem visual; as rotas continuam explícitas.</p></div><Badge variant="outline" className={cn('border-white/10', validation.valid ? 'text-emerald-300' : 'text-rose-300')}>{validation.score}/100</Badge></div>
                  <div className="mt-3 flex flex-wrap gap-1.5 rounded-xl border border-white/[0.07] bg-black/20 p-2">
                    {PROCEDURE_STEP_TYPES.map((type) => { const meta = STEP_META[type]; const Icon = meta.icon; return <button key={type} type="button" onClick={() => addStep(type)} className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] transition hover:brightness-125', meta.surface, meta.color)}><Icon className="h-3.5 w-3.5" /><Plus className="h-3 w-3" />{meta.label}</button>; })}
                  </div>
                  <div className="mt-3 space-y-0">
                    {orderedSteps.map((step, index) => {
                      const meta = STEP_META[step.type]; const Icon = meta.icon;
                      const stepErrors = [...validation.errors, ...validation.warnings].filter((issue) => issue.stepId === step.id);
                      return <div key={step.id}>
                        {index > 0 && <div className="mx-auto h-5 w-px bg-gradient-to-b from-slate-700 to-slate-600" />}
                        <button type="button" onClick={() => setSelectedStepId(step.id)} className={cn('group flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition', selectedStepId === step.id ? `${meta.surface} ring-1 ring-white/10` : 'border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.05]')}>
                          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', meta.surface, meta.color)}><Icon className="h-4 w-4" /></div>
                          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{String(step.order).padStart(2, '0')}</span><span className="truncate text-sm font-medium text-slate-200">{step.label}</span>{stepErrors.length > 0 && <AlertTriangle className={cn('h-3.5 w-3.5', stepErrors.some((issue) => issue.severity === 'error') ? 'text-rose-400' : 'text-amber-400')} />}</div><p className="mt-0.5 truncate text-[11px] text-slate-500">{stepSummary(step, tools)}</p></div>
                          <div className="hidden items-center gap-0.5 group-hover:flex"><span onClick={(event) => { event.stopPropagation(); moveStep(step.id, -1); }} className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-white"><ArrowUp className="h-3.5 w-3.5" /></span><span onClick={(event) => { event.stopPropagation(); moveStep(step.id, 1); }} className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-white"><ArrowDown className="h-3.5 w-3.5" /></span><span onClick={(event) => { event.stopPropagation(); duplicateStep(step); }} className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-white"><Copy className="h-3.5 w-3.5" /></span><span onClick={(event) => { event.stopPropagation(); removeStep(step); }} className="rounded p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></span></div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
                        </button>
                      </div>;
                    })}
                  </div>
                </div>
              </div>

              <aside className="bg-[#0d1014] p-4">
                {selectedStep ? <><div className="mb-4 flex items-center gap-2"><div className={cn('rounded-lg border p-2', STEP_META[selectedStep.type].surface, STEP_META[selectedStep.type].color)}>{(() => { const Icon = STEP_META[selectedStep.type].icon; return <Icon className="h-4 w-4" />; })()}</div><div><p className="text-sm font-semibold text-white">Configurar peça {selectedStep.order}</p><p className="text-[11px] text-slate-500">{STEP_META[selectedStep.type].description}</p></div></div><StepInspector procedure={procedure} step={selectedStep} tools={tools} onChange={updateStep} />{validation.errors.filter((issue) => issue.stepId === selectedStep.id).map((issue) => <div key={`${issue.code}:${issue.field}`} className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs leading-5 text-rose-200"><AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />{issue.message}</div>)}</> : <div className="flex h-full min-h-64 items-center justify-center text-center text-xs text-slate-600">Selecione uma peça para configurá-la.</div>}
              </aside>
            </div>
          )}

          {view === 'quality' && (
            <div className="grid gap-4 p-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className={cn('rounded-2xl border p-4', validation.valid ? 'border-emerald-500/25 bg-emerald-500/10' : 'border-rose-500/25 bg-rose-500/10')}>
                  <div className="flex items-center justify-between"><div className="flex items-center gap-2">{validation.valid ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <XCircle className="h-5 w-5 text-rose-300" />}<div><p className="text-sm font-semibold text-white">{validation.valid ? 'Estrutura pronta' : 'Publicação bloqueada'}</p><p className="text-xs text-slate-400">Qualidade {validation.score}/100</p></div></div><Badge className="border-0 bg-black/20">{validation.errors.length} erros</Badge></div>
                </div>
                <div className="space-y-2">
                  {[...validation.errors, ...validation.warnings].map((issue, index) => <button key={`${issue.code}:${index}`} type="button" onClick={() => { if (issue.stepId) { setSelectedStepId(issue.stepId); setView('build'); } }} className={cn('w-full rounded-xl border p-3 text-left text-xs leading-5', issue.severity === 'error' ? 'border-rose-500/20 bg-rose-500/[0.07] text-rose-200' : 'border-amber-500/20 bg-amber-500/[0.07] text-amber-200')}><span className="font-semibold">{issue.severity === 'error' ? 'Corrigir: ' : 'Melhorar: '}</span>{issue.message}</button>)}
                  {validation.errors.length === 0 && validation.warnings.length === 0 && <div className="rounded-xl border border-dashed border-emerald-500/25 p-5 text-center text-xs text-emerald-300">Nenhuma pendência estrutural.</div>}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-white">Simulação sem efeitos reais</h3><p className="text-xs text-slate-500">Testa o caminho principal e uma falha para cada API.</p></div><Button type="button" size="sm" onClick={() => void simulate()} disabled={isBusy}>{busy === 'simulate' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Rodar novamente</Button></div>
                <div className="mt-4 space-y-2">
                  {(simulation?.cases || []).map((testCase) => <div key={testCase.id} className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025]"><button type="button" onClick={() => setExpandedSimulationId((current) => current === testCase.id ? null : testCase.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left"><div className="flex items-center gap-2">{testCase.passed ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-400" />}<span className="text-sm text-slate-200">{testCase.name}</span></div><Badge variant="outline" className={testCase.passed ? 'border-emerald-500/20 text-emerald-300' : 'border-rose-500/20 text-rose-300'}>{testCase.terminal === 'responded' ? 'respondeu' : testCase.terminal === 'handoff' ? 'encaminhou' : 'falhou'}</Badge></button>{expandedSimulationId === testCase.id && <div className="border-t border-white/[0.07] p-3"><div className="space-y-2">{testCase.events.map((event) => <div key={`${testCase.id}:${event.sequence}`} className="flex gap-3 text-xs"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[10px] text-slate-500">{event.sequence}</span><div><p className="text-slate-300">{event.stepLabel}</p><p className="text-slate-600">{event.summary}</p></div></div>)}</div>{testCase.error && <p className="mt-3 text-xs text-rose-300">{testCase.error}</p>}</div>}</div>)}
                  {!simulation && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center"><Play className="mx-auto h-6 w-6 text-slate-600" /><p className="mt-2 text-sm text-slate-400">Rode a primeira simulação</p><p className="mt-1 text-xs text-slate-600">Nenhuma API real será chamada.</p></div>}
                </div>
              </div>
            </div>
          )}

          {view === 'history' && (
            <div className="grid gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><p className="text-[11px] uppercase tracking-wider text-slate-500">Execuções</p><p className="mt-1 text-3xl font-semibold text-white">{selectedRecord?.metrics.totalRuns || 0}</p><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-300">{selectedRecord?.metrics.completionRate || 0}% concluídas</div><div className="rounded-lg bg-rose-500/10 p-2 text-rose-300">{selectedRecord?.metrics.failedRuns || 0} falhas</div></div></div>
                {selectedRecord && <Button type="button" variant="outline" onClick={() => void archive()} disabled={isBusy || selectedRecord.status === 'archived'} className="w-full border-white/10 bg-white/[0.02] text-slate-400"><Archive className="mr-2 h-4 w-4" />{selectedRecord.status === 'archived' ? 'Já arquivado' : 'Arquivar procedimento'}</Button>}
              </div>
              <div><div className="flex items-center gap-2"><FileClock className="h-4 w-4 text-slate-400" /><h3 className="text-sm font-semibold text-white">Versões publicadas e imutáveis</h3></div><div className="mt-3 space-y-2">{(selectedRecord?.versions || []).map((version) => <div key={version.version} className="flex flex-col justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 sm:flex-row sm:items-center"><div><div className="flex items-center gap-2"><span className="text-sm font-medium text-white">Versão {version.version}</span>{version.version === selectedRecord?.publishedVersion && <Badge className="border-0 bg-emerald-500/15 text-emerald-300">Em uso</Badge>}</div><p className="mt-1 text-xs text-slate-500">{new Date(version.publishedAt).toLocaleString('pt-BR')} • qualidade {version.validation?.score ?? '—'}/100</p></div><Button type="button" size="sm" variant="outline" onClick={() => void restore(version.version)} disabled={isBusy} className="border-white/10 bg-white/[0.03]"><RotateCcw className="mr-2 h-3.5 w-3.5" />Restaurar como rascunho</Button></div>)}{(!selectedRecord || selectedRecord.versions.length === 0) && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">A primeira versão aparece aqui depois da publicação.</div>}</div></div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
