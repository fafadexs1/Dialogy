'use client';

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Beaker, History, Loader2, Play, RotateCcw } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type NativeWorkflowTestFixture = {
  output: Record<string, unknown>;
  statePatch?: Record<string, unknown>;
};

export type NativeWorkflowTestFixtureMap = Record<string, NativeWorkflowTestFixture>;

export type NativeWorkflowTestPreset = {
  id: string;
  label: string;
  description?: string;
  message: string;
  fixtures?: NativeWorkflowTestFixtureMap;
};

export type NativeWorkflowTestDependency = {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  defaultOutput?: Record<string, unknown>;
  defaultStatePatch?: Record<string, unknown>;
};

export type NativeWorkflowTestFixtureMode = 'hidden' | 'optional' | 'required';

export type NativeWorkflowTestPayload = {
  message: string;
  presetId?: string;
  fixtures: NativeWorkflowTestFixtureMap;
};

export type NativeWorkflowTestHistoryEntry = NativeWorkflowTestPayload & {
  id: string;
  submittedAt: string;
};

export type NativeWorkflowTestFixtureDraft = {
  outputJson: string;
  statePatchJson: string;
};

export type NativeWorkflowTestDraft = {
  message: string;
  presetId?: string;
  fixturesEnabled: boolean;
  fixtures: Record<string, NativeWorkflowTestFixtureDraft>;
};

export type NativeWorkflowTestValidation = {
  valid: boolean;
  errors: Record<string, string>;
  payload: NativeWorkflowTestPayload | null;
};

export type NativeWorkflowTestSubmitResult = {
  error?: string;
};

export type NativeWorkflowTestDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    payload: NativeWorkflowTestPayload,
  ) => Promise<NativeWorkflowTestSubmitResult | void> | NativeWorkflowTestSubmitResult | void;
  workflowName?: string;
  title?: string;
  description?: string;
  submitLabel?: string;
  initialMessage?: string;
  initialFixtures?: NativeWorkflowTestFixtureMap;
  presets?: NativeWorkflowTestPreset[];
  dependencies?: NativeWorkflowTestDependency[];
  fixtureMode?: NativeWorkflowTestFixtureMode;
  maxMessageLength?: number;
  loading?: boolean;
  error?: string | null;
  closeOnSuccess?: boolean;
  historyStorageKey?: string;
  maxHistoryEntries?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function prettyJson(value: Record<string, unknown> | undefined) {
  return value ? JSON.stringify(value, null, 2) : '';
}

function fixtureErrorKey(dependencyId: string, field: 'output' | 'statePatch') {
  return `fixture.${dependencyId}.${field}`;
}

function parseJsonRecord(value: string): { value?: Record<string, unknown>; error?: string } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return { error: 'Use um objeto JSON, por exemplo { "campo": "valor" }.' };
    return { value: parsed };
  } catch {
    return { error: 'JSON inválido. Verifique aspas, vírgulas e chaves.' };
  }
}

export function createNativeWorkflowFixtureDrafts(
  dependencies: NativeWorkflowTestDependency[],
  fixtures: NativeWorkflowTestFixtureMap = {},
): Record<string, NativeWorkflowTestFixtureDraft> {
  return Object.fromEntries(dependencies.map((dependency) => {
    const fixture = fixtures[dependency.id];
    return [dependency.id, {
      outputJson: prettyJson(fixture?.output ?? dependency.defaultOutput),
      statePatchJson: prettyJson(fixture?.statePatch ?? dependency.defaultStatePatch),
    }];
  }));
}

export function validateNativeWorkflowTestDraft(input: {
  draft: NativeWorkflowTestDraft;
  dependencies?: NativeWorkflowTestDependency[];
  fixtureMode?: NativeWorkflowTestFixtureMode;
  maxMessageLength?: number;
}): NativeWorkflowTestValidation {
  const dependencies = input.dependencies || [];
  const fixtureMode = input.fixtureMode || (dependencies.length > 0 ? 'optional' : 'hidden');
  const maxMessageLength = Math.max(1, input.maxMessageLength || 4_000);
  const errors: Record<string, string> = {};
  const message = input.draft.message.trim();

  if (!message) errors.message = 'Digite uma mensagem para iniciar o teste.';
  else if (message.length > maxMessageLength) errors.message = `A mensagem deve ter no máximo ${maxMessageLength} caracteres.`;

  const dependencyIds = new Set<string>();
  for (const dependency of dependencies) {
    if (dependencyIds.has(dependency.id)) errors.fixtures = `A dependência "${dependency.id}" está duplicada.`;
    dependencyIds.add(dependency.id);
  }

  const fixturesEnabled = fixtureMode === 'required' || (fixtureMode === 'optional' && input.draft.fixturesEnabled);
  const fixtures: NativeWorkflowTestFixtureMap = {};
  if (fixtureMode === 'required' && dependencies.length > 0 && !input.draft.fixturesEnabled) {
    errors.fixtures = 'Preencha as dependências obrigatórias antes de executar.';
  }

  if (fixturesEnabled) {
    for (const dependency of dependencies) {
      const fixture = input.draft.fixtures[dependency.id];
      const outputJson = fixture?.outputJson.trim() || '';
      const statePatchJson = fixture?.statePatchJson.trim() || '';
      if (!outputJson && !statePatchJson && !dependency.required) continue;
      if (!outputJson) {
        errors[fixtureErrorKey(dependency.id, 'output')] = 'A saída desta dependência é obrigatória.';
        continue;
      }
      const output = parseJsonRecord(outputJson);
      if (output.error) errors[fixtureErrorKey(dependency.id, 'output')] = output.error;
      const statePatch = statePatchJson ? parseJsonRecord(statePatchJson) : {};
      if (statePatch.error) errors[fixtureErrorKey(dependency.id, 'statePatch')] = statePatch.error;
      if (output.value && !statePatch.error) {
        fixtures[dependency.id] = {
          output: output.value,
          ...(statePatch.value ? { statePatch: statePatch.value } : {}),
        };
      }
    }
  }

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    errors,
    payload: valid ? {
      message,
      ...(input.draft.presetId ? { presetId: input.draft.presetId } : {}),
      fixtures,
    } : null,
  };
}

export function parseNativeWorkflowTestHistory(
  raw: string | null | undefined,
  limit = 5,
): NativeWorkflowTestHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is NativeWorkflowTestHistoryEntry => (
      isRecord(entry)
      && typeof entry.id === 'string'
      && typeof entry.submittedAt === 'string'
      && typeof entry.message === 'string'
      && isRecord(entry.fixtures)
    )).slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}

export function appendNativeWorkflowTestHistory(
  history: NativeWorkflowTestHistoryEntry[],
  entry: NativeWorkflowTestHistoryEntry,
  limit = 5,
) {
  return [entry, ...history.filter((item) => item.id !== entry.id)].slice(0, Math.max(1, limit));
}

function historyEntry(payload: NativeWorkflowTestPayload): NativeWorkflowTestHistoryEntry {
  const submittedAt = new Date().toISOString();
  const randomId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { ...payload, id: randomId, submittedAt };
}

export function NativeWorkflowTestDialog({
  open,
  onOpenChange,
  onSubmit,
  workflowName,
  title = 'Testar workflow',
  description = 'Envie uma mensagem de teste e, se necessário, simule as saídas das dependências anteriores.',
  submitLabel = 'Executar teste',
  initialMessage = '',
  initialFixtures = {},
  presets = [],
  dependencies = [],
  fixtureMode: fixtureModeProp,
  maxMessageLength = 4_000,
  loading = false,
  error = null,
  closeOnSuccess = true,
  historyStorageKey,
  maxHistoryEntries = 5,
}: NativeWorkflowTestDialogProps) {
  const fixtureMode = fixtureModeProp || (dependencies.length > 0 ? 'optional' : 'hidden');
  const generatedId = useId();
  const messageId = `${generatedId}-message`;
  const [draft, setDraft] = useState<NativeWorkflowTestDraft>(() => ({
    message: initialMessage,
    fixturesEnabled: fixtureMode === 'required',
    fixtures: createNativeWorkflowFixtureDrafts(dependencies, initialFixtures),
  }));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [internalLoading, setInternalLoading] = useState(false);
  const [internalError, setInternalError] = useState('');
  const [history, setHistory] = useState<NativeWorkflowTestHistoryEntry[]>([]);
  const busy = loading || internalLoading;
  const visibleError = error || internalError;

  useEffect(() => {
    if (!historyStorageKey || typeof window === 'undefined') return;
    setHistory(parseNativeWorkflowTestHistory(window.localStorage.getItem(historyStorageKey), maxHistoryEntries));
  }, [historyStorageKey, maxHistoryEntries]);

  useEffect(() => {
    if (!open) return;
    setDraft((current) => ({
      ...current,
      message: current.message || initialMessage,
      fixturesEnabled: fixtureMode === 'required' || current.fixturesEnabled,
      fixtures: Object.keys(current.fixtures).length > 0
        ? current.fixtures
        : createNativeWorkflowFixtureDrafts(dependencies, initialFixtures),
    }));
  }, [dependencies, fixtureMode, initialFixtures, initialMessage, open]);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === draft.presetId) || null,
    [draft.presetId, presets],
  );

  const persistHistory = (next: NativeWorkflowTestHistoryEntry[]) => {
    setHistory(next);
    if (!historyStorageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(historyStorageKey, JSON.stringify(next));
    } catch {
      // Storage may be disabled; in-memory history remains available.
    }
  };

  const applyPayload = (payload: NativeWorkflowTestPayload) => {
    setDraft({
      message: payload.message,
      presetId: payload.presetId,
      fixturesEnabled: fixtureMode === 'required' || Object.keys(payload.fixtures).length > 0,
      fixtures: createNativeWorkflowFixtureDrafts(dependencies, payload.fixtures),
    });
    setFieldErrors({});
    setInternalError('');
  };

  const applyPreset = (preset: NativeWorkflowTestPreset) => {
    applyPayload({ message: preset.message, presetId: preset.id, fixtures: preset.fixtures || {} });
  };

  const updateFixture = (dependencyId: string, field: keyof NativeWorkflowTestFixtureDraft, value: string) => {
    setDraft((current) => ({
      ...current,
      presetId: undefined,
      fixtures: {
        ...current.fixtures,
        [dependencyId]: {
          outputJson: current.fixtures[dependencyId]?.outputJson || '',
          statePatchJson: current.fixtures[dependencyId]?.statePatchJson || '',
          [field]: value,
        },
      },
    }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[fixtureErrorKey(dependencyId, field === 'outputJson' ? 'output' : 'statePatch')];
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const validation = validateNativeWorkflowTestDraft({ draft, dependencies, fixtureMode, maxMessageLength });
    setFieldErrors(validation.errors);
    setInternalError('');
    if (!validation.payload) return;

    setInternalLoading(true);
    try {
      const result = await onSubmit(validation.payload);
      if (result?.error) {
        setInternalError(result.error);
        return;
      }
      const nextHistory = appendNativeWorkflowTestHistory(
        history,
        historyEntry(validation.payload),
        maxHistoryEntries,
      );
      persistHistory(nextHistory);
      if (closeOnSuccess) onOpenChange(false);
    } catch (cause) {
      setInternalError(cause instanceof Error ? cause.message : 'Não foi possível iniciar o teste.');
    } finally {
      setInternalLoading(false);
    }
  };

  const lastEntry = history[0] || null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent
        className="dark flex max-h-[92vh] w-[min(880px,95vw)] max-w-none flex-col gap-0 overflow-hidden border-slate-700 bg-[#0b121a] p-0 text-slate-100 shadow-2xl"
        aria-busy={busy}
      >
        <DialogHeader className="border-b border-slate-700/80 bg-[#101b26] px-6 py-5 pr-12 text-left">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-300"><Beaker className="h-5 w-5" /></span>
            <span>{title}</span>
          </DialogTitle>
          <DialogDescription className="pt-1 leading-6 text-slate-400">
            {description}{workflowName ? ` Workflow: ${workflowName}.` : ''}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-6 p-6">
              {presets.length > 0 && (
                <fieldset>
                  <legend className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Cenários rápidos</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {presets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={selectedPreset?.id === preset.id}
                        onClick={() => applyPreset(preset)}
                        disabled={busy}
                        className={cn(
                          'rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400',
                          selectedPreset?.id === preset.id
                            ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100'
                            : 'border-slate-700 bg-slate-900/50 text-slate-200 hover:border-slate-500',
                        )}
                      >
                        <span className="block text-sm font-medium">{preset.label}</span>
                        {preset.description && <span className="mt-1 block text-xs leading-5 text-slate-500">{preset.description}</span>}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={messageId}>Mensagem do cliente</Label>
                  <span className={cn('text-xs', draft.message.length > maxMessageLength ? 'text-red-300' : 'text-slate-500')}>
                    {draft.message.length}/{maxMessageLength}
                  </span>
                </div>
                <Textarea
                  id={messageId}
                  value={draft.message}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, message: event.target.value, presetId: undefined }));
                    setFieldErrors((current) => ({ ...current, message: '' }));
                  }}
                  disabled={busy}
                  aria-invalid={Boolean(fieldErrors.message)}
                  aria-describedby={fieldErrors.message ? `${messageId}-error` : undefined}
                  placeholder="Ex.: Olá, preciso da segunda via da minha fatura."
                  className="min-h-28 resize-y border-slate-700 bg-[#121d28] text-slate-100 placeholder:text-slate-500"
                />
                {fieldErrors.message && <p id={`${messageId}-error`} role="alert" className="text-xs text-red-300">{fieldErrors.message}</p>}
              </section>

              {lastEntry && (
                <section className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900/45 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400"><History className="h-3.5 w-3.5" />Última entrada</p>
                    <p className="mt-2 truncate text-sm text-slate-200">{lastEntry.message}</p>
                    <p className="mt-1 text-xs text-slate-500">{new Date(lastEntry.submittedAt).toLocaleString('pt-BR')}</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => applyPayload(lastEntry)} disabled={busy} className="shrink-0 border-slate-600 bg-slate-800/60">
                    <RotateCcw className="mr-2 h-4 w-4" />Usar novamente
                  </Button>
                </section>
              )}

              {fixtureMode !== 'hidden' && dependencies.length > 0 && (
                <fieldset className="rounded-2xl border border-slate-700 bg-slate-900/30 p-4">
                  <legend className="px-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Dependências simuladas</legend>
                  {fixtureMode === 'optional' && (
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={`${generatedId}-fixtures-enabled`}
                        checked={draft.fixturesEnabled}
                        onCheckedChange={(checked) => setDraft((current) => ({ ...current, fixturesEnabled: checked === true }))}
                        disabled={busy}
                      />
                      <div>
                        <Label htmlFor={`${generatedId}-fixtures-enabled`} className="cursor-pointer">Simular saídas anteriores</Label>
                        <p className="mt-1 text-xs leading-5 text-slate-500">Ative para testar este bloco isoladamente com dados controlados.</p>
                      </div>
                    </div>
                  )}
                  {fieldErrors.fixtures && <p role="alert" className="mt-3 text-xs text-red-300">{fieldErrors.fixtures}</p>}

                  {(fixtureMode === 'required' || draft.fixturesEnabled) && (
                    <div className="mt-4 space-y-4">
                      {dependencies.map((dependency) => {
                        const safeId = dependency.id.replace(/[^a-zA-Z0-9_-]/g, '-');
                        const outputId = `${generatedId}-${safeId}-output`;
                        const statePatchId = `${generatedId}-${safeId}-state`;
                        const outputError = fieldErrors[fixtureErrorKey(dependency.id, 'output')];
                        const statePatchError = fieldErrors[fixtureErrorKey(dependency.id, 'statePatch')];
                        return (
                          <section key={dependency.id} className="rounded-xl border border-slate-700/80 bg-[#101821] p-4">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <h3 className="text-sm font-medium text-slate-100">{dependency.label}</h3>
                                {dependency.description && <p className="mt-1 text-xs leading-5 text-slate-500">{dependency.description}</p>}
                              </div>
                              {dependency.required && <Badge variant="outline" className="border-amber-400/30 text-amber-200">Obrigatória</Badge>}
                            </div>
                            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                              <div className="space-y-2">
                                <Label htmlFor={outputId}>Saída JSON</Label>
                                <Textarea
                                  id={outputId}
                                  value={draft.fixtures[dependency.id]?.outputJson || ''}
                                  onChange={(event) => updateFixture(dependency.id, 'outputJson', event.target.value)}
                                  disabled={busy}
                                  spellCheck={false}
                                  aria-invalid={Boolean(outputError)}
                                  aria-describedby={outputError ? `${outputId}-error` : undefined}
                                  placeholder={'{\n  "campo": "valor"\n}'}
                                  className="min-h-32 resize-y border-slate-700 bg-slate-950 font-mono text-xs text-slate-200"
                                />
                                {outputError && <p id={`${outputId}-error`} role="alert" className="text-xs text-red-300">{outputError}</p>}
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={statePatchId}>Estado adicional JSON <span className="font-normal text-slate-500">(opcional)</span></Label>
                                <Textarea
                                  id={statePatchId}
                                  value={draft.fixtures[dependency.id]?.statePatchJson || ''}
                                  onChange={(event) => updateFixture(dependency.id, 'statePatchJson', event.target.value)}
                                  disabled={busy}
                                  spellCheck={false}
                                  aria-invalid={Boolean(statePatchError)}
                                  aria-describedby={statePatchError ? `${statePatchId}-error` : undefined}
                                  placeholder={'{\n  "variavel": "valor"\n}'}
                                  className="min-h-32 resize-y border-slate-700 bg-slate-950 font-mono text-xs text-slate-200"
                                />
                                {statePatchError && <p id={`${statePatchId}-error`} role="alert" className="text-xs text-red-300">{statePatchError}</p>}
                              </div>
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )}
                </fieldset>
              )}

              {visibleError && (
                <Alert variant="destructive" aria-live="assertive" className="border-red-500/30 bg-red-500/10 text-red-100">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>O teste não pôde ser iniciado</AlertTitle>
                  <AlertDescription>{visibleError}</AlertDescription>
                </Alert>
              )}
              <div className="sr-only" aria-live="polite">{busy ? 'Executando teste do workflow.' : ''}</div>
            </div>
          </ScrollArea>

          <DialogFooter className="border-t border-slate-700/80 bg-[#101b26] px-6 py-4 sm:items-center sm:justify-between">
            <p className="text-left text-xs text-slate-500">O teste usa o rascunho atual e não publica alterações.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
              <Button type="submit" disabled={busy} className="bg-cyan-400 text-slate-950 hover:bg-cyan-300">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                {busy ? 'Executando…' : submitLabel}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
