'use client';

import { useEffect, useId, useState } from 'react';
import { CheckCircle2, Database, FileText, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  getAiModelRuntimeProvider,
  type AiModelCatalogEntry,
} from '@/lib/ai-models';
import type { WorkflowNode } from '@/services/workflow-runtime/types';
import {
  applyWorkflowModelSelection,
  getWorkflowModelOptions,
} from '@/components/workflow/native-model-selection';
import type { KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import { cn } from '@/lib/utils';

export const SPECIALIZED_WORKFLOW_INSPECTOR_TYPES = new Set([
  'trigger.received_message',
  'trigger.manual',
  'data.set',
  'data.transform',
  'data.extract',
  'data.template',
  'logic.if',
  'logic.switch',
  'logic.ai_router',
  'logic.goal_completion',
  'logic.wait',
  'ai.model',
  'knowledge.rag_retriever',
  'memory.session',
  'tool.internal',
  'tool.mcp',
  'guardrail.policy',
  'output.respond',
  'output.handoff',
  'output.close_conversation',
  'output.end',
  'error.handler',
]);

export function hasSpecializedWorkflowInspector(type: string) {
  return SPECIALIZED_WORKFLOW_INSPECTOR_TYPES.has(type);
}

type InspectorProps = {
  node: WorkflowNode;
  onUpdate: (node: WorkflowNode) => void;
  modelOptions?: AiModelCatalogEntry[];
  knowledgeDocuments?: KnowledgeBaseDocument[];
  knowledgeCollections?: KnowledgeCollection[];
  onManageKnowledge?: () => void;
  onManageModels?: () => void;
};

function Field({ label, description, children, htmlFor }: { label: string; description?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {description ? <p className="text-xs leading-relaxed text-slate-400">{description}</p> : null}
    </div>
  );
}

function NativeSelect({ id, value, onChange, children, ariaLabel, disabled }: { id?: string; value: string; onChange: (value: string) => void; children: React.ReactNode; ariaLabel?: string; disabled?: boolean }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      disabled={disabled}
      className="flex h-10 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </select>
  );
}

function ToggleField({ label, checked, onCheckedChange, description }: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <span>
        <span className="block text-sm text-slate-200">{label}</span>
        {description ? <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">{description}</span> : null}
      </span>
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
    </label>
  );
}

function StringListField({ label, value, onChange, description }: {
  label: string;
  value: unknown;
  onChange: (value: string[]) => void;
  description?: string;
}) {
  const externalValue = Array.isArray(value) ? value.map(String).join('\n') : '';
  const [draft, setDraft] = useState(externalValue);
  const fieldId = useId().replaceAll(':', '');

  useEffect(() => {
    setDraft(externalValue);
  }, [externalValue]);

  const commit = () => {
    const normalized = draft.split('\n').map((item) => item.trim()).filter(Boolean);
    setDraft(normalized.join('\n'));
    onChange(normalized);
  };

  return (
    <Field label={label} description={description} htmlFor={fieldId}>
      <Textarea
        id={fieldId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        className="min-h-24"
        placeholder="Um item por linha"
      />
    </Field>
  );
}

export type GuidedRecordValueKind = 'text' | 'number' | 'boolean';

export type GuidedRecordEntry = {
  key: string;
  value: string;
  kind: GuidedRecordValueKind;
};

export function splitRecordForGuidedEditing(value: unknown): {
  entries: GuidedRecordEntry[];
  preserved: Record<string, unknown>;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { entries: [], preserved: {} };
  const entries: GuidedRecordEntry[] = [];
  const preserved: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === 'string') entries.push({ key, value: entryValue, kind: 'text' });
    else if (typeof entryValue === 'number') entries.push({ key, value: String(entryValue), kind: 'number' });
    else if (typeof entryValue === 'boolean') entries.push({ key, value: String(entryValue), kind: 'boolean' });
    else preserved[key] = entryValue;
  }
  return { entries, preserved };
}

export function guidedRecordEntriesToRecord(
  entries: GuidedRecordEntry[],
  preserved: Record<string, unknown> = {},
): Record<string, unknown> {
  const result = { ...preserved };
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key) continue;
    result[key] = entry.kind === 'number'
      ? Number(entry.value || 0)
      : entry.kind === 'boolean'
        ? entry.value === 'true'
        : entry.value;
  }
  return result;
}

function GuidedRecordEditor({
  value,
  onChange,
  keyLabel = 'Nome',
  valueLabel = 'Valor',
  addLabel = 'Adicionar campo',
  emptyMessage = 'Nenhum campo configurado.',
}: {
  value: unknown;
  onChange: (value: Record<string, unknown>) => void;
  keyLabel?: string;
  valueLabel?: string;
  addLabel?: string;
  emptyMessage?: string;
}) {
  const parsed = splitRecordForGuidedEditing(value);
  const externalSignature = JSON.stringify(parsed.entries);
  const [entries, setEntries] = useState(parsed.entries);
  const idPrefix = useId().replaceAll(':', '');

  useEffect(() => {
    setEntries(parsed.entries);
  // The serialized primitive entries are the external controlled value for this repeater.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSignature]);

  const commit = (nextEntries: GuidedRecordEntry[]) => {
    setEntries(nextEntries);
    onChange(guidedRecordEntriesToRecord(nextEntries, parsed.preserved));
  };

  const patchEntry = (index: number, patch: Partial<GuidedRecordEntry>) => {
    const next = entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry);
    setEntries(next);
  };

  return (
    <div className="space-y-3">
      {entries.map((entry, index) => {
        const keyId = `${idPrefix}-key-${index}`;
        const valueId = `${idPrefix}-value-${index}`;
        const kindId = `${idPrefix}-kind-${index}`;
        return (
          <div key={`guided-record-${index}`} className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor={keyId} className="text-xs text-slate-400">{keyLabel}</Label>
                <Input
                  id={keyId}
                  value={entry.key}
                  onChange={(event) => patchEntry(index, { key: event.target.value })}
                  onBlur={() => commit(entries)}
                  placeholder="Ex.: nome_cliente"
                />
              </div>
              <div className="w-28 space-y-1.5">
                <Label htmlFor={kindId} className="text-xs text-slate-400">Tipo</Label>
                <NativeSelect
                  id={kindId}
                  value={entry.kind}
                  onChange={(kind) => commit(entries.map((candidate, entryIndex) => (
                    entryIndex === index ? { ...candidate, kind: kind as GuidedRecordValueKind, value: kind === 'boolean' ? 'true' : candidate.value } : candidate
                  )))}
                >
                  <option value="text">Texto</option>
                  <option value="number">Número</option>
                  <option value="boolean">Sim/não</option>
                </NativeSelect>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remover ${entry.key || `campo ${index + 1}`}`}
                onClick={() => commit(entries.filter((_, entryIndex) => entryIndex !== index))}
              >
                <Trash2 className="h-4 w-4 text-red-300" />
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={valueId} className="text-xs text-slate-400">{valueLabel}</Label>
              {entry.kind === 'boolean' ? (
                <NativeSelect
                  id={valueId}
                  value={entry.value === 'false' ? 'false' : 'true'}
                  onChange={(nextValue) => commit(entries.map((candidate, entryIndex) => entryIndex === index ? { ...candidate, value: nextValue } : candidate))}
                >
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </NativeSelect>
              ) : (
                <Input
                  id={valueId}
                  type={entry.kind === 'number' ? 'number' : 'text'}
                  value={entry.value}
                  onChange={(event) => patchEntry(index, { value: event.target.value })}
                  onBlur={() => commit(entries)}
                  placeholder={entry.kind === 'text' ? 'Texto ou {{variável}}' : '0'}
                />
              )}
            </div>
          </div>
        );
      })}
      {entries.length === 0 ? <p className="rounded-lg border border-dashed border-white/[0.08] p-3 text-xs text-slate-500">{emptyMessage}</p> : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setEntries([...entries, { key: '', value: '', kind: 'text' }])}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />{addLabel}
      </Button>
      {Object.keys(parsed.preserved).length > 0 ? (
        <p className="text-[11px] leading-relaxed text-slate-500">
          {Object.keys(parsed.preserved).length} {Object.keys(parsed.preserved).length === 1 ? 'campo avançado foi preservado' : 'campos avançados foram preservados'} sem alteração.
        </p>
      ) : null}
    </div>
  );
}

type GuidedSchemaField = {
  name: string;
  type: string;
  description: string;
  required: boolean;
};

export function schemaToGuidedFields(schema: unknown): GuidedSchemaField[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const record = schema as Record<string, unknown>;
  const properties = record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
    ? record.properties as Record<string, unknown>
    : {};
  const required = new Set(Array.isArray(record.required) ? record.required.map(String) : []);
  return Object.entries(properties).map(([name, definition]) => {
    const property = definition && typeof definition === 'object' && !Array.isArray(definition)
      ? definition as Record<string, unknown>
      : {};
    return {
      name,
      type: String(property.type || 'string'),
      description: String(property.description || ''),
      required: required.has(name),
    };
  });
}

export function guidedFieldsToSchema(fields: GuidedSchemaField[], previousSchema: unknown): Record<string, unknown> {
  const previous = previousSchema && typeof previousSchema === 'object' && !Array.isArray(previousSchema)
    ? previousSchema as Record<string, unknown>
    : {};
  const previousProperties = previous.properties && typeof previous.properties === 'object' && !Array.isArray(previous.properties)
    ? previous.properties as Record<string, unknown>
    : {};
  const properties: Record<string, unknown> = {};
  for (const field of fields) {
    const name = field.name.trim();
    if (!name) continue;
    const previousProperty = previousProperties[name] && typeof previousProperties[name] === 'object' && !Array.isArray(previousProperties[name])
      ? previousProperties[name] as Record<string, unknown>
      : {};
    properties[name] = {
      ...previousProperty,
      type: field.type,
      ...(field.description.trim() ? { description: field.description.trim() } : { description: undefined }),
    };
  }
  return {
    ...previous,
    type: 'object',
    properties,
    required: fields.filter((field) => field.required && field.name.trim()).map((field) => field.name.trim()),
  };
}

function GuidedSchemaEditor({ value, onChange }: { value: unknown; onChange: (value: Record<string, unknown>) => void }) {
  const fields = schemaToGuidedFields(value);
  const patch = (index: number, change: Partial<GuidedSchemaField>) => {
    onChange(guidedFieldsToSchema(fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...change } : field), value));
  };
  return (
    <div className="space-y-3">
      {fields.map((field, index) => {
        const fieldId = `schema-${index}-${field.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        return (
          <div key={`guided-schema-${index}`} className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor={`${fieldId}-name`} className="text-xs text-slate-400">Campo esperado</Label>
                <Input id={`${fieldId}-name`} value={field.name} onChange={(event) => patch(index, { name: event.target.value.trim().replace(/\s+/g, '_') })} placeholder="Ex.: email" />
              </div>
              <div className="w-28 space-y-1.5">
                <Label htmlFor={`${fieldId}-type`} className="text-xs text-slate-400">Tipo</Label>
                <NativeSelect id={`${fieldId}-type`} value={field.type} onChange={(type) => patch(index, { type })}>
                  <option value="string">Texto</option>
                  <option value="number">Número</option>
                  <option value="integer">Número inteiro</option>
                  <option value="boolean">Sim/não</option>
                  <option value="array">Lista</option>
                  <option value="object">Objeto</option>
                </NativeSelect>
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label={`Remover campo ${field.name || index + 1}`} onClick={() => onChange(guidedFieldsToSchema(fields.filter((_, fieldIndex) => fieldIndex !== index), value))}>
                <Trash2 className="h-4 w-4 text-red-300" />
              </Button>
            </div>
            <Input aria-label={`Descrição do campo ${field.name || index + 1}`} value={field.description} onChange={(event) => patch(index, { description: event.target.value })} placeholder="Explique qual informação deve ser extraída" />
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <Checkbox checked={field.required} onCheckedChange={(checked) => patch(index, { required: checked === true })} />
              Informação obrigatória
            </label>
          </div>
        );
      })}
      {fields.length === 0 ? <p className="rounded-lg border border-dashed border-white/[0.08] p-3 text-xs text-slate-500">Adicione os dados que a IA deve encontrar no texto.</p> : null}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange(guidedFieldsToSchema([...fields, { name: '', type: 'string', description: '', required: false }], value))}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />Adicionar dado esperado
      </Button>
    </div>
  );
}

function AdvancedJsonPreview({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-300 marker:content-none">
        {label}
      </summary>
      <div className="border-t border-white/[0.07] p-4">
        <Textarea
          value={JSON.stringify(value || {}, null, 2)}
          readOnly
          aria-label={`${label}, somente leitura`}
          className="min-h-28 cursor-default font-mono text-xs text-slate-400"
        />
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Informação técnica preservada automaticamente.</p>
      </div>
    </details>
  );
}

function useNodeUpdater(node: WorkflowNode, onUpdate: (node: WorkflowNode) => void) {
  const config = (key: string, value: unknown) => onUpdate({ ...node, config: { ...node.config, [key]: value } });
  const rename = (name: string) => onUpdate({ ...node, name });
  return { config, rename };
}

function TriggerInspector({ node }: InspectorProps) {
  const receivedMessage = node.type === 'trigger.received_message';
  return (
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4" role="status">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
        <div>
          <p className="text-sm font-medium text-slate-100">Pronto para usar</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {receivedMessage
              ? 'O fluxo será iniciado automaticamente quando uma nova mensagem chegar ao atendimento.'
              : 'Este gatilho inicia o fluxo somente quando você executar um teste ou uma chamada manual.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function DataSetInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return (
    <div className="space-y-4">
      <div>
        <Label>Informações que serão criadas</Label>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">Defina um nome e um valor. Você pode usar variáveis como {'{{current.nome}}'}.</p>
      </div>
      <GuidedRecordEditor
        value={node.config.assignments}
        onChange={(value) => config('assignments', value)}
        keyLabel="Nome da informação"
        valueLabel="Conteúdo"
        addLabel="Adicionar informação"
        emptyMessage="Adicione a primeira informação que este bloco deve guardar."
      />
    </div>
  );
}

function DataTransformInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return (
    <div className="space-y-4">
      <div>
        <Label>Resultado da transformação</Label>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">Para cada campo de saída, informe o texto ou variável que deve preencher seu valor.</p>
      </div>
      <GuidedRecordEditor
        value={node.config.mappings}
        onChange={(value) => config('mappings', value)}
        keyLabel="Campo de saída"
        valueLabel="Origem ou valor"
        addLabel="Adicionar mapeamento"
        emptyMessage="Nenhum mapeamento configurado."
      />
    </div>
  );
}

function DataExtractInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const attemptsId = `extract-attempts-${node.id}`;
  return (
    <div className="space-y-5">
      <div>
        <Label>Dados que a IA deve extrair</Label>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">Adicione os campos esperados sem precisar escrever um schema JSON.</p>
      </div>
      <GuidedSchemaEditor value={node.config.schema} onChange={(schema) => config('schema', schema)} />
      <Field label="Tentativas quando a resposta vier incompleta" htmlFor={attemptsId}>
        <NativeSelect id={attemptsId} value={String(node.config.maxAttempts || 2)} onChange={(value) => config('maxAttempts', Number(value))}>
          <option value="1">1 tentativa</option>
          <option value="2">2 tentativas</option>
          <option value="3">3 tentativas</option>
          <option value="4">4 tentativas</option>
        </NativeSelect>
      </Field>
      <AdvancedJsonPreview label="Ver schema técnico" value={node.config.schema} />
    </div>
  );
}

function DataTemplateInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const templateId = `template-content-${node.id}`;
  const outputId = `template-output-${node.id}`;
  return (
    <div className="space-y-5">
      <Field label="Texto que será produzido" htmlFor={templateId} description="Insira variáveis entre chaves, por exemplo: Olá, {{current.nome}}.">
        <Textarea id={templateId} value={String(node.config.template || '')} onChange={(event) => config('template', event.target.value)} className="min-h-36" placeholder="Olá, {{current.nome}}! Como posso ajudar?" />
      </Field>
      <Field label="Nome do resultado" htmlFor={outputId} description="Use um nome simples para recuperar este texto nos próximos blocos.">
        <Input id={outputId} value={String(node.config.outputKey || 'text')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} placeholder="mensagem" />
      </Field>
    </div>
  );
}

const CONDITION_OPERATORS = [
  { value: 'equals', label: 'É igual a' },
  { value: 'not_equals', label: 'É diferente de' },
  { value: 'contains', label: 'Contém' },
  { value: 'not_contains', label: 'Não contém' },
  { value: 'starts_with', label: 'Começa com' },
  { value: 'ends_with', label: 'Termina com' },
  { value: 'greater_than', label: 'É maior que' },
  { value: 'greater_or_equal', label: 'É maior ou igual a' },
  { value: 'less_than', label: 'É menor que' },
  { value: 'less_or_equal', label: 'É menor ou igual a' },
  { value: 'exists', label: 'Está preenchido' },
  { value: 'not_exists', label: 'Não está preenchido' },
] as const;

function LogicIfInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const leftId = `if-left-${node.id}`;
  const operatorId = `if-operator-${node.id}`;
  const rightId = `if-right-${node.id}`;
  const operator = String(node.config.operator || 'equals');
  const unary = operator === 'exists' || operator === 'not_exists';
  return (
    <div className="space-y-5">
      <Field label="Informação que será verificada" htmlFor={leftId} description="Pode ser um texto fixo ou o caminho de uma informação, como $.current.status.">
        <Input id={leftId} value={String(node.config.left || '')} onChange={(event) => config('left', event.target.value)} placeholder="$.current.status" />
      </Field>
      <Field label="Comparação" htmlFor={operatorId}>
        <NativeSelect id={operatorId} value={operator} onChange={(value) => config('operator', value)}>
          {CONDITION_OPERATORS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </NativeSelect>
      </Field>
      {!unary ? (
        <Field label="Valor esperado" htmlFor={rightId}>
          <Input id={rightId} value={String(node.config.right ?? '')} onChange={(event) => config('right', event.target.value)} placeholder="Ex.: aprovado" />
        </Field>
      ) : null}
      <p className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-3 text-xs leading-relaxed text-slate-400">
        Se a comparação for atendida, o fluxo seguirá pela saída <strong className="font-medium text-emerald-300">Verdadeiro</strong>; caso contrário, seguirá por <strong className="font-medium text-amber-300">Falso</strong>.
      </p>
    </div>
  );
}

type SwitchCase = { output: string; label: string; operator: string; value: string };

function readSwitchCases(value: unknown): SwitchCase[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).map((item, index) => ({
    output: String(item.output || `case_${index + 1}`),
    label: String(item.label || `Caminho ${index + 1}`),
    operator: String(item.operator || 'equals'),
    value: String(item.value ?? ''),
  }));
}

function LogicSwitchInspector({ node, onUpdate }: InspectorProps) {
  const cases = readSwitchCases(node.config.cases);
  const valueId = `switch-value-${node.id}`;
  const updateCases = (nextCases: SwitchCase[]) => {
    const reserved = node.outputPorts.filter((port) => ['default', 'error'].includes(port.id));
    const dynamic = nextCases.map((item) => ({
      id: item.output,
      label: item.label || item.output,
      direction: 'output' as const,
      connectionType: 'main' as const,
      required: true,
      multiple: false,
    }));
    onUpdate({ ...node, config: { ...node.config, cases: nextCases, defaultOutput: 'default' }, outputPorts: [...dynamic, ...reserved] });
  };
  const patchCase = (index: number, patch: Partial<SwitchCase>) => updateCases(cases.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const addCase = () => {
    let suffix = cases.length + 1;
    while (cases.some((item) => item.output === `case_${suffix}`)) suffix += 1;
    updateCases([...cases, { output: `case_${suffix}`, label: `Caminho ${suffix}`, operator: 'equals', value: '' }]);
  };
  return (
    <div className="space-y-5">
      <Field label="Informação que decide o caminho" htmlFor={valueId} description="Informe o caminho do dado que será comparado, como $.current.assunto.">
        <Input id={valueId} value={String(node.config.value || '')} onChange={(event) => onUpdate({ ...node, config: { ...node.config, value: event.target.value } })} placeholder="$.current.assunto" />
      </Field>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div><Label>Caminhos possíveis</Label><p className="mt-1 text-[11px] text-slate-500">Cada caminho vira uma saída conectável no bloco.</p></div>
          <Button type="button" size="sm" variant="outline" onClick={addCase}><Plus className="mr-1 h-3.5 w-3.5" />Caminho</Button>
        </div>
        {cases.map((item, index) => {
          const prefix = `switch-${node.id}-${index}`;
          return (
            <div key={item.output} className="space-y-3 rounded-xl border border-amber-400/15 bg-amber-400/[0.035] p-3">
              <div className="flex items-end gap-2">
                <Field label="Nome do caminho" htmlFor={`${prefix}-label`}><Input id={`${prefix}-label`} value={item.label} onChange={(event) => patchCase(index, { label: event.target.value })} placeholder={`Caminho ${index + 1}`} /></Field>
                <Button type="button" size="icon" variant="ghost" aria-label={`Excluir caminho ${item.label || index + 1}`} onClick={() => updateCases(cases.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4 text-red-300" /></Button>
              </div>
              <Field label="Quando" htmlFor={`${prefix}-operator`}>
                <NativeSelect id={`${prefix}-operator`} value={item.operator} onChange={(operator) => patchCase(index, { operator })}>
                  {CONDITION_OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
                </NativeSelect>
              </Field>
              {!['exists', 'not_exists'].includes(item.operator) ? <Field label="Valor" htmlFor={`${prefix}-value`}><Input id={`${prefix}-value`} value={item.value} onChange={(event) => patchCase(index, { value: event.target.value })} placeholder="Valor que ativa este caminho" /></Field> : null}
            </div>
          );
        })}
        {cases.length === 0 ? <p className="rounded-lg border border-dashed border-white/[0.08] p-3 text-xs text-slate-500">Adicione ao menos um caminho. Valores sem correspondência seguirão por “Padrão”.</p> : null}
      </div>
    </div>
  );
}

export function timeoutMsToGuidedDuration(timeoutMs: unknown): { value: number; unit: 'minutes' | 'hours' | 'days' } {
  const milliseconds = Math.max(60_000, Number(timeoutMs) || 60_000);
  if (milliseconds % 86_400_000 === 0) return { value: milliseconds / 86_400_000, unit: 'days' };
  if (milliseconds % 3_600_000 === 0) return { value: milliseconds / 3_600_000, unit: 'hours' };
  return { value: Math.max(1, Math.round(milliseconds / 60_000)), unit: 'minutes' };
}

export function guidedDurationToMs(value: number, unit: 'minutes' | 'hours' | 'days') {
  const multiplier = unit === 'days' ? 86_400_000 : unit === 'hours' ? 3_600_000 : 60_000;
  return Math.max(1, value) * multiplier;
}

function LogicWaitInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const mode = String(node.config.mode || 'event');
  const duration = timeoutMsToGuidedDuration(node.config.timeoutMs);
  const modeId = `wait-mode-${node.id}`;
  const durationId = `wait-duration-${node.id}`;
  const unitId = `wait-unit-${node.id}`;
  const eventId = `wait-event-${node.id}`;
  return (
    <div className="space-y-5">
      <Field label="O que faz o fluxo continuar?" htmlFor={modeId}>
        <NativeSelect id={modeId} value={mode} onChange={(value) => config('mode', value)}>
          <option value="event">Acontecimento ou resposta</option>
          <option value="time">Passagem de tempo</option>
        </NativeSelect>
      </Field>
      {mode === 'time' ? (
        <div className="grid grid-cols-[1fr_9rem] gap-3">
          <Field label="Tempo de espera" htmlFor={durationId}><Input id={durationId} type="number" min={1} value={duration.value} onChange={(event) => config('timeoutMs', guidedDurationToMs(Number(event.target.value), duration.unit))} /></Field>
          <Field label="Unidade" htmlFor={unitId}>
            <NativeSelect id={unitId} value={duration.unit} onChange={(unit) => config('timeoutMs', guidedDurationToMs(duration.value, unit as 'minutes' | 'hours' | 'days'))}>
              <option value="minutes">Minutos</option><option value="hours">Horas</option><option value="days">Dias</option>
            </NativeSelect>
          </Field>
        </div>
      ) : (
        <Field label="Acontecimento esperado" htmlFor={eventId} description="Use um nome reconhecível, como cliente_respondeu ou pagamento_confirmado.">
          <Input id={eventId} value={String(node.config.resumeEvent || '')} onChange={(event) => config('resumeEvent', event.target.value.trim().replace(/\s+/g, '_'))} placeholder="cliente_respondeu" />
        </Field>
      )}
      <p className="rounded-lg border border-sky-400/15 bg-sky-400/[0.04] p-3 text-xs leading-relaxed text-slate-400">Se o tempo limite for atingido antes da retomada, conecte a saída “Expirado” ao próximo passo adequado.</p>
    </div>
  );
}

function GoalCompletionInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return (
    <div className="space-y-5">
      <div role="note" className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-xs leading-relaxed text-slate-300">
        Este bloco calcula a conclusão no próprio sistema. Ligue a saída “Concluído” ao encerramento e a saída “Incompleto” a uma pergunta ou continuação do fluxo.
      </div>
      <StringListField
        label="Campos obrigatórios"
        value={node.config.requiredFields}
        onChange={(value) => config('requiredFields', value)}
        description="Um campo por linha. Os aliases comuns são reconhecidos: nome, documento/CPF/CNPJ, telefone, e-mail, CEP, endereço, produto, serviço e plano."
      />
      <StringListField
        label="Etapas obrigatórias"
        value={node.config.requiredOperations}
        onChange={(value) => config('requiredOperations', value)}
        description="Opcional. Use o ID do bloco, ID:saída para exigir uma rota específica, ou system:slot_memory_persisted, system:contact_facts_persisted e system:crm_custom_fields_persisted."
      />
      <ToggleField
        label="Exigir sinal de conclusão do agente"
        checked={node.config.requireCompletionSignal !== false}
        onCheckedChange={(value) => config('requireCompletionSignal', value)}
        description="Impede fechar apenas porque os dados existem quando o agente ainda não terminou a tarefa."
      />
      <ToggleField
        label="Permitir objetivo sem campos obrigatórios"
        checked={node.config.allowFieldlessCompletion === true}
        onCheckedChange={(value) => config('allowFieldlessCompletion', value)}
        description="Use somente em fluxos informativos. Em coletas, mantenha desligado para evitar encerramento prematuro."
      />
    </div>
  );
}

function MemorySessionInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const messagesId = `memory-messages-${node.id}`;
  const durationId = `memory-duration-${node.id}`;
  const hours = Math.max(1, Math.round(Number(node.config.ttlSeconds || 86_400) / 3_600));
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-violet-400/15 bg-violet-400/[0.05] p-3 text-xs leading-relaxed text-slate-400">A memória da conversa é armazenada com segurança pelo workspace. O provedor técnico é configurado automaticamente.</div>
      <Field label="Quantas mensagens recentes lembrar" htmlFor={messagesId}>
        <Input id={messagesId} type="number" min={1} max={200} value={Number(node.config.maxMessages || 20)} onChange={(event) => config('maxMessages', Number(event.target.value))} />
      </Field>
      <Field label="Por quantas horas manter a memória" htmlFor={durationId}>
        <Input id={durationId} type="number" min={1} max={8_760} value={hours} onChange={(event) => config('ttlSeconds', Number(event.target.value) * 3_600)} />
      </Field>
      <AdvancedJsonPreview label="Ver configuração técnica" value={{ provider: node.config.provider || 'postgres' }} />
    </div>
  );
}

function RespondInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const channelId = `respond-channel-${node.id}`;
  const messageId = `respond-message-${node.id}`;
  return (
    <div className="space-y-5">
      <Field label="Enviar pelo canal" htmlFor={channelId} description="“Mesmo canal da conversa” funciona para WhatsApp, Instagram e demais origens compatíveis.">
        <NativeSelect id={channelId} value={String(node.config.channel || 'source')} onChange={(value) => config('channel', value)}>
          <option value="source">Mesmo canal da conversa</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
          <option value="internal">Canal interno</option>
        </NativeSelect>
      </Field>
      <Field label="Mensagem" htmlFor={messageId} description="Use variáveis como {{current.response}} para inserir a resposta criada por um bloco anterior.">
        <Textarea id={messageId} value={String(node.config.message || '')} onChange={(event) => config('message', event.target.value)} className="min-h-36" placeholder="{{current.response}}" />
      </Field>
      <ToggleField label="Evitar envio duplicado" checked={node.config.idempotent !== false} onCheckedChange={(value) => config('idempotent', value)} description="Recomendado para impedir mensagens repetidas em uma nova tentativa." />
    </div>
  );
}

function HandoffInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const teamId = `handoff-team-${node.id}`;
  const reasonId = `handoff-reason-${node.id}`;
  return (
    <div className="space-y-5">
      <Field label="Equipe que receberá o atendimento" htmlFor={teamId} description="Informe o nome ou identificador da equipe configurada no workspace.">
        <Input id={teamId} value={String(node.config.teamId || '')} onChange={(event) => config('teamId', event.target.value)} placeholder="Ex.: Financeiro" />
      </Field>
      <Field label="Motivo da transferência" htmlFor={reasonId} description="Este texto ajuda a equipe humana a entender o contexto.">
        <Textarea id={reasonId} value={String(node.config.reason || '')} onChange={(event) => config('reason', event.target.value)} className="min-h-28" placeholder="Explique quando e por que transferir" />
      </Field>
      <ToggleField label="Confirmar antes de transferir" checked={node.config.requireConfirmation === true} onCheckedChange={(value) => config('requireConfirmation', value)} description="Peça confirmação quando a transferência tiver impacto no atendimento." />
    </div>
  );
}

function CloseConversationInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const reasonId = `close-reason-${node.id}`;
  const notesId = `close-notes-${node.id}`;
  const tagId = `close-tag-${node.id}`;
  return (
    <div className="space-y-5">
      <div role="note" className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-xs leading-relaxed text-slate-300">
        Este bloco só encerra sem pedido explícito do cliente quando recebe a prova do bloco “Objetivo concluído” na mesma execução. Uma resposta comum ou um agradecimento não autorizam o fechamento.
      </div>
      <Field label="Motivo do encerramento" htmlFor={reasonId} description="Explique qual objetivo foi concluído.">
        <Input id={reasonId} value={String(node.config.reason || '')} onChange={(event) => config('reason', event.target.value)} placeholder="Objetivo do atendimento concluído" />
      </Field>
      <Field label="Resumo interno" htmlFor={notesId} description="Fica registrado no atendimento e não é enviado ao cliente.">
        <Textarea id={notesId} value={String(node.config.notes || '')} onChange={(event) => config('notes', event.target.value)} className="min-h-24" placeholder="Dados confirmados e resultado alcançado" />
      </Field>
      <Field label="Marcador de motivo (opcional)" htmlFor={tagId}>
        <Input id={tagId} value={String(node.config.reasonTagId || '')} onChange={(event) => config('reasonTagId', event.target.value)} placeholder="ID do marcador" />
      </Field>
      <ToggleField label="Enviar template de encerramento" checked={node.config.sendCloseMessage === true} onCheckedChange={(value) => config('sendCloseMessage', value)} description="Use somente quando o fluxo não enviou uma mensagem final própria." />
    </div>
  );
}

function EndInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return (
    <div className="space-y-4">
      <div><Label>Informações finais do fluxo</Label><p className="mt-1 text-xs leading-relaxed text-slate-500">Opcionalmente, defina os dados que serão entregues como resultado da execução.</p></div>
      <GuidedRecordEditor value={node.config.output} onChange={(value) => config('output', value)} keyLabel="Nome do resultado" valueLabel="Conteúdo" addLabel="Adicionar resultado" emptyMessage="O fluxo terminará usando apenas os dados já disponíveis." />
    </div>
  );
}

function ErrorHandlerInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const modeId = `error-mode-${node.id}`;
  const messageId = `error-message-${node.id}`;
  const mode = String(node.config.mode || 'fail');
  return (
    <div className="space-y-5">
      <Field label="Quando ocorrer um erro" htmlFor={modeId}>
        <NativeSelect id={modeId} value={mode} onChange={(value) => config('mode', value)}>
          <option value="fail">Encerrar o fluxo com segurança</option>
          <option value="recover">Recuperar e continuar</option>
        </NativeSelect>
      </Field>
      {mode === 'fail' ? (
        <Field label="Mensagem segura" htmlFor={messageId} description="Evite incluir dados técnicos ou sensíveis nesta mensagem.">
          <Textarea id={messageId} value={String(node.config.publicMessage || '')} onChange={(event) => config('publicMessage', event.target.value)} className="min-h-24" placeholder="Não foi possível concluir esta etapa." />
        </Field>
      ) : (
        <p className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.05] p-3 text-xs leading-relaxed text-slate-400">A execução seguirá pela saída “Recuperado”. Conecte essa saída a um caminho que saiba continuar com segurança.</p>
      )}
    </div>
  );
}

export function AiRouterInspector({ node, onUpdate }: InspectorProps) {
  const { config, rename } = useNodeUpdater(node, onUpdate);
  const routes = Array.isArray(node.config.routes)
    ? node.config.routes.filter((route): route is Record<string, unknown> => Boolean(route) && typeof route === 'object' && !Array.isArray(route))
    : [];

  const updateRoutes = (nextRoutes: Record<string, unknown>[]) => {
    const reserved = node.outputPorts.filter((port) => ['default', 'low_confidence', 'error'].includes(port.id));
    const dynamic = nextRoutes.map((route) => ({
      id: String(route.id),
      label: String(route.label || route.id),
      direction: 'output' as const,
      connectionType: 'main' as const,
      required: true,
      multiple: false,
    }));
    onUpdate({
      ...node,
      config: { ...node.config, routes: nextRoutes },
      outputPorts: [...dynamic, ...reserved],
    });
  };

  const patchRoute = (index: number, patch: Record<string, unknown>) => {
    const next = routes.map((route, routeIndex) => routeIndex === index ? { ...route, ...patch } : route);
    updateRoutes(next);
  };

  const addRoute = () => {
    let suffix = routes.length + 1;
    while (routes.some((route) => route.id === `rota_${suffix}`)) suffix += 1;
    updateRoutes([...routes, { id: `rota_${suffix}`, label: `Rota ${suffix}`, description: '', examples: [] }]);
  };

  return (
    <div className="space-y-5">
      <Field label="Nome do roteador"><Input value={node.name} onChange={(event) => rename(event.target.value)} /></Field>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div><Label>Rotas permitidas</Label><p className="text-[11px] text-slate-500">A IA somente pode selecionar IDs declarados aqui.</p></div>
          <Button type="button" size="sm" variant="outline" onClick={addRoute}><Plus className="mr-1 h-3.5 w-3.5" />Rota</Button>
        </div>
        {routes.map((route, index) => (
          <div key={`ai-route-${index}`} className="space-y-3 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.035] p-3">
            <div className="flex gap-2">
              <Input
                aria-label={`ID da rota ${index + 1}`}
                value={String(route.id || '')}
                onChange={(event) => patchRoute(index, { id: event.target.value.trim().replace(/[^a-zA-Z0-9_-]/g, '_') })}
                placeholder="id_da_rota"
              />
              <Button type="button" size="icon" variant="ghost" aria-label={`Excluir rota ${index + 1}`} onClick={() => updateRoutes(routes.filter((_, routeIndex) => routeIndex !== index))}><Trash2 className="h-4 w-4 text-red-300" /></Button>
            </div>
            <Input value={String(route.label || '')} onChange={(event) => patchRoute(index, { label: event.target.value })} placeholder="Nome visível" />
            <Textarea value={String(route.description || '')} onChange={(event) => patchRoute(index, { description: event.target.value })} placeholder="Quando esta rota deve ser escolhida" />
            <StringListField label="Exemplos" value={route.examples} onChange={(examples) => patchRoute(index, { examples })} />
          </div>
        ))}
      </div>
      <Field label="Confiança mínima" description="Abaixo deste valor a execução segue pela saída de baixa confiança.">
        <Input type="number" min={0} max={1} step={0.05} value={Number(node.config.minimumConfidence ?? 0.75)} onChange={(event) => config('minimumConfidence', Number(event.target.value))} />
      </Field>
      <Field label="Fallback para rota desconhecida"><NativeSelect value={String(node.config.defaultOutput || 'default')} onChange={(value) => config('defaultOutput', value)}><option value="default">Padrão</option>{routes.map((route) => <option key={String(route.id)} value={String(route.id)}>{String(route.label || route.id)}</option>)}</NativeSelect></Field>
      <Field label="Saída de baixa confiança"><NativeSelect value={String(node.config.lowConfidenceOutput || 'low_confidence')} onChange={(value) => config('lowConfidenceOutput', value)}><option value="low_confidence">Baixa confiança</option><option value="default">Padrão</option>{routes.map((route) => <option key={String(route.id)} value={String(route.id)}>{String(route.label || route.id)}</option>)}</NativeSelect></Field>
    </div>
  );
}

export function ModelInspector({ node, onUpdate, modelOptions = [], onManageModels }: InspectorProps) {
  const { config, rename } = useNodeUpdater(node, onUpdate);
  const currentModel = String(node.config.model || '');
  const selectOptions = getWorkflowModelOptions(modelOptions, currentModel);
  const runtimeProvider = String(node.config.provider || getAiModelRuntimeProvider(currentModel));
  const showBaseUrl = runtimeProvider === 'lmstudio'
    || runtimeProvider === 'other'
    || Boolean(node.config.baseUrl);

  const selectModel = (modelId: string) => {
    onUpdate(applyWorkflowModelSelection(node, modelId));
  };

  return (
    <div className="space-y-5">
      <Field label="Nome do bloco"><Input value={node.name} onChange={(event) => rename(event.target.value)} /></Field>
      <Field
        label="Modelo"
        description={modelOptions.length > 0
          ? 'Somente modelos configurados com credencial neste workspace aparecem aqui. O provedor é preenchido automaticamente.'
          : 'Nenhum modelo com credencial está configurado neste workspace.'}
      >
        <NativeSelect value={currentModel} onChange={selectModel} disabled={modelOptions.length === 0}>
          {!currentModel && <option value="">Selecione um modelo</option>}
          {selectOptions.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} · {model.legacy ? 'configuração antiga' : model.provider}
            </option>
          ))}
        </NativeSelect>
        {modelOptions.length === 0 ? <Button type="button" size="sm" variant="outline" onClick={onManageModels} className="border-amber-300/25 text-amber-100">Configurar modelos de IA</Button> : null}
      </Field>
      <Field label="Provedor" description="Definido pelo modelo selecionado.">
        <Input value={runtimeProvider} readOnly className="cursor-default opacity-75" />
      </Field>
      {showBaseUrl ? (
        <Field label="URL base" description="Opcional para LM Studio ou provedores customizados. A credencial é resolvida pelo workspace no servidor.">
          <Input value={String(node.config.baseUrl || '')} onChange={(event) => config('baseUrl', event.target.value || undefined)} placeholder="http://host.docker.internal:1234/v1" />
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-3"><Field label="Temperatura"><Input type="number" min={0} max={2} step={0.1} value={Number(node.config.temperature ?? 0.2)} onChange={(event) => config('temperature', Number(event.target.value))} /></Field><Field label="Máx. tokens"><Input type="number" min={1} value={Number(node.config.maxOutputTokens || 2048)} onChange={(event) => config('maxOutputTokens', Number(event.target.value))} /></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Timeout (ms)"><Input type="number" min={1000} value={Number(node.config.timeoutMs || 60000)} onChange={(event) => config('timeoutMs', Number(event.target.value))} /></Field><Field label="Tentativas"><Input type="number" min={0} max={10} value={Number(node.config.maxRetries ?? 2)} onChange={(event) => config('maxRetries', Number(event.target.value))} /></Field></div>
      <ToggleField label="Tool calling" checked={node.config.supportsTools === true} onCheckedChange={(value) => config('supportsTools', value)} />
      <ToggleField label="Saída estruturada" checked={node.config.supportsStructuredOutput === true} onCheckedChange={(value) => config('supportsStructuredOutput', value)} />
      <ToggleField label="Streaming" checked={node.config.supportsStreaming === true} onCheckedChange={(value) => config('supportsStreaming', value)} />
    </div>
  );
}

export type RagKnowledgeSelectionMode = 'empty' | 'all' | 'partial';

export type RagKnowledgeSelection = {
  availableDocuments: KnowledgeBaseDocument[];
  scopedDocuments: KnowledgeBaseDocument[];
  selectedDocumentIds: string[];
  mode: RagKnowledgeSelectionMode;
  implicitAll: boolean;
};

function documentCollectionIds(document: KnowledgeBaseDocument) {
  return document.collectionIds?.length ? document.collectionIds : ['general'];
}

export function getRagKnowledgeSelection(
  documents: KnowledgeBaseDocument[],
  collectionIds: string[],
  documentIds: string[],
): RagKnowledgeSelection {
  const availableDocuments = documents.filter((document) => (
    document.status !== 'archived' && document.status !== 'expired'
  ));
  const scopedDocuments = availableDocuments.filter((document) => (
    collectionIds.length === 0
    || documentCollectionIds(document).some((collectionId) => collectionIds.includes(collectionId))
  ));
  const scopedIds = new Set(scopedDocuments.map((document) => document.id));
  const selectedDocumentIds = [...new Set(documentIds.filter((documentId) => scopedIds.has(documentId)))];
  const implicitAll = documentIds.length === 0;
  const mode: RagKnowledgeSelectionMode = scopedDocuments.length === 0
    ? 'empty'
    : implicitAll || selectedDocumentIds.length === scopedDocuments.length
      ? 'all'
      : 'partial';

  return { availableDocuments, scopedDocuments, selectedDocumentIds, mode, implicitAll };
}

export function RagInspector({
  node,
  onUpdate,
  knowledgeDocuments = [],
  knowledgeCollections = [],
  onManageKnowledge,
}: InspectorProps) {
  const { config, rename } = useNodeUpdater(node, onUpdate);
  const [documentQuery, setDocumentQuery] = useState('');
  const documentIds = Array.isArray(node.config.documentIds) ? node.config.documentIds.map(String) : [];
  const filters = node.config.filters && typeof node.config.filters === 'object' && !Array.isArray(node.config.filters)
    ? node.config.filters as Record<string, unknown>
    : {};
  const collectionIds = Array.isArray(filters.collectionIds) ? filters.collectionIds.map(String) : [];
  const selection = getRagKnowledgeSelection(knowledgeDocuments, collectionIds, documentIds);
  const normalizedDocumentQuery = documentQuery.trim().toLocaleLowerCase('pt-BR');
  const collectionById = new Map(knowledgeCollections.map((collection) => [collection.id, collection]));
  const visibleDocuments = selection.scopedDocuments.filter((document) => {
    if (!normalizedDocumentQuery) return true;
    const collectionNames = documentCollectionIds(document)
      .map((collectionId) => collectionById.get(collectionId)?.name || collectionId)
      .join(' ');
    return `${document.name} ${document.summary || ''} ${document.category || ''} ${(document.tags || []).join(' ')} ${collectionNames}`
      .toLocaleLowerCase('pt-BR')
      .includes(normalizedDocumentQuery);
  });
  const explicitlySelected = new Set(selection.selectedDocumentIds);
  const selectedCount = selection.implicitAll
    ? selection.scopedDocuments.length
    : selection.selectedDocumentIds.length;

  const updateCollections = (nextCollectionIds: string[]) => {
    const nextSelection = getRagKnowledgeSelection(knowledgeDocuments, nextCollectionIds, documentIds);
    onUpdate({
      ...node,
      config: {
        ...node.config,
        documentIds: nextSelection.selectedDocumentIds.length === 0 ? [] : nextSelection.selectedDocumentIds,
        filters: { ...filters, collectionIds: nextCollectionIds },
      },
    });
  };

  const toggleCollection = (collectionId: string) => {
    updateCollections(collectionIds.includes(collectionId)
      ? collectionIds.filter((id) => id !== collectionId)
      : [...collectionIds, collectionId]);
  };

  const toggleDocument = (documentId: string) => {
    if (selection.implicitAll) {
      config('documentIds', selection.scopedDocuments
        .map((document) => document.id)
        .filter((id) => id !== documentId));
      return;
    }

    const nextIds = explicitlySelected.has(documentId)
      ? selection.selectedDocumentIds.filter((id) => id !== documentId)
      : [...selection.selectedDocumentIds, documentId];
    if (nextIds.length === 0) return;
    config('documentIds', nextIds);
  };

  const selectAllDocuments = () => config('documentIds', selection.scopedDocuments.map((document) => document.id));
  const clearDocumentSelection = () => config('documentIds', []);

  const summaryTitle = selection.mode === 'empty'
    ? selection.availableDocuments.length === 0
      ? 'Base de conhecimento vazia'
      : 'Nenhum documento neste escopo'
    : selection.mode === 'all'
      ? `${selection.scopedDocuments.length} ${selection.scopedDocuments.length === 1 ? 'documento disponível' : 'documentos disponíveis'}`
      : `${selectedCount} de ${selection.scopedDocuments.length} documentos selecionados`;
  const summaryDescription = selection.mode === 'empty'
    ? selection.availableDocuments.length === 0
      ? 'Crie um texto ou importe arquivos para o agente ter informações confiáveis para consultar.'
      : 'As coleções escolhidas não possuem documentos utilizáveis. Selecione outras coleções ou adicione conteúdo.'
    : selection.mode === 'all'
      ? selection.implicitAll
        ? 'Todos os documentos deste escopo serão usados automaticamente.'
        : 'Todos os documentos deste escopo foram selecionados explicitamente.'
      : 'Somente os documentos marcados poderão ser consultados pelo agente.';

  return (
    <div className="space-y-5">
      <Field label="Nome da base"><Input value={node.name} onChange={(event) => rename(event.target.value)} aria-label="Nome da base de conhecimento" /></Field>

      <div
        role="status"
        aria-live="polite"
        className={cn(
          'rounded-xl border p-4',
          selection.mode === 'empty'
            ? 'border-amber-400/20 bg-amber-400/[0.06]'
            : selection.mode === 'all'
              ? 'border-emerald-400/20 bg-emerald-400/[0.06]'
              : 'border-sky-400/20 bg-sky-400/[0.06]',
        )}
      >
        <div className="flex items-start gap-3">
          <span className={cn(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            selection.mode === 'empty' ? 'bg-amber-400/10 text-amber-300' : 'bg-emerald-400/10 text-emerald-300',
          )}>
            {selection.mode === 'empty' ? <Database className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-100">{summaryTitle}</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">{summaryDescription}</span>
          </span>
        </div>
        {onManageKnowledge ? (
          <Button type="button" size="sm" variant="outline" className="mt-3 w-full" onClick={onManageKnowledge}>
            <Upload className="mr-2 h-3.5 w-3.5" />
            Criar ou importar documento
          </Button>
        ) : null}
      </div>

      <Field label="1. Escolha as coleções" description="Sem filtro, o agente consulta documentos de todas as coleções.">
        <div role="group" aria-label="Coleções disponíveis" className="grid gap-2">
          <button
            type="button"
            aria-pressed={collectionIds.length === 0}
            onClick={() => updateCollections([])}
            className={cn(
              'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
              collectionIds.length === 0
                ? 'border-sky-400/35 bg-sky-400/10 text-sky-100'
                : 'border-white/[0.08] bg-white/[0.025] text-slate-300 hover:border-sky-400/20',
            )}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">Todas as coleções</span>
              <span className="mt-0.5 block text-[11px] text-slate-500">Não limitar o escopo por coleção</span>
            </span>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] tabular-nums text-slate-400">{selection.availableDocuments.length}</span>
          </button>
          {knowledgeCollections.map((collection) => {
            const selected = collectionIds.includes(collection.id);
            const documentCount = selection.availableDocuments.filter((document) => (
              documentCollectionIds(document).includes(collection.id)
            )).length;
            return (
              <button
                key={collection.id}
                type="button"
                aria-pressed={selected}
                aria-label={`${collection.name}, ${documentCount} ${documentCount === 1 ? 'documento' : 'documentos'}`}
                onClick={() => toggleCollection(collection.id)}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                  selected
                    ? 'border-sky-400/35 bg-sky-400/10 text-sky-100'
                    : 'border-white/[0.08] bg-white/[0.025] text-slate-300 hover:border-sky-400/20',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{collection.name}</span>
                  {collection.description ? <span className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-slate-500">{collection.description}</span> : null}
                </span>
                <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] tabular-nums text-slate-400">{documentCount}</span>
              </button>
            );
          })}
          {knowledgeCollections.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/[0.08] px-3 py-2 text-[11px] leading-relaxed text-slate-500">
              Nenhuma coleção personalizada. Os documentos continuam disponíveis em “Todas as coleções”.
            </p>
          ) : null}
        </div>
      </Field>

      <Field
        label="2. Defina os documentos"
        description="Sem restrição explícita, todos os documentos do escopo ficam disponíveis. O agente sempre precisa ter ao menos um documento."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={selection.scopedDocuments.length === 0} onClick={selectAllDocuments}>
            Selecionar tudo
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={selection.implicitAll} onClick={clearDocumentSelection} title="Remove a restrição e volta a usar todos os documentos do escopo">
            Limpar seleção
          </Button>
          <span className="ml-auto text-[10px] tabular-nums text-slate-500">{selectedCount}/{selection.scopedDocuments.length}</span>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            value={documentQuery}
            onChange={(event) => setDocumentQuery(event.target.value)}
            placeholder="Buscar por nome, categoria, tag ou coleção"
            aria-label="Buscar documentos da base de conhecimento"
            className="pl-9 pr-9"
          />
          {documentQuery ? (
            <button
              type="button"
              aria-label="Limpar busca de documentos"
              title="Limpar busca"
              onClick={() => setDocumentQuery('')}
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div role="group" aria-label="Documentos disponíveis" className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-white/[0.07] p-2">
          {visibleDocuments.map((document) => {
            const selected = selection.implicitAll || explicitlySelected.has(document.id);
            const isLastExplicitSelection = !selection.implicitAll
              && explicitlySelected.has(document.id)
              && selection.selectedDocumentIds.length === 1;
            const isOnlyAvailableDocument = selection.implicitAll && selection.scopedDocuments.length === 1;
            const selectionLocked = isLastExplicitSelection || isOnlyAvailableDocument;
            const collectionNames = documentCollectionIds(document)
              .map((collectionId) => collectionById.get(collectionId)?.name || (collectionId === 'general' ? 'Geral' : collectionId));
            const metadata = [
              document.category,
              collectionNames.length > 0 ? collectionNames.join(', ') : null,
              document.tokens ? `${document.tokens} tokens` : null,
            ].filter(Boolean).join(' · ');
            return (
              <label
                key={document.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-2.5 transition-colors',
                  selectionLocked ? 'cursor-not-allowed opacity-75' : 'cursor-pointer',
                  selected ? 'border-sky-400/20 bg-sky-400/[0.06]' : 'border-transparent hover:bg-white/[0.04]',
                )}
              >
                <Checkbox
                  checked={selected}
                  disabled={selectionLocked}
                  aria-label={`Permitir consulta ao documento ${document.name}`}
                  title={selectionLocked ? 'O agente precisa manter ao menos um documento disponível neste escopo.' : undefined}
                  onCheckedChange={() => toggleDocument(document.id)}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="block truncate text-sm text-slate-200">{document.name}</span>
                    {document.status === 'draft' ? <span className="shrink-0 rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-300">Rascunho</span> : null}
                  </span>
                  {metadata ? <span className="mt-1 block truncate text-[10px] text-slate-500">{metadata}</span> : null}
                  {document.summary ? <span className="mt-1 block line-clamp-2 text-[10px] leading-relaxed text-slate-500">{document.summary}</span> : null}
                </span>
              </label>
            );
          })}

          {selection.scopedDocuments.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <Database className="mx-auto h-5 w-5 text-slate-600" />
              <p className="mt-2 text-xs font-medium text-slate-300">
                {selection.availableDocuments.length === 0 ? 'Nenhum documento cadastrado' : 'Nenhum documento nestas coleções'}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                {selection.availableDocuments.length === 0
                  ? 'Adicione conteúdo para habilitar consultas na base.'
                  : 'Volte para todas as coleções ou escolha outro escopo.'}
              </p>
              {selection.availableDocuments.length > 0 ? (
                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => updateCollections([])}>Usar todas as coleções</Button>
              ) : onManageKnowledge ? (
                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onManageKnowledge}><Plus className="mr-1.5 h-3.5 w-3.5" />Adicionar documento</Button>
              ) : null}
            </div>
          ) : visibleDocuments.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <Search className="mx-auto h-5 w-5 text-slate-600" />
              <p className="mt-2 text-xs font-medium text-slate-300">Nenhum resultado para “{documentQuery.trim()}”</p>
              <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setDocumentQuery('')}>Limpar busca</Button>
            </div>
          ) : null}
        </div>
        {selection.scopedDocuments.length === 1 ? <p className="text-xs leading-relaxed text-slate-400">Este é o único documento disponível no escopo e permanece ativo para evitar uma base vazia. Para trocá-lo, adicione outro documento ou escolha outra coleção.</p> : null}
      </Field>

      <details className="group rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-300 marker:content-none">
          <span className="flex items-center justify-between gap-3">
            Ajustes da busca
            <span className="text-[10px] font-normal text-slate-500 group-open:hidden">Opcional</span>
          </span>
        </summary>
        <div className="space-y-4 border-t border-white/[0.07] p-4">
          <Field label="Estratégia"><NativeSelect value={String(node.config.strategy || 'hybrid')} onChange={(value) => config('strategy', value)}><option value="hybrid">Híbrida</option><option value="semantic">Semântica</option><option value="keyword">Palavras-chave</option></NativeSelect></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Máx. documentos"><Input type="number" min={1} value={Number(node.config.maxDocuments || 6)} onChange={(event) => config('maxDocuments', Number(event.target.value))} /></Field><Field label="Score mínimo"><Input type="number" min={0} max={1} step={0.05} value={Number(node.config.minimumScore ?? 0.55)} onChange={(event) => config('minimumScore', Number(event.target.value))} /></Field></div>
          <Field label="Limite de tokens"><Input type="number" min={1} value={Number(node.config.tokenLimit || 6000)} onChange={(event) => config('tokenLimit', Number(event.target.value))} /></Field>
          <ToggleField label="Reordenar resultados" checked={node.config.rerank !== false} onCheckedChange={(value) => config('rerank', value)} description="Aplica reranking dentro do orçamento configurado." />
        </div>
      </details>
    </div>
  );
}

export function ToolInspector({ node }: InspectorProps) {
  const mcp = node.type === 'tool.mcp';
  const toolNameId = `tool-name-${node.id}`;
  const descriptionId = `tool-description-${node.id}`;
  const serverId = `tool-server-${node.id}`;
  const actionId = `tool-action-${node.id}`;
  const timeoutId = `tool-timeout-${node.id}`;
  return (
    <div className="space-y-5">
      <div role="status" className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] p-4">
        <p className="text-sm font-medium text-cyan-100">Preenchida automaticamente pelo catálogo</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-300">Nome, schemas, servidor, risco, timeout e confirmação são sincronizados com a integração ativa antes de testar ou publicar.</p>
      </div>
      <Field label="Nome da ferramenta" htmlFor={toolNameId}><Input id={toolNameId} value={String(node.config.displayName || node.name)} readOnly className="cursor-default opacity-80" /></Field>
      <Field label="Quando a IA pode usar" htmlFor={descriptionId}><Textarea id={descriptionId} value={String(node.config.description || '')} readOnly className="min-h-24 cursor-default opacity-80" /></Field>
      {mcp ? (
        <>
          <Field label="Servidor MCP" htmlFor={serverId}><Input id={serverId} value={String(node.config.serverName || node.config.serverId || '')} readOnly className="cursor-default opacity-80" /></Field>
          <Field label="Ações permitidas"><div className="flex flex-wrap gap-2">{(Array.isArray(node.config.allowedTools) ? node.config.allowedTools : []).map((tool) => <span key={String(tool)} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-200">{String(tool)}</span>)}</div></Field>
        </>
      ) : (
        <Field label="Ação interna" htmlFor={actionId}><Input id={actionId} value={String(node.config.action || node.config.name || '')} readOnly className="cursor-default opacity-80" /></Field>
      )}

      <section className="space-y-3" aria-labelledby={`tool-input-heading-${node.id}`}>
        <div>
          <Label id={`tool-input-heading-${node.id}`}>Informações que a ferramenta recebe</Label>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Dados que o agente precisa preencher antes de executar a ferramenta.</p>
        </div>
        <AdvancedJsonPreview label="Ver entrada técnica" value={node.config.inputSchema} />
      </section>

      <section className="space-y-3" aria-labelledby={`tool-output-heading-${node.id}`}>
        <div>
          <Label id={`tool-output-heading-${node.id}`}>Informações devolvidas pela ferramenta</Label>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Dados que ficarão disponíveis para os próximos blocos.</p>
        </div>
        <AdvancedJsonPreview label="Ver saída técnica" value={node.config.outputSchema} />
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tempo limite" htmlFor={timeoutId}><Input id={timeoutId} value={`${Number(node.config.timeoutMs || 20000).toLocaleString('pt-BR')} ms`} readOnly className="cursor-default opacity-80" /></Field>
        <Field label="Confirmação"><Input value={node.config.requiresConfirmation === true ? 'Obrigatória' : 'Não exigida'} readOnly className="cursor-default opacity-80" /></Field>
      </div>
    </div>
  );
}

export function GuardrailInspector({ node, onUpdate }: InspectorProps) {
  const { config, rename } = useNodeUpdater(node, onUpdate);
  return (
    <div className="space-y-5">
      <Field label="Nome do bloco"><Input value={node.name} onChange={(event) => rename(event.target.value)} /></Field>
      <Field label="Nome da política"><Input value={String(node.config.name || '')} onChange={(event) => config('name', event.target.value)} placeholder="Política de atendimento" /></Field>
      <StringListField label="Verificações" value={node.config.checks} onChange={(value) => config('checks', value)} description="Uma regra clara e auditável por linha." />
      <Field label="Ao detectar violação"><NativeSelect value={String(node.config.onViolation || 'route_to_error')} onChange={(value) => config('onViolation', value)}><option value="route_to_error">Seguir rota de erro</option><option value="block">Bloquear</option><option value="redact">Ocultar conteúdo sensível</option></NativeSelect></Field>
    </div>
  );
}

export function NativeSpecializedNodeInspector(props: InspectorProps) {
  switch (props.node.type) {
    case 'trigger.received_message':
    case 'trigger.manual': return <TriggerInspector {...props} />;
    case 'data.set': return <DataSetInspector {...props} />;
    case 'data.transform': return <DataTransformInspector {...props} />;
    case 'data.extract': return <DataExtractInspector {...props} />;
    case 'data.template': return <DataTemplateInspector {...props} />;
    case 'logic.if': return <LogicIfInspector {...props} />;
    case 'logic.switch': return <LogicSwitchInspector {...props} />;
    case 'logic.ai_router': return <AiRouterInspector {...props} />;
    case 'logic.goal_completion': return <GoalCompletionInspector {...props} />;
    case 'logic.wait': return <LogicWaitInspector {...props} />;
    case 'ai.model': return <ModelInspector {...props} />;
    case 'knowledge.rag_retriever': return <RagInspector {...props} />;
    case 'memory.session': return <MemorySessionInspector {...props} />;
    case 'tool.internal':
    case 'tool.mcp': return <ToolInspector {...props} />;
    case 'guardrail.policy': return <GuardrailInspector {...props} />;
    case 'output.respond': return <RespondInspector {...props} />;
    case 'output.handoff': return <HandoffInspector {...props} />;
    case 'output.close_conversation': return <CloseConversationInspector {...props} />;
    case 'output.end': return <EndInspector {...props} />;
    case 'error.handler': return <ErrorHandlerInspector {...props} />;
    default: return null;
  }
}
