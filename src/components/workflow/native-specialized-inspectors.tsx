'use client';

import { Children, Fragment, cloneElement, isValidElement, useEffect, useId, useState } from 'react';
import { CheckCircle2, Database, FileText, KeyRound, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { type AiModelCatalogEntry } from '@/lib/ai-models';
import type { WorkflowNode } from '@/services/workflow-runtime/types';

import type { KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import { SGP_IDENTIFICATION_MESSAGES, getSgpIdentificationMessage, type SgpIdentificationMessageKey } from '@/modules/nexus/services/sgp-identification-messages';
import { WorkflowJsonField } from './workflow-form-validation';
import { cn } from '@/lib/utils';
import { CrmOptionFields } from '@/modules/nexus/components/crm-option-fields';
import { GoogleAdsLeadFields } from '@/modules/nexus/components/google-ads-lead-fields';
import type { CrmOptionCondition } from '@/modules/nexus/services/crm-option-trigger';
import type { NativeAgentToolCatalogItem } from '@/services/workflow-runtime/native-agent-tools';
import { toolboxManifests } from '@/services/workflow-runtime/toolbox-catalog';
import { WorkflowToolboxInspector } from './workflow-toolbox-inspector';
import { CatalogEditor } from '@/components/chat/catalog-editor';
import type { WhatsappCatalog } from '@/lib/whatsapp/catalog';

const BUILTIN_AGENT_TOOL_TYPES = new Set([
  'tool.audio_transcribe', 'tool.browser', 'tool.calculator', 'tool.clock', 'tool.document_read', 'tool.document_write',
  'tool.image', 'tool.image_analysis', 'tool.read_url', 'tool.sandbox', 'tool.video_analysis', 'tool.web_search',
]);

export const SPECIALIZED_WORKFLOW_INSPECTOR_TYPES = new Set([
  ...toolboxManifests().map(manifest => manifest.type),
  ...BUILTIN_AGENT_TOOL_TYPES,
  'trigger.received_message',
  'trigger.webhook',
  'trigger.internal_event',
  'trigger.schedule',
  'trigger.manual',
  'interaction.input',
  'interaction.options',
  'interaction.date',
  'interaction.file',
  'interaction.rating',
  'data.set',
  'data.transform',
  'data.extract',
  'data.code',
  'data.log',
  'data.template',
  'logic.if',
  'logic.switch',
  'logic.ai_router',
  'logic.goal_completion',
  'logic.merge',
  'logic.loop',
  'logic.parallel',
  'logic.time_window',
  'logic.wait',
  'logic.subflow',
  'logic.goto',
  'integration.http_request',
  'integration.mcp_call',
  'integration.email',
  'integration.google_sheets_append',
  'integration.google_ads_lead',
  'integration.database',
  'dialogy.crm_update',
  'dialogy.team_availability',
  'dialogy.chat_tag',
  'dialogy.sgp_identify_customer',
  'dialogy.sgp_contract_status',
  'dialogy.sgp_second_copy',
  'dialogy.sgp_payment_promise',
  'whatsapp.send_text',
  'whatsapp.send_media',
  'whatsapp.send_catalog',
  'whatsapp.group_create',
  'ai.model',
  'ai.prompt',
  'knowledge.rag_retriever',
  'memory.session',
  'tool.http',
  'tool.subflow',
  'tool.database',
  'tool.internal',
  'tool.mcp',
  'guardrail.policy',
  'output.respond',
  'output.media',
  'output.redirect',
  'output.handoff',
  'output.close_conversation',
  'output.end',
  'error.handler',
]);

export function hasSpecializedWorkflowInspector(type: string) {
  return SPECIALIZED_WORKFLOW_INSPECTOR_TYPES.has(type);
}

type InspectorProps = {
  workspaceId?: string;
  node: WorkflowNode;
  onUpdate: (node: WorkflowNode) => void;
  editorMode?: 'essential' | 'advanced';
  modelOptions?: AiModelCatalogEntry[];
  knowledgeDocuments?: KnowledgeBaseDocument[];
  knowledgeCollections?: KnowledgeCollection[];
  onManageKnowledge?: () => void;
  onManageModels?: () => void;
  credentialOptions?: Array<{ id: string; name: string; type: string }>;
  onManageCredentials?: () => void;
  workflowNodeOptions?: Array<{ id: string; name: string; type: string }>;
  workflowOptions?: Array<{ id: string; label: string; description?: string }>;
  toolOptions?: NativeAgentToolCatalogItem[];
  teamOptions?: Array<{ id: string; label: string; description?: string }>;
  tagOptions?: Array<{ id: string; label: string; description?: string; isCloseReason?: boolean }>;
  memberOptions?: Array<{ id: string; label: string; description?: string }>;
  intelligentAgentOptions?: Array<{ id: string; label: string; description?: string }>;
  instanceOptions?: Array<{ id: string; label: string; description?: string }>;
};

function Field({ label, description, children, htmlFor }: { label: string; description?: string; children: React.ReactNode; htmlFor?: string }) {
  const generated = useId();
  const child = Children.count(children) === 1 && isValidElement<{ id?: string; 'aria-describedby'?: string }>(children) ? children : null;
  const id = htmlFor || child?.props.id || generated;
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;
  const control = child && child.type !== Fragment && !(typeof child.type === 'string' && !['input', 'select', 'textarea'].includes(child.type))
    ? cloneElement(child, { id, 'aria-describedby': [child.props['aria-describedby'], descriptionId].filter(Boolean).join(' ') || undefined }) : children;
  return <div className="space-y-2" role="group" aria-labelledby={labelId}>
    <Label id={labelId} htmlFor={id}>{label}</Label>
    {control}
    {description ? <p id={descriptionId} className="text-xs leading-relaxed text-[var(--wf-muted)]">{description}</p> : null}
  </div>;
}

function NativeSelect({ id, value, onChange, children, ariaLabel, disabled }: { id?: string; value: string; onChange: (value: string) => void; children: React.ReactNode; ariaLabel?: string; disabled?: boolean }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      disabled={disabled}
      className="flex h-10 w-full rounded-md border border-[var(--wf-border)] bg-slate-950 px-3 py-2 text-sm text-[var(--wf-text)] outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </select>
  );
}

function ResourceSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string; description?: string }>;
  placeholder: string;
}) {
  const currentIsKnown = !value || options.some((option) => option.id === value);
  return (
    <NativeSelect id={id} value={value} onChange={onChange}>
      <option value="">{placeholder}</option>
      {!currentIsKnown ? <option value={value}>Vínculo atual · {value}</option> : null}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}{option.description ? ` · ${option.description}` : ''}
        </option>
      ))}
    </NativeSelect>
  );
}

function MultiChoiceField({
  label,
  value,
  onChange,
  options,
  description,
}: {
  label: string;
  value: unknown;
  onChange: (value: string[]) => void;
  options: Array<{ id: string; label: string; description?: string }>;
  description?: string;
}) {
  const selected = Array.isArray(value) ? value.map(String) : [];
  const selectedSet = new Set(selected);
  const visibleOptions: Array<{ id: string; label: string; description?: string }> = [
    ...options,
    ...selected
      .filter((id) => !options.some((option) => option.id === id))
      .map((id) => ({ id, label: `Vínculo atual · ${id}` })),
  ];
  const toggle = (id: string, checked: boolean) => {
    const next = checked
      ? [...selected.filter((current) => current !== id), id]
      : selected.filter((current) => current !== id);
    onChange(next);
  };

  return (
    <Field label={label} description={description}>
      <div className="space-y-2 rounded-xl border border-[var(--wf-border)] bg-white/[0.02] p-3">
        {visibleOptions.length === 0 ? (
          <p className="text-xs text-[var(--wf-muted)]">Nenhuma opção configurada neste workspace.</p>
        ) : visibleOptions.map((option) => (
          <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.035]">
            <Checkbox
              checked={selectedSet.has(option.id)}
              onCheckedChange={(checked) => toggle(option.id, checked === true)}
            />
            <span className="min-w-0">
              <span className="block text-sm text-[var(--wf-text)]">{option.label}</span>
              {option.description ? <span className="mt-0.5 block text-xs text-[var(--wf-muted)]">{option.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </Field>
  );
}

function ToggleField({ label, checked, onCheckedChange, description }: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-[var(--wf-border)] bg-white/[0.025] p-3">
      <span>
        <span className="block text-sm text-[var(--wf-text)]">{label}</span>
        {description ? <span className="mt-1 block text-xs leading-relaxed text-[var(--wf-muted)]">{description}</span> : null}
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
          <div key={`guided-record-${index}`} className="space-y-2 rounded-xl border border-[var(--wf-border)] bg-white/[0.025] p-3">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor={keyId} className="text-xs text-[var(--wf-muted)]">{keyLabel}</Label>
                <Input
                  id={keyId}
                  value={entry.key}
                  onChange={(event) => patchEntry(index, { key: event.target.value })}
                  onBlur={() => commit(entries)}
                  placeholder="Ex.: nome_cliente"
                />
              </div>
              <div className="w-28 space-y-1.5">
                <Label htmlFor={kindId} className="text-xs text-[var(--wf-muted)]">Tipo</Label>
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
              <Label htmlFor={valueId} className="text-xs text-[var(--wf-muted)]">{valueLabel}</Label>
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
      {entries.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--wf-border)] p-3 text-xs text-[var(--wf-muted)]">{emptyMessage}</p> : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setEntries([...entries, { key: '', value: '', kind: 'text' }])}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />{addLabel}
      </Button>
      {Object.keys(parsed.preserved).length > 0 ? (
        <p className="text-xs leading-relaxed text-[var(--wf-muted)]">
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
          <div key={`guided-schema-${index}`} className="space-y-2 rounded-xl border border-[var(--wf-border)] bg-white/[0.025] p-3">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor={`${fieldId}-name`} className="text-xs text-[var(--wf-muted)]">Campo esperado</Label>
                <Input id={`${fieldId}-name`} value={field.name} onChange={(event) => patch(index, { name: event.target.value.trim().replace(/\s+/g, '_') })} placeholder="Ex.: email" />
              </div>
              <div className="w-28 space-y-1.5">
                <Label htmlFor={`${fieldId}-type`} className="text-xs text-[var(--wf-muted)]">Tipo</Label>
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
            <label className="flex items-center gap-2 text-xs text-[var(--wf-text)]">
              <Checkbox checked={field.required} onCheckedChange={(checked) => patch(index, { required: checked === true })} />
              Informação obrigatória
            </label>
          </div>
        );
      })}
      {fields.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--wf-border)] p-3 text-xs text-[var(--wf-muted)]">Adicione os dados que a IA deve encontrar no texto.</p> : null}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange(guidedFieldsToSchema([...fields, { name: '', type: 'string', description: '', required: false }], value))}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />Adicionar dado esperado
      </Button>
    </div>
  );
}

function AdvancedJsonPreview({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded-xl border border-[var(--wf-border)] bg-white/[0.02]">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-[var(--wf-text)] marker:content-none">
        {label}
      </summary>
      <div className="border-t border-[var(--wf-border)] p-4">
        <Textarea
          value={JSON.stringify(value || {}, null, 2)}
          readOnly
          aria-label={`${label}, somente leitura`}
          className="min-h-28 cursor-default font-mono text-xs text-[var(--wf-muted)]"
        />
        <p className="mt-2 text-xs leading-relaxed text-[var(--wf-muted)]">Informação técnica preservada automaticamente.</p>
      </div>
    </details>
  );
}

function useNodeUpdater(node: WorkflowNode, onUpdate: (node: WorkflowNode) => void) {
  const config = (key: string, value: unknown) => onUpdate({ ...node, config: { ...node.config, [key]: value } });
  const rename = (name: string) => onUpdate({ ...node, name });
  return { config, rename };
}

function TriggerInspector({ node, onUpdate, instanceOptions = [], editorMode = 'advanced' }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  if (node.type === 'trigger.received_message') {
    const matchMode = String(node.config.matchMode || 'all');
    const advancedMatchMode = !['all', 'any_keyword'].includes(matchMode);
    const keywords = Array.isArray(node.config.keywords) ? node.config.keywords.map(String).filter(Boolean) : [];
    const keywordThresholds = node.config.keywordThresholds && typeof node.config.keywordThresholds === 'object' && !Array.isArray(node.config.keywordThresholds)
      ? node.config.keywordThresholds as Record<string, unknown>
      : {};
    const updateKeywords = (nextKeywords: string[]) => onUpdate({
      ...node,
      config: {
        ...node.config,
        keywords: nextKeywords,
        keywordThresholds: Object.fromEntries(nextKeywords.map((keyword) => [keyword, Number(keywordThresholds[keyword] ?? 100)])),
      },
    });
    const updateKeywordThreshold = (keyword: string, value: number) => config('keywordThresholds', {
      ...keywordThresholds,
      [keyword]: Math.min(100, Math.max(0, Math.round(value))),
    });
    return <div className="space-y-4">
      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /><div><p className="text-sm font-medium text-[var(--wf-text)]">Roteamento nativo de mensagens</p><p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">Funciona em WhatsApp, Telegram, Instagram, Messenger e webchat. Se o fluxo estiver aguardando uma resposta, ela será retomada antes de avaliar novos fluxos.</p></div></div></div>
      <Field
        label="O que dispara este fluxo?"
        description={matchMode === 'all'
          ? 'Funciona como fallback: só inicia quando nenhum outro fluxo publicado da workspace corresponder a uma palavra ou frase específica.'
          : 'Gatilhos específicos são avaliados antes dos fluxos configurados para qualquer mensagem.'}
      ><NativeSelect value={matchMode} onChange={(value) => config('matchMode', value)}><option value="all">Qualquer mensagem recebida</option><option value="any_keyword">Palavras ou frases de gatilho</option>{editorMode === 'advanced' || advancedMatchMode ? <option value="all_keywords">Exigir todas as palavras ou frases</option> : null}{editorMode === 'advanced' || matchMode === 'regex' ? <option value="regex">Expressão regular avançada</option> : null}</NativeSelect></Field>
      {matchMode === 'any_keyword' || matchMode === 'all_keywords' ? <><StringListField label="Palavras ou frases de gatilho" value={node.config.keywords} onChange={updateKeywords} description="Uma por linha. Pode ser uma palavra (“boleto”) ou uma frase (“quero assinar internet”); a comparação ignora maiúsculas e acentos." />{editorMode === 'advanced' && keywords.length > 0 ? <div className="space-y-2 rounded-xl border border-[var(--wf-border)] bg-white/[0.02] p-4"><div><Label>Compatibilidade mínima</Label><p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">100% exige todas as palavras da frase. Reduza somente quando quiser aceitar frases parciais ou pequenos erros.</p></div>{keywords.map((keyword) => <div key={keyword} className="grid grid-cols-[1fr_5.5rem] items-center gap-3"><span className="truncate text-xs text-[var(--wf-text)]" title={keyword}>{keyword}</span><Input aria-label={`Compatibilidade de ${keyword}`} type="number" min={0} max={100} value={Number(keywordThresholds[keyword] ?? 100)} onChange={(event) => updateKeywordThreshold(keyword, Number(event.target.value))} /></div>)}</div> : null}{node.config.keywordOutputPorts && editorMode === 'advanced' ? <p className="rounded-xl border border-violet-400/15 bg-violet-400/[0.04] p-3 text-xs leading-relaxed text-[var(--wf-muted)]">Este gatilho preserva saídas separadas por frase importadas do Nexus antigo.</p> : null}</> : null}
      {matchMode === 'regex' ? <><Field label="Expressão regular"><Input value={String(node.config.pattern || '')} onChange={(event) => config('pattern', event.target.value)} placeholder="^(quero|preciso) atendimento$" /></Field><ToggleField label="Diferenciar maiúsculas" checked={node.config.caseSensitive === true} onCheckedChange={(value) => config('caseSensitive', value)} /></> : null}
      <MultiChoiceField
        label="Canais permitidos"
        value={node.config.platforms}
        onChange={(value) => config('platforms', value)}
        options={[
          { id: 'whatsapp', label: 'WhatsApp' },
          { id: 'telegram', label: 'Telegram' },
          { id: 'instagram', label: 'Instagram' },
          { id: 'messenger', label: 'Messenger' },
          { id: 'webchat', label: 'Webchat' },
        ]}
        description="Sem seleção, o fluxo aceita qualquer canal conectado."
      />
      <MultiChoiceField
        label="Instâncias permitidas"
        value={node.config.instanceNames}
        onChange={(value) => config('instanceNames', value)}
        options={instanceOptions}
        description="A seleção limita apenas o canal da instância (WhatsApp ou Telegram). Os outros canais selecionados continuam ativos. Sem instância selecionada para um canal, aceita todas as dele."
      />
      <MultiChoiceField
        label="Tipos de mensagem"
        value={node.config.messageTypes}
        onChange={(value) => config('messageTypes', value)}
        options={[
          { id: 'text', label: 'Texto' },
          { id: 'image', label: 'Imagem' },
          { id: 'video', label: 'Vídeo' },
          { id: 'audio', label: 'Áudio' },
          { id: 'document', label: 'Documento' },
        ]}
      />
      <Field label="Regra de atribuição">
        <NativeSelect value={String(node.config.startPolicy || 'all')} onChange={(value) => config('startPolicy', value)}>
          <option value="all">Iniciar sempre que corresponder</option>
          <option value="unassigned_only">Somente atendimento sem responsável</option>
        </NativeSelect>
      </Field>
      <ToggleField label="Permitir que outros fluxos também iniciem" checked={node.config.continueMatching === true} onCheckedChange={(value) => config('continueMatching', value)} description="Por padrão, o primeiro fluxo compatível assume a mensagem para evitar respostas duplicadas." />
    </div>;
  }
  if (node.type === 'trigger.webhook') {
    return <div className="space-y-4"><div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Publique o fluxo e abra “Ajustes” para copiar a URL e gerar o token. O endpoint aceita Bearer ou X-Nexus-Key e nunca envia a credencial para os blocos.</div><Field label="Método HTTP"><NativeSelect value={String(node.config.method || 'POST')} onChange={(value) => config('method', value)}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => <option key={method} value={method}>{method}</option>)}</NativeSelect></Field><Field label="Autenticação"><NativeSelect value="token" onChange={() => undefined} disabled><option value="token">Token Nexus rotacionável</option></NativeSelect></Field></div>;
  }
  if (node.type === 'trigger.internal_event') {
    if (node.config.crmOption !== undefined) return <CrmOptionFields value={node.config.crmOption as CrmOptionCondition} onChange={(value) => config('crmOption', value)} />;
    return <div className="space-y-4"><div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Inicia uma versão publicada quando a Dialogy despachar o acontecimento indicado para este workspace. O payload do evento fica disponível como entrada do fluxo.</div><Field label="Nome do acontecimento" description="Use um nome estável em minúsculas, como chat.closed ou contact.updated."><Input value={String(node.config.eventName || '')} onChange={(event) => config('eventName', event.target.value.trim().toLowerCase().replace(/[^a-z0-9._:-]/g, '_'))} placeholder="chat.closed" /></Field></div>;
  }
  if (node.type === 'trigger.schedule') {
    return <div className="space-y-4"><div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">O worker registra cada minuto agendado antes de executar. Reinícios não duplicam disparos e a janela de recuperação busca agendamentos perdidos.</div><Field label="Expressão cron" description="Cinco campos: minuto, hora, dia, mês e dia da semana."><Input value={String(node.config.cron || '')} onChange={(event) => config('cron', event.target.value)} placeholder="0 9 * * 1-5" /></Field><Field label="Fuso horário"><Input value={String(node.config.timezone || 'America/Sao_Paulo')} onChange={(event) => config('timezone', event.target.value)} placeholder="America/Sao_Paulo" /></Field></div>;
  }
  return (
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4" role="status">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
        <div>
          <p className="text-sm font-medium text-[var(--wf-text)]">Pronto para usar</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">
            Este gatilho inicia o fluxo somente quando você executar a versão publicada manualmente ou abrir um teste.
          </p>
        </div>
      </div>
    </div>
  );
}

function GuidedTimeoutField({ value, onChange }: { value: unknown; onChange: (value: number) => void }) {
  const duration = timeoutMsToGuidedDuration(value);
  return <div className="grid grid-cols-[1fr_9rem] gap-3"><Field label="Tempo para responder"><Input type="number" min={1} value={duration.value} onChange={(event) => onChange(guidedDurationToMs(Number(event.target.value), duration.unit))} /></Field><Field label="Unidade"><NativeSelect value={duration.unit} onChange={(unit) => onChange(guidedDurationToMs(duration.value, unit as 'minutes' | 'hours' | 'days'))}><option value="minutes">Minutos</option><option value="hours">Horas</option><option value="days">Dias</option></NativeSelect></Field></div>;
}

function InteractionInputInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const validation = String(node.config.validation || 'none');
  return <div className="space-y-4"><Field label="Pergunta"><Textarea value={String(node.config.prompt || '')} onChange={(event) => config('prompt', event.target.value)} rows={5} placeholder="Qual informação você deseja informar?" /></Field><Field label="Salvar resposta em" description="Nome da variável usada pelos próximos blocos."><Input value={String(node.config.outputKey || 'answer')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field><Field label="Validação"><NativeSelect value={validation} onChange={(value) => config('validation', value)}><option value="none">Texto livre</option><option value="email">E-mail</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="phone">Telefone</option><option value="number">Número</option><option value="date">Data</option><option value="custom_regex">Expressão regular</option></NativeSelect></Field>{validation === 'custom_regex' ? <Field label="Expressão regular"><Input value={String(node.config.customRegex || '')} onChange={(event) => config('customRegex', event.target.value)} placeholder="^[A-Z]{2}-\\d{4}$" /></Field> : null}<GuidedTimeoutField value={node.config.timeoutMs} onChange={(value) => config('timeoutMs', value)} /><div className="rounded-xl border border-[var(--wf-border)] p-3 text-xs leading-relaxed text-[var(--wf-muted)]">Quando a resposta não for válida, a pergunta é repetida automaticamente. Ative o caminho de erro personalizado somente se quiser controlar esse caso manualmente.</div></div>;
}

function InteractionDateInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><Field label="Pergunta"><Textarea value={String(node.config.prompt || '')} onChange={(event) => config('prompt', event.target.value)} rows={4} /></Field><Field label="Salvar data em"><Input value={String(node.config.outputKey || 'date')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field><GuidedTimeoutField value={node.config.timeoutMs} onChange={(value) => config('timeoutMs', value)} /><p className="rounded-xl border border-[var(--wf-border)] p-3 text-xs text-[var(--wf-muted)]">Aceita datas em DD/MM/AAAA ou AAAA-MM-DD.</p></div>;
}

function InteractionFileInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><Field label="Pedido de arquivo"><Textarea value={String(node.config.prompt || '')} onChange={(event) => config('prompt', event.target.value)} rows={4} /></Field><Field label="Tipos aceitos" description="Use MIME types separados por vírgula, como image/*,application/pdf. *\/* aceita qualquer arquivo."><Input value={String(node.config.accept || '*/*')} onChange={(event) => config('accept', event.target.value)} /></Field><Field label="Tamanho máximo (MB)"><Input type="number" min={1} max={100} value={Number(node.config.maxFileSizeMb || 10)} onChange={(event) => config('maxFileSizeMb', Math.max(1, Math.min(100, Number(event.target.value))))} /></Field><Field label="Salvar arquivo em"><Input value={String(node.config.outputKey || 'file')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field><GuidedTimeoutField value={node.config.timeoutMs} onChange={(value) => config('timeoutMs', value)} /></div>;
}

function InteractionRatingInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const minimum = Number(node.config.minimum || 1);
  const maximum = Number(node.config.maximum || 5);
  return <div className="space-y-4"><Field label="Pergunta"><Textarea value={String(node.config.prompt || '')} onChange={(event) => config('prompt', event.target.value)} rows={4} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Nota mínima"><Input type="number" min={0} max={maximum} value={minimum} onChange={(event) => config('minimum', Math.min(Number(event.target.value), maximum))} /></Field><Field label="Nota máxima"><Input type="number" min={minimum} max={10} value={maximum} onChange={(event) => config('maximum', Math.max(minimum, Math.min(10, Number(event.target.value))))} /></Field></div><Field label="Apresentação"><NativeSelect value={String(node.config.icon || 'star')} onChange={(value) => config('icon', value)}><option value="star">Estrelas</option><option value="number">Números</option><option value="emoji">Emojis</option></NativeSelect></Field><Field label="Salvar avaliação em"><Input value={String(node.config.outputKey || 'rating')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field><GuidedTimeoutField value={node.config.timeoutMs} onChange={(value) => config('timeoutMs', value)} /></div>;
}

function DataSetInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return (
    <div className="space-y-4">
      <div>
        <Label>Informações que serão criadas</Label>
        <p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">Defina um nome e um valor. Você pode usar variáveis como {'{{current.nome}}'}.</p>
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
  const mode = String(node.config.mode || (node.config.expression ? 'jsonata' : 'mapping'));
  return (
    <div className="space-y-4">
      <Field label="Forma de transformação">
        <NativeSelect value={mode} onChange={(value) => config('mode', value)}>
          <option value="mapping">Mapeamento guiado</option>
          <option value="jsonata">Expressão JSONata</option>
        </NativeSelect>
      </Field>
      {mode === 'jsonata' ? (
        <>
          <div className="rounded-xl border border-violet-400/20 bg-violet-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">JSONata é executado no servidor com limites de tempo, pilha, sequência e tamanho. Funções externas não são expostas.</div>
          <Field label="JSON de entrada" description={'Aceita JSON literal ou uma variável exata, como {{variables.pedido}}. Vazio usa a entrada atual do bloco.'}>
            <Textarea value={String(node.config.source || '')} onChange={(event) => config('source', event.target.value)} rows={4} className="font-mono text-xs" placeholder={'{"pedidos": {{variables.pedidos}}}'} />
          </Field>
          <Field label="Expressão JSONata">
            <Textarea value={String(node.config.expression || '')} onChange={(event) => config('expression', event.target.value)} rows={5} className="font-mono text-xs" placeholder="$sum(pedidos.preco)" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'result')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field>
            <Field label="Limite de execução (ms)"><Input type="number" min={25} max={2000} value={Number(node.config.evaluationTimeoutMs || 250)} onChange={(event) => config('evaluationTimeoutMs', Number(event.target.value))} /></Field>
          </div>
        </>
      ) : (
        <>
          <div>
            <Label>Resultado da transformação</Label>
            <p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">Para cada campo de saída, informe o texto ou variável que deve preencher seu valor.</p>
          </div>
          <GuidedRecordEditor
            value={node.config.mappings}
            onChange={(value) => config('mappings', value)}
            keyLabel="Campo de saída"
            valueLabel="Origem ou valor"
            addLabel="Adicionar mapeamento"
            emptyMessage="Nenhum mapeamento configurado."
          />
          <Field label="Salvar objeto em"><Input value={String(node.config.outputKey || 'result')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field>
        </>
      )}
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
        <p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">Adicione os campos esperados sem precisar escrever um schema JSON.</p>
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

function DataCodeInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const timeoutMs = Number(node.timeoutMs || node.config.timeoutMs || 2_000);
  return <div className="space-y-4"><div className="rounded-xl border border-[var(--wf-border)] bg-slate-400/[0.045] p-4 text-xs leading-relaxed text-[var(--wf-text)]">JavaScript síncrono executado em isolamento, sem rede, arquivos, importações, eval ou WebAssembly. Use <code>input</code>, <code>variables</code> e <code>context</code>; devolva um objeto com <code>return</code>.</div><Field label="Linguagem"><NativeSelect value="javascript" onChange={() => undefined} disabled><option value="javascript">JavaScript isolado</option></NativeSelect></Field><Field label="Código"><Textarea value={String(node.config.source || '')} onChange={(event) => config('source', event.target.value)} rows={12} className="font-mono text-xs" placeholder={'return { nome: input.nome };'} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'result')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field><Field label="Timeout (ms)"><Input type="number" min={10} max={5000} value={timeoutMs} onChange={(event) => onUpdate({ ...node, timeoutMs: Math.max(10, Math.min(5000, Number(event.target.value))) })} /></Field></div><details className="rounded-xl border border-[var(--wf-border)] bg-white/[0.02] p-3"><summary className="cursor-pointer text-xs font-medium text-[var(--wf-text)]">Contratos de entrada e saída</summary><div className="mt-4 space-y-4"><div><Label>Entrada esperada</Label><div className="mt-2"><GuidedSchemaEditor value={node.config.inputSchema} onChange={(value) => config('inputSchema', value)} /></div></div><div><Label>Saída esperada</Label><div className="mt-2"><GuidedSchemaEditor value={node.config.outputSchema} onChange={(value) => config('outputSchema', value)} /></div></div></div></details></div>;
}

function DataLogInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><div className="rounded-xl border border-[var(--wf-border)] bg-slate-400/[0.045] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Registra a mensagem na trilha auditável da execução. Não envia conteúdo ao cliente.</div><Field label="Nível"><NativeSelect value={String(node.config.level || 'info')} onChange={(value) => config('level', value)}><option value="info">Informação</option><option value="warn">Aviso</option><option value="error">Erro</option></NativeSelect></Field><Field label="Mensagem"><Textarea value={String(node.config.message || '{{current}}')} onChange={(event) => config('message', event.target.value)} rows={5} placeholder="Pedido {{current.id}} processado" /></Field></div>;
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
  { value: 'is_true', label: 'É verdadeiro' },
  { value: 'is_false', label: 'É falso' },
  { value: 'date_after', label: 'Data posterior a' },
  { value: 'date_before', label: 'Data anterior a' },
] as const;

const CONDITION_DATA_TYPES = [
  { value: 'auto', label: 'Detectar automaticamente' },
  { value: 'string', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'boolean', label: 'Verdadeiro ou falso' },
  { value: 'date', label: 'Data e hora' },
] as const;

function LogicIfInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const leftId = `if-left-${node.id}`;
  const operatorId = `if-operator-${node.id}`;
  const dataTypeId = `if-data-type-${node.id}`;
  const rightId = `if-right-${node.id}`;
  const operator = String(node.config.operator || 'equals');
  const unary = ['exists', 'not_exists', 'is_true', 'is_false'].includes(operator);
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
      <Field label="Tipo da informação" htmlFor={dataTypeId} description="Use um tipo explícito quando texto, número, booleano ou data precisarem ser comparados sem ambiguidade.">
        <NativeSelect id={dataTypeId} value={String(node.config.dataType || 'auto')} onChange={(value) => config('dataType', value)}>
          {CONDITION_DATA_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </NativeSelect>
      </Field>
      {!unary ? (
        <Field label="Valor esperado" htmlFor={rightId}>
          <Input id={rightId} value={String(node.config.right ?? '')} onChange={(event) => config('right', event.target.value)} placeholder="Ex.: aprovado" />
        </Field>
      ) : null}
      <p className="rounded-lg border border-[var(--wf-border)] bg-white/[0.025] p-3 text-xs leading-relaxed text-[var(--wf-muted)]">
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
          <div><Label>Caminhos possíveis</Label><p className="mt-1 text-xs text-[var(--wf-muted)]">Cada caminho vira uma saída conectável no bloco.</p></div>
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
        {cases.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--wf-border)] p-3 text-xs text-[var(--wf-muted)]">Adicione ao menos um caminho. Valores sem correspondência seguirão por “Padrão”.</p> : null}
      </div>
    </div>
  );
}

type InteractionOption = { id: string; value: string; label: string };

function readInteractionOptions(value: unknown): InteractionOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).map((item, index) => ({
    id: String(item.id || `option_${index + 1}`),
    value: String(item.value || ''),
    label: String(item.label || ''),
  }));
}

function InteractionOptionsInspector({ node, onUpdate, editorMode = 'advanced' }: InspectorProps) {
  const options = readInteractionOptions(node.config.options);
  const updateOptions = (nextOptions: InteractionOption[]) => {
    const reserved = node.outputPorts.filter((port) => ['default', 'expired', 'error'].includes(port.id));
    const dynamic = nextOptions.map((option, index) => ({
      id: option.id,
      label: option.value.trim() || option.label.trim() || `Opção ${index + 1}`,
      direction: 'output' as const,
      connectionType: 'main' as const,
      required: true,
      multiple: false,
    }));
    onUpdate({ ...node, config: { ...node.config, options: nextOptions }, outputPorts: [...dynamic, ...reserved] });
  };
  const patchOption = (index: number, patch: Partial<InteractionOption>) => updateOptions(
    options.map((option, optionIndex) => optionIndex === index ? { ...option, ...patch } : option),
  );
  const addOption = () => {
    let suffix = options.length + 1;
    while (options.some((option) => option.id === `option_${suffix}`)) suffix += 1;
    updateOptions([...options, { id: `option_${suffix}`, value: '', label: '' }]);
  };
  const { config } = useNodeUpdater(node, onUpdate);
  return (
    <div className="space-y-5">
      <Field label="Pergunta"><Textarea value={String(node.config.prompt || '')} onChange={(event) => config('prompt', event.target.value)} className="min-h-28" placeholder="Escolha uma opção:" /></Field>
      <Field label="Formato no canal"><NativeSelect value={String(node.config.deliveryMode || 'list')} onChange={(value) => config('deliveryMode', value)}><option value="list">Lista interativa</option><option value="buttons">Botões</option><option value="text">Texto numerado</option></NativeSelect></Field>
      <Field label="Rodapé"><Input value={String(node.config.footer || '')} onChange={(event) => config('footer', event.target.value)} placeholder="Opcional" /></Field>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3"><div><Label>Opções</Label><p className="mt-1 text-xs text-[var(--wf-muted)]">Cada opção cria uma saída no bloco.</p></div><Button type="button" size="sm" variant="outline" onClick={addOption}><Plus className="mr-1 h-3.5 w-3.5" />Opção</Button></div>
        {options.map((option, index) => <div key={option.id} className="space-y-2 rounded-xl border border-violet-400/15 bg-violet-400/[0.035] p-3"><div className="flex items-end gap-2"><Field label="Valor"><Input value={option.value} onChange={(event) => patchOption(index, { value: event.target.value })} placeholder={`Opção ${index + 1}`} /></Field><Button type="button" size="icon" variant="ghost" aria-label={`Excluir opção ${index + 1}`} onClick={() => updateOptions(options.filter((_, optionIndex) => optionIndex !== index))}><Trash2 className="h-4 w-4 text-red-300" /></Button></div><Field label="Texto complementar"><Input value={option.label} onChange={(event) => patchOption(index, { label: event.target.value })} placeholder="Opcional" /></Field></div>)}
        {options.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--wf-border)] p-3 text-xs text-[var(--wf-muted)]">Adicione ao menos uma opção.</p> : null}
      </div>
      <Field label="Salvar escolha em"><Input value={String(node.config.outputKey || 'choice')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} placeholder="choice" /></Field>
      {editorMode === 'advanced' ? (
        <><div className="space-y-4 rounded-xl border border-[var(--wf-border)] bg-white/[0.02] p-4">
          <ToggleField
            label="Controlar resposta não reconhecida manualmente"
            checked={node.config.customFallbackRoutes === true}
            onCheckedChange={(value) => config('customFallbackRoutes', value)}
            description="Quando desligado, a Dialogy avisa e apresenta as opções novamente. Ao habilitar, as rotas “Não reconhecida” e “Expirado” aparecem no bloco para você conectá-las."
          />
          {node.config.customFallbackRoutes !== true ? (
            <Field label="Aviso automático"><Input value={String(node.config.invalidOptionMessage || 'Não reconheci essa opção. Escolha uma das opções abaixo.')} onChange={(event) => config('invalidOptionMessage', event.target.value)} /></Field>
          ) : null}
        </div><div className="space-y-4 rounded-xl border border-amber-400/15 bg-amber-400/[0.035] p-4"><ToggleField label="Reconhecimento inteligente" checked={node.config.intelligentMatching === true} onCheckedChange={(value) => config('intelligentMatching', value)} description="Depois das regras por número e texto, usa o modelo nativo da Dialogy para entender respostas livres. Respostas ambíguas continuam no aviso automático." />{node.config.intelligentMatching === true ? <Field label="Confiança mínima"><Input type="number" min={0.5} max={1} step={0.05} value={Number(node.config.intelligentMinimumConfidence ?? 0.65)} onChange={(event) => config('intelligentMinimumConfidence', Math.min(1, Math.max(0.5, Number(event.target.value))))} /></Field> : null}</div></>
      ) : (
        <p className="rounded-xl border border-violet-400/15 bg-violet-400/[0.04] p-3 text-xs leading-relaxed text-[var(--wf-muted)]">Se a resposta não corresponder a uma opção, a Dialogy avisa e apresenta este menu novamente automaticamente.</p>
      )}
    </div>
  );
}

function HttpRequestInspector({ node, onUpdate, credentialOptions = [], onManageCredentials }: InspectorProps) {
  const { config } = useNodeUpdater(node, next => onUpdate({ ...next, config: { permissionScope: 'integrations:http', ...next.config } }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-[7rem_1fr] gap-3"><Field label="Método"><NativeSelect value={String(node.config.method || 'GET')} onChange={(value) => config('method', value)}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((method) => <option key={method} value={method}>{method}</option>)}</NativeSelect></Field><Field label="URL HTTPS"><Input value={String(node.config.url || '')} onChange={(event) => config('url', event.target.value)} placeholder="https://api.exemplo.com/{{variables.id}}" /></Field></div>
      <Field label="Credencial protegida" description="O fluxo guarda somente a referência; o segredo nunca entra na definição."><NativeSelect value={String(node.config.credentialId || '')} onChange={(value) => config('credentialId', value)}><option value="">Sem autenticação</option>{credentialOptions.filter((credential) => ['bearer', 'api_key', 'basic', 'oauth2'].includes(credential.type)).map((credential) => <option key={credential.id} value={credential.id}>{credential.name} · {credential.type}</option>)}</NativeSelect>{onManageCredentials ? <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onManageCredentials}><KeyRound className="mr-1.5 h-3.5 w-3.5" />Gerenciar credenciais</Button> : null}</Field>
      <ToggleField label="Exigir aprovação antes da chamada" checked={node.config.approvalPolicy === 'required' || node.config.requiresConfirmation === true} onCheckedChange={value => config('approvalPolicy', value || node.config.requiresConfirmation === true ? 'required' : 'automatic')} description="Um responsável revisará os argumentos antes da requisição. Confirmações obrigatórias são preservadas." />
      <Field label="Headers"><GuidedRecordEditor value={node.config.headers} onChange={(value) => config('headers', value)} keyLabel="Header" valueLabel="Valor" addLabel="Adicionar header" emptyMessage="Nenhum header adicional." /></Field>
      <Field label="Query params"><GuidedRecordEditor value={node.config.query} onChange={(value) => config('query', value)} keyLabel="Parâmetro" valueLabel="Valor" addLabel="Adicionar parâmetro" emptyMessage="Nenhum query param." /></Field>
      {!['GET', 'HEAD'].includes(String(node.config.method || 'GET')) ? <><Field label="Tipo de corpo"><NativeSelect value={String(node.config.bodyType || 'none')} onChange={(value) => config('bodyType', value)}><option value="none">Sem corpo</option><option value="json">JSON</option><option value="raw">Texto bruto</option><option value="form-data">Form-data</option><option value="binary">Arquivo privado</option><option value="urlencoded">Form URL encoded</option></NativeSelect></Field>{node.config.bodyType === 'json' || node.config.bodyType === 'form-data' ? <div><Label>Campos do corpo</Label><div className="mt-2"><GuidedRecordEditor value={node.config.body} onChange={(value) => config('body', value)} keyLabel="Campo" valueLabel="Valor" addLabel="Adicionar campo" emptyMessage="Nenhum campo." /></div></div> : <Field label="Corpo"><Textarea value={typeof node.config.body === 'string' ? node.config.body : JSON.stringify(node.config.body || {}, null, 2)} onChange={(event) => config('body', event.target.value)} className="min-h-28 font-mono text-xs" /></Field>}</> : null}
      <Field label="Formato da resposta"><NativeSelect value={String(node.config.responseFormat || 'auto')} onChange={value => config('responseFormat', value)}><option value="auto">Detectar automaticamente</option><option value="json">JSON</option><option value="text">Texto</option><option value="file">Arquivo privado</option></NativeSelect></Field>
      {node.config.responseFormat === 'file' && <Field label="Nome do arquivo"><Input value={String(node.config.fileName || 'resposta.bin')} onChange={e => config('fileName', e.target.value)} /></Field>}
      <HttpPaginationFields node={node} onUpdate={onUpdate} />
      <div className="grid grid-cols-2 gap-3"><Field label="Salvar resposta em"><Input value={String(node.config.outputKey || 'response')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field><Field label="Caminho na resposta"><Input value={String(node.config.responsePath || '')} onChange={(event) => config('responsePath', event.target.value)} placeholder="data.items" /></Field></div>
      <details className="rounded-xl border border-[var(--wf-border)] bg-white/[0.02]"><summary className="cursor-pointer px-4 py-3 text-sm text-[var(--wf-text)]">Limites</summary><div className="grid grid-cols-2 gap-3 border-t border-[var(--wf-border)] p-4"><Field label="Timeout (ms)"><Input type="number" min={100} max={120000} value={Number(node.config.timeoutMs || 15000)} onChange={(event) => config('timeoutMs', Number(event.target.value))} /></Field><Field label="Resposta máxima"><Input type="number" min={1024} max={10000000} value={Number(node.config.maxResponseBytes || 1000000)} onChange={(event) => config('maxResponseBytes', Number(event.target.value))} /></Field></div></details>
    </div>
  );
}

function HttpPaginationFields({ node, onUpdate }: InspectorProps) {
  const value = node.config.pagination && typeof node.config.pagination === 'object' ? node.config.pagination as Record<string, unknown> : {};
  const change = (key: string, next: unknown) => onUpdate({ ...node, config: { ...node.config, pagination: { ...value, [key]: next } } });
  return <details className="rounded-xl border border-[var(--wf-border)] p-3"><summary className="cursor-pointer text-sm">Paginação</summary><div className="mt-3 space-y-3"><Field label="Modo"><NativeSelect value={String(value.mode || 'none')} onChange={mode => change('mode', mode)}><option value="none">Uma requisição</option><option value="page">Número da página</option><option value="cursor">Cursor de continuação</option></NativeSelect></Field>{Boolean(value.mode) && value.mode !== 'none' && <>{[['parameter','Parâmetro de página/cursor'],['itemsPath','Caminho da lista na resposta'],...(value.mode === 'cursor' ? [['nextCursorPath','Caminho do próximo cursor']] : [])].map(([key,label]) => <Field key={key} label={label}><Input value={String(value[key] || '')} onChange={e => change(key,e.target.value)} /></Field>)}{[['maxPages','Máximo de páginas',10],['maxItems','Máximo de itens',1000],['timeoutMs','Prazo total (ms)',60000]].map(([key,label,fallback]) => <Field key={String(key)} label={String(label)}><Input type="number" value={Number(value[String(key)] || fallback)} onChange={e => change(String(key),Number(e.target.value))} /></Field>)}</>}</div></details>;
}

function McpCallInspector({ node, onUpdate, toolOptions = [] }: InspectorProps) {
  const mcpTools = toolOptions.filter((tool) => tool.source === 'mcp');
  const { config } = useNodeUpdater(node, onUpdate);
  const selectTool = (toolName: string) => {
    const tool = mcpTools.find((candidate) => candidate.name === toolName);
    if (!tool) {
      config('toolName', toolName);
      return;
    }
    const requiresConfirmation = tool.requiresHumanApproval === true || tool.riskLevel !== 'low';
    onUpdate({
      ...node,
      name: tool.displayName || tool.name,
      config: {
        ...node.config,
        toolName: tool.name,
        serverId: tool.serverId || '',
        serverName: tool.serverName || '',
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        outputSchema: tool.outputSchema || { type: 'object', additionalProperties: true },
        riskLevel: tool.riskLevel,
        requiresConfirmation,
        confirmationPath: requiresConfirmation ? node.config.confirmationPath || '' : '',
        timeoutMs: tool.timeoutMs || 30_000,
      },
    });
  };
  return <div className="space-y-4">
    <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] p-3 text-xs leading-relaxed text-[var(--wf-text)]">A ferramenta é executada pelo cliente MCP nativo da Dialogy. Servidor, schema e risco vêm da sincronização do workspace.</div>
    <Field label="Ferramenta MCP"><NativeSelect value={String(node.config.toolName || '')} onChange={selectTool}><option value="">Selecione uma ferramenta</option>{mcpTools.map((tool) => <option key={tool.name} value={tool.name}>{tool.displayName || tool.name}{tool.serverName ? ` · ${tool.serverName}` : ''}</option>)}</NativeSelect></Field>
    <Field label="Argumentos" description="Objeto JSON; use variáveis como {{variables.customerId}}."><WorkflowJsonField fieldKey={`${node.id}:arguments`} value={node.config.arguments || {}} onValueChange={(value) => config('arguments', value)} rows={7} className="font-mono text-xs" /></Field>
    {node.config.requiresConfirmation === true ? <Field label="Caminho da confirmação" description="Precisa apontar para um booleano true produzido por uma etapa explícita, por exemplo variables.confirmado."><Input value={String(node.config.confirmationPath || '')} onChange={(event) => config('confirmationPath', event.target.value.trim())} placeholder="variables.confirmado" /></Field> : null}
    <Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'mcpResult')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field>
    <AdvancedJsonPreview label="Contrato sincronizado" value={{ server: node.config.serverName || node.config.serverId, riskLevel: node.config.riskLevel, inputSchema: node.config.inputSchema, outputSchema: node.config.outputSchema }} />
  </div>;
}

function CredentialField({ node, onUpdate, credentialOptions = [], onManageCredentials, types }: InspectorProps & { types: string[] }) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <Field label="Credencial protegida" description="O segredo fica cifrado no workspace e não entra no fluxo."><NativeSelect value={String(node.config.credentialId || '')} onChange={(value) => config('credentialId', value)}><option value="">Selecione uma credencial</option>{credentialOptions.filter((credential) => types.includes(credential.type)).map((credential) => <option key={credential.id} value={credential.id}>{credential.name}</option>)}</NativeSelect>{onManageCredentials ? <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onManageCredentials}><KeyRound className="mr-1.5 h-3.5 w-3.5" />Gerenciar credenciais</Button> : null}</Field>;
}

function EmailInspector(props: InspectorProps) {
  const { node, onUpdate } = props;
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><CredentialField {...props} types={['smtp']} /><Field label="Para"><Input value={String(node.config.to || '')} onChange={(event) => config('to', event.target.value)} placeholder="cliente@exemplo.com ou {{variables.email}}" /></Field><Field label="Cc"><Input value={String(node.config.cc || '')} onChange={(event) => config('cc', event.target.value)} placeholder="Opcional" /></Field><Field label="Assunto"><Input value={String(node.config.subject || '')} onChange={(event) => config('subject', event.target.value)} /></Field><Field label="Texto"><Textarea value={String(node.config.text || '')} onChange={(event) => config('text', event.target.value)} rows={5} /></Field><Field label="HTML (opcional)"><Textarea value={String(node.config.html || '')} onChange={(event) => config('html', event.target.value)} rows={5} className="font-mono text-xs" /></Field><Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'email')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field></div>;
}

function SheetsInspector(props: InspectorProps) {
  const { node, onUpdate } = props;
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><CredentialField {...props} types={['google_oauth']} /><Field label="ID da planilha"><Input value={String(node.config.spreadsheetId || '')} onChange={(event) => config('spreadsheetId', event.target.value)} /></Field><Field label="Intervalo"><Input value={String(node.config.range || 'Sheet1!A:Z')} onChange={(event) => config('range', event.target.value)} /></Field><Field label="Valores da linha" description={'Use uma lista JSON, por exemplo ["{{variables.nome}}", "{{variables.email}}"].'}><WorkflowJsonField fieldKey={`${node.id}:values`} value={node.config.values || []} onValueChange={(value) => config('values', value)} rows={5} className="font-mono text-xs" /></Field><Field label="Interpretar valores como"><NativeSelect value={String(node.config.valueInputOption || 'USER_ENTERED')} onChange={(value) => config('valueInputOption', value)}><option value="USER_ENTERED">Como digitado por usuário</option><option value="RAW">Texto bruto</option></NativeSelect></Field><Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'sheetResult')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field></div>;
}

function DatabaseInspector(props: InspectorProps) {
  const { node, onUpdate } = props;
  const { config } = useNodeUpdater(node, onUpdate);
  const operation = String(node.config.operation || 'select');
  return <div className="space-y-4"><CredentialField {...props} types={['database']} /><div className="grid grid-cols-2 gap-3"><Field label="Operação"><NativeSelect value={operation} onChange={(value) => config('operation', value)}><option value="select">Consultar</option><option value="insert">Inserir</option><option value="update">Atualizar</option><option value="delete">Excluir</option></NativeSelect></Field><Field label="Tabela"><Input value={String(node.config.table || '')} onChange={(event) => config('table', event.target.value)} placeholder="public.clientes" /></Field></div>{operation === 'select' ? <StringListField label="Colunas" value={node.config.columns} onChange={(value) => config('columns', value.length ? value : ['*'])} description="Uma por linha. Use * para todas." /> : null}{operation === 'insert' || operation === 'update' ? <div><Label>Valores</Label><div className="mt-2"><GuidedRecordEditor value={node.config.values} onChange={(value) => config('values', value)} keyLabel="Coluna" valueLabel="Valor ou variável" addLabel="Adicionar coluna" emptyMessage="Adicione os valores da operação." /></div></div> : null}<Field label="Filtros declarativos" description="Lista JSON de { column, operator, value }. UPDATE e DELETE exigem filtro."><WorkflowJsonField fieldKey={`${node.id}:filters`} value={node.config.filters || []} onValueChange={(value) => config('filters', value)} rows={6} className="font-mono text-xs" /></Field>{operation !== 'select' ? <StringListField label="Colunas retornadas" value={node.config.returning} onChange={(value) => config('returning', value)} /> : <Field label="Limite"><Input type="number" min={1} max={1000} value={Number(node.config.limit || 100)} onChange={(event) => config('limit', Number(event.target.value))} /></Field>}<Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'databaseResult')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field></div>;
}

function DatabaseToolInspector(props: InspectorProps) {
  const { node, onUpdate } = props;
  const { config, rename } = useNodeUpdater(node, onUpdate);
  const operation = String(node.config.operation || 'select');
  return <div className="space-y-4"><div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Esta ferramenta fica anexada ao agente. A IA só pode operar a tabela e a operação declaradas aqui; SQL livre não é aceito.</div><Field label="Nome no canvas"><Input value={node.name} onChange={(event) => rename(event.target.value)} /></Field><Field label="Nome técnico da ferramenta"><Input value={String(node.config.name || '')} onChange={(event) => config('name', event.target.value.trim().replace(/[^a-zA-Z0-9_-]/g, '_'))} placeholder="consultar_clientes" /></Field><Field label="Quando a IA pode usar"><Textarea value={String(node.config.description || '')} onChange={(event) => config('description', event.target.value)} className="min-h-24" placeholder="Consulte esta ferramenta para..." /></Field><CredentialField {...props} types={['database']} /><div className="grid grid-cols-2 gap-3"><Field label="Operação"><NativeSelect value={operation} onChange={(value) => config('operation', value)}><option value="select">Consultar</option><option value="insert">Inserir</option><option value="update">Atualizar</option><option value="delete">Excluir</option></NativeSelect></Field><Field label="Tabela"><Input value={String(node.config.table || '')} onChange={(event) => config('table', event.target.value)} placeholder="public.clientes" /></Field></div>{operation === 'select' ? <StringListField label="Colunas permitidas" value={node.config.columns} onChange={(value) => config('columns', value.length ? value : ['*'])} /> : null}{['insert', 'update'].includes(operation) ? <div><Label>Valores fixos ou ligados aos argumentos</Label><p className="mt-1 text-xs text-[var(--wf-muted)]">Use valores como {'{{current.email}}'} para ligar um campo recebido da IA.</p><div className="mt-2"><GuidedRecordEditor value={node.config.values} onChange={(value) => config('values', value)} keyLabel="Coluna" valueLabel="Valor" addLabel="Adicionar coluna" emptyMessage="Nenhum valor fixo." /></div></div> : null}<Field label="Filtros fixos" description="Lista JSON de { column, operator, value }. Valores podem usar {{current.campo}}."><WorkflowJsonField fieldKey={`${node.id}:filters`} value={node.config.filters || []} onValueChange={(value) => config('filters', value)} rows={6} className="font-mono text-xs" /></Field><section className="space-y-3"><div><Label>Argumentos que a IA deve fornecer</Label><p className="mt-1 text-xs text-[var(--wf-muted)]">Defina somente os dados necessários para preencher valores e filtros configurados.</p></div><GuidedSchemaEditor value={node.config.inputSchema} onChange={(value) => config('inputSchema', value)} /></section><ToggleField label="Exigir confirmação antes de executar" checked={node.config.requiresConfirmation === true} onCheckedChange={(value) => config('requiresConfirmation', value)} description="Quando ligado, o runtime recusa execução automática até existir uma etapa de confirmação autorizada." /><div className="grid grid-cols-2 gap-3"><Field label="Timeout (ms)"><Input type="number" min={1000} max={120000} value={Number(node.config.timeoutMs || 30000)} onChange={(event) => config('timeoutMs', Number(event.target.value))} /></Field><Field label="Saída máxima (bytes)"><Input type="number" min={1024} max={5000000} value={Number(node.config.maxOutputBytes || 500000)} onChange={(event) => config('maxOutputBytes', Number(event.target.value))} /></Field></div></div>;
}

function HttpToolInspector(props: InspectorProps) {
  const { node, onUpdate } = props;
  const { config, rename } = useNodeUpdater(node, onUpdate);
  const method = String(node.config.method || 'GET').toUpperCase();
  const bodyType = String(node.config.bodyType || 'none');
  return <div className="space-y-4"><div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">A IA recebe somente os argumentos definidos abaixo. URL, método e autenticação ficam fixos no fluxo; redes privadas e HTTP sem TLS são bloqueados no servidor.</div><Field label="Nome no canvas"><Input value={node.name} onChange={(event) => rename(event.target.value)} /></Field><Field label="Nome técnico da ferramenta"><Input value={String(node.config.name || '')} onChange={(event) => config('name', event.target.value.trim().replace(/[^a-zA-Z0-9_-]/g, '_'))} placeholder="consultar_pedido" /></Field><Field label="Quando a IA pode usar"><Textarea value={String(node.config.description || '')} onChange={(event) => config('description', event.target.value)} className="min-h-24" placeholder="Consulte esta API quando..." /></Field><CredentialField {...props} types={['bearer', 'api_key', 'basic']} /><div className="grid grid-cols-[7rem_1fr] gap-3"><Field label="Método"><NativeSelect value={method} onChange={(value) => config('method', value)}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((value) => <option key={value} value={value}>{value}</option>)}</NativeSelect></Field><Field label="URL HTTPS"><Input value={String(node.config.url || '')} onChange={(event) => config('url', event.target.value)} placeholder="https://api.exemplo.com/pedidos/{{current.id}}" /></Field></div><Field label="Headers fixos ou ligados aos argumentos"><GuidedRecordEditor value={node.config.headers} onChange={(value) => config('headers', value)} keyLabel="Header" valueLabel="Valor" addLabel="Adicionar header" emptyMessage="Nenhum header adicional." /></Field><Field label="Query params"><GuidedRecordEditor value={node.config.query} onChange={(value) => config('query', value)} keyLabel="Parâmetro" valueLabel="Valor ou {{current.campo}}" addLabel="Adicionar parâmetro" emptyMessage="Nenhum query param." /></Field>{!['GET', 'HEAD'].includes(method) ? <><Field label="Tipo de corpo"><NativeSelect value={bodyType} onChange={(value) => config('bodyType', value)}><option value="none">Sem corpo</option><option value="json">JSON</option><option value="raw">Texto bruto</option><option value="form-data">Form-data</option><option value="binary">Arquivo privado</option><option value="urlencoded">Form URL encoded</option></NativeSelect></Field>{bodyType !== 'none' ? bodyType === 'json' || bodyType === 'form-data' ? <div><Label>Campos do corpo</Label><p className="mt-1 text-xs text-[var(--wf-muted)]">Use {'{{current.campo}}'} para inserir argumentos fornecidos pela IA.</p><div className="mt-2"><GuidedRecordEditor value={node.config.body} onChange={(value) => config('body', value)} keyLabel="Campo" valueLabel="Valor" addLabel="Adicionar campo" emptyMessage="Nenhum campo." /></div></div> : <Field label="Corpo"><Textarea value={String(node.config.body || '')} onChange={(event) => config('body', event.target.value)} rows={5} className="font-mono text-xs" /></Field> : null}</> : null}<Field label="Caminho do resultado" description="Opcional; a resposta completa continua registrada na auditoria."><Input value={String(node.config.responsePath || '')} onChange={(event) => config('responsePath', event.target.value)} placeholder="data.items" /></Field><section className="space-y-3"><div><Label>Argumentos que a IA deve fornecer</Label><p className="mt-1 text-xs text-[var(--wf-muted)]">Eles podem ser usados como {'{{current.nome}}'} na URL, query, headers e corpo.</p></div><GuidedSchemaEditor value={node.config.inputSchema} onChange={(value) => config('inputSchema', value)} /></section><ToggleField label="Exigir confirmação antes de executar" checked={node.config.requiresConfirmation === true} onCheckedChange={(value) => config('requiresConfirmation', value)} /><div className="grid grid-cols-2 gap-3"><Field label="Timeout (ms)"><Input type="number" min={1000} max={120000} value={Number(node.config.timeoutMs || 15000)} onChange={(event) => config('timeoutMs', Number(event.target.value))} /></Field><Field label="Resposta máxima"><Input type="number" min={1024} max={5000000} value={Number(node.config.maxResponseBytes || 1000000)} onChange={(event) => config('maxResponseBytes', Number(event.target.value))} /></Field></div></div>;
}

function CrmUpdateInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><div className="rounded-xl border border-violet-400/20 bg-violet-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Use name, email, phone ou address para campos padrão. Para campos personalizados, use o ID ou o rótulo cadastrado no CRM.</div><GuidedRecordEditor value={node.config.fields} onChange={(value) => config('fields', value)} keyLabel="Campo do CRM" valueLabel="Valor ou variável" addLabel="Adicionar campo" emptyMessage="Adicione ao menos um campo para atualizar." /><Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'updatedContact')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field></div>;
}

function TeamAvailabilityInspector({ node, onUpdate, teamOptions = [] }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><div className="rounded-xl border border-violet-400/20 bg-violet-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Consulta o expediente, exceções e fuso horário cadastrados na própria Dialogy. O fluxo segue pela saída “Aberto” ou “Fechado”.</div><Field label="Equipe"><ResourceSelect value={String(node.config.teamId || '')} onChange={(value) => config('teamId', value)} options={teamOptions} placeholder="Selecione a equipe" /></Field><Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'teamAvailability')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field></div>;
}

function ChatTagInspector({ node, onUpdate, tagOptions = [] }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><div className="rounded-xl border border-violet-400/20 bg-violet-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Aplica a etiqueta diretamente no atendimento atual, usando somente etiquetas deste workspace.</div><Field label="Etiqueta"><ResourceSelect value={String(node.config.tagId || '')} onChange={(value) => config('tagId', value)} options={tagOptions} placeholder="Selecione a etiqueta" /></Field><Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'appliedChatTag')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field></div>;
}

function SgpCommonFields({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <><div className="rounded-xl border border-violet-400/20 bg-violet-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">A conexão, o token e o CPF/CNPJ mapeado vêm da integração SGP da Dialogy. Se informar um CPF/CNPJ aqui, ele precisa coincidir com o contato do atendimento.</div><Field label="CPF/CNPJ (opcional)"><Input value={String(node.config.cpfCnpj || '')} onChange={(event) => config('cpfCnpj', event.target.value)} placeholder="{{variables.cpf_cnpj}}" /></Field><Field label="Forma de seleção"><NativeSelect value={String(node.config.deliveryMode || 'list')} onChange={(value) => config('deliveryMode', value)}><option value="list">Lista no canal quando disponível</option><option value="text">Texto numerado</option>{node.type === 'dialogy.sgp_second_copy' ? <option value="cloud-template">Templates aprovados para pagamento</option> : null}</NativeSelect></Field><Field label="Tempo para o cliente responder (ms)"><Input type="number" min={60000} value={Number(node.config.timeoutMs || 86400000)} onChange={(event) => config('timeoutMs', Number(event.target.value))} /></Field><Field label="Salvar resultado em"><Input value={String(node.config.outputKey || '')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field></>;
}

function SgpContractStatusInspector(props: InspectorProps) {
  return <div className="space-y-4"><SgpCommonFields {...props} /><div className="rounded-xl border border-[var(--wf-border)] p-3 text-xs text-[var(--wf-muted)]">O bloco segue pelas saídas <strong className="text-emerald-300">Ativo</strong>, <strong className="text-amber-300">Suspenso</strong> ou <strong className="text-red-300">Erro</strong>.</div></div>;
}

function SgpIdentificationInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const fields = (keys: SgpIdentificationMessageKey[]) => keys.map((key) => <Field key={key} label={SGP_IDENTIFICATION_MESSAGES[key].label} htmlFor={`sgp-message-${node.id}-${key}`} description={key === 'selectContract' ? 'Use {{page}} e {{pages}} para a página atual e o total.' : undefined}>
    <Textarea id={`sgp-message-${node.id}-${key}`} rows={key.endsWith('Label') ? 1 : 3}
      value={typeof (node.config.messages as Record<string, unknown> | undefined)?.[key] === 'string' ? String((node.config.messages as Record<string, unknown>)[key]) : getSgpIdentificationMessage(node.config, key)}
      onChange={(event) => config('messages', { ...(node.config.messages && typeof node.config.messages === 'object' ? node.config.messages : {}), [key]: event.target.value })} />
  </Field>);
  const basic: SgpIdentificationMessageKey[] = ['missingDocument', 'requestDocument', 'invalidDocument', 'invalidOption'];
  return <div className="space-y-5">
    <section className="space-y-4"><h3 className="text-sm font-semibold">Mensagens para o cliente</h3><p className="text-xs leading-5 text-[var(--wf-muted)]">Edite as perguntas enviadas durante a identificação. Vazio usa o texto padrão.</p>{fields(basic)}
      <details className="rounded-xl border border-[var(--wf-border)] p-3"><summary className="cursor-pointer text-xs font-semibold">Contratos, botões e mensagens avançadas</summary><div className="mt-4 space-y-4">{fields((Object.keys(SGP_IDENTIFICATION_MESSAGES) as SgpIdentificationMessageKey[]).filter((key) => !basic.includes(key)))}</div></details>
    </section>
    <p className="text-xs leading-5 text-[var(--wf-muted)]">O CPF/CNPJ é conferido no SGP. O documento só é salvo no contato após a confirmação do contrato e quando o campo está vazio.</p>
    <Field label="Permitir novo cliente"><NativeSelect value={node.config.allowNewCustomer === true ? 'yes' : 'no'} onChange={(value) => config('allowNewCustomer', value === 'yes')}><option value="no">Não</option><option value="yes">Sim, para atendimento comercial</option></NativeSelect></Field>
    <Field label="Salvar identificação em"><Input value={String(node.config.outputKey || 'sgpIdentification')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field>
    <p className="text-xs text-[var(--wf-muted)]">Editar os rótulos dos botões preserva suas rotas e a paginação dos contratos.</p>
  </div>;
}

function TemplateConfigFields({ node, onUpdate, instanceOptions = [], prefix, label }: InspectorProps & { prefix: 'pixTemplate' | 'boletoTemplate'; label: string }) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-3 rounded-xl border border-orange-400/15 bg-orange-400/[0.035] p-3"><Label>{label}</Label><Field label="Instância"><ResourceSelect value={String(node.config[`${prefix}Instance`] || '')} onChange={(value) => config(`${prefix}Instance`, value)} options={instanceOptions} placeholder="Selecione a instância" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Nome"><Input value={String(node.config[`${prefix}Name`] || '')} onChange={(event) => config(`${prefix}Name`, event.target.value)} /></Field><Field label="Idioma"><Input value={String(node.config[`${prefix}Language`] || 'pt_BR')} onChange={(event) => config(`${prefix}Language`, event.target.value)} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="Variáveis no BODY"><Input type="number" min={1} value={Number(node.config[`${prefix}BodyParameterCount`] || 1)} onChange={(event) => config(`${prefix}BodyParameterCount`, Number(event.target.value))} /></Field><Field label="Posição do código"><Input type="number" min={1} value={Number(node.config[`${prefix}BodyParameter`] || 1)} onChange={(event) => config(`${prefix}BodyParameter`, Number(event.target.value))} /></Field></div></div>;
}

function SgpSecondCopyInspector(props: InspectorProps) {
  return <div className="space-y-4"><SgpCommonFields {...props} />{props.node.config.deliveryMode === 'cloud-template' ? <><TemplateConfigFields {...props} prefix="pixTemplate" label="Template PIX" /><TemplateConfigFields {...props} prefix="boletoTemplate" label="Template boleto" /></> : null}<div className="rounded-xl border border-[var(--wf-border)] p-3 text-xs text-[var(--wf-muted)]">A jornada seleciona contrato, fatura e PIX, boleto ou link; cada resposta retoma a mesma execução.</div></div>;
}

function SgpPaymentPromiseInspector(props: InspectorProps) {
  const { node, onUpdate } = props;
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><SgpCommonFields {...props} /><Field label="Data da promessa" description="Deixe vazio para usar a data atual de São Paulo."><Input value={String(node.config.promiseDate || '')} onChange={(event) => config('promiseDate', event.target.value)} placeholder="AAAA-MM-DD ou {{variables.data}}" /></Field><ToggleField label="Solicitar SMS do SGP" checked={node.config.sendSms !== false} onCheckedChange={(value) => config('sendSms', value)} /><div className="rounded-xl border border-[var(--wf-border)] p-3 text-xs text-[var(--wf-muted)]">As saídas 0, 1 e 2 reproduzem os status de liberação do SGP.</div></div>;
}

function WhatsappGroupInspector({ node, onUpdate, instanceOptions = [] }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Cria o grupo diretamente na Evolution configurada no workspace. Telefones são normalizados e duplicados são removidos.</div><Field label="Instância" description="Vazio usa a instância da conversa que iniciou o fluxo."><ResourceSelect value={String(node.config.instanceName || '')} onChange={(value) => config('instanceName', value)} options={instanceOptions} placeholder="Usar a instância da conversa" /></Field><Field label="Nome do grupo"><Input value={String(node.config.groupName || '')} onChange={(event) => config('groupName', event.target.value)} placeholder="Clientes VIP" /></Field><StringListField label="Participantes" value={node.config.participants} onChange={(value) => config('participants', value)} description="Um telefone com país e DDD por linha. Variáveis também são aceitas." /><Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'whatsappGroup')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field></div>;
}

function WhatsappSendTextInspector({ node, onUpdate, instanceOptions = [] }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Envia diretamente pela Evolution da workspace. Deixe telefone e instância vazios somente quando eles vierem da conversa que iniciou o fluxo.</div><Field label="Instância"><ResourceSelect value={String(node.config.instanceName || '')} onChange={(value) => config('instanceName', value)} options={instanceOptions} placeholder="Usar a instância da conversa" /></Field><Field label="Telefone" description="Use país e DDD ou uma variável, como {{variables.cliente.telefone}}."><Input value={String(node.config.phoneNumber || '')} onChange={(event) => config('phoneNumber', event.target.value)} placeholder="5511999999999" /></Field><Field label="Mensagem"><Textarea value={String(node.config.message || '')} onChange={(event) => config('message', event.target.value)} rows={6} /></Field><Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'whatsappMessage')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field></div>;
}

function WhatsappSendMediaInspector({ node, onUpdate, instanceOptions = [] }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const mediaType = String(node.config.mediaType || 'image');
  return <div className="space-y-4"><div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Envia uma mídia HTTPS diretamente pela Evolution autorizada. A URL é validada no servidor antes do envio.</div><Field label="Instância"><ResourceSelect value={String(node.config.instanceName || '')} onChange={(value) => config('instanceName', value)} options={instanceOptions} placeholder="Usar a instância da conversa" /></Field><Field label="Telefone" description="Use país e DDD ou uma variável."><Input value={String(node.config.phoneNumber || '')} onChange={(event) => config('phoneNumber', event.target.value)} placeholder="5511999999999" /></Field><Field label="Tipo"><NativeSelect value={mediaType} onChange={(value) => config('mediaType', value)}><option value="image">Imagem</option><option value="video">Vídeo</option><option value="audio">Áudio</option><option value="document">Documento</option></NativeSelect></Field><Field label="URL HTTPS"><Input value={String(node.config.url || '')} onChange={(event) => config('url', event.target.value)} placeholder="https://cdn.exemplo.com/arquivo.pdf" /></Field>{mediaType !== 'audio' ? <Field label="Legenda"><Textarea value={String(node.config.caption || '')} onChange={(event) => config('caption', event.target.value)} rows={3} /></Field> : null}<div className="grid grid-cols-2 gap-3"><Field label="Nome do arquivo"><Input value={String(node.config.fileName || '')} onChange={(event) => config('fileName', event.target.value)} /></Field><Field label="MIME type"><Input value={String(node.config.mimeType || '')} onChange={(event) => config('mimeType', event.target.value)} placeholder="application/pdf" /></Field></div><Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'whatsappMedia')} onChange={(event) => config('outputKey', event.target.value.trim().replace(/\s+/g, '_'))} /></Field></div>;
}

function WhatsappCatalogInspector({ node, onUpdate }: InspectorProps) {
  const catalog: WhatsappCatalog = {
    body: String(node.config.body || ''),
    cards: Array.isArray(node.config.cards) ? node.config.cards as WhatsappCatalog['cards'] : [],
  };
  return <div className="min-w-0 space-y-4">
    <p className="text-xs leading-relaxed text-muted-foreground">Envia ao cliente da conversa pela conexão QR Code (Evolution/Baileys). Use variáveis como {'{{variables.cliente.nome}}'} nos textos e URLs. Depois do catálogo, adicione uma pergunta ou menu para aguardar a resposta do cliente.</p>
    <CatalogEditor catalog={catalog} allowUpload={false} onChange={(value) => onUpdate({ ...node, config: { ...node.config, ...value } })} />
    <Field label="Salvar resultado em"><Input value={String(node.config.outputKey || 'whatsappCatalog')} onChange={(event) => onUpdate({ ...node, config: { ...node.config, outputKey: event.target.value } })} /></Field>
  </div>;
}

function LogicMergeInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Conecte dois ou mais caminhos à entrada “Caminhos”. A execução só continua depois que todos os ramos alcançarem este bloco.</div><Field label="Estratégia"><NativeSelect value={String(node.config.mode || 'wait_all')} onChange={(value) => config('mode', value)}><option value="wait_all">Aguardar todos os caminhos</option></NativeSelect></Field></div>;
}

function LogicLoopInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-xs leading-relaxed text-[var(--wf-text)]">A saída “Iterar” volta à sequência repetida. Ligue o fim dessa sequência novamente ao Loop. Os limites abaixo impedem repetição infinita.</div><Field label="Condição de saída" description={'Use uma expressão materializada que resulte em true, como {{variables.pedido_concluido}}.'}><Input value={String(node.config.exitCondition || '')} onChange={(event) => config('exitCondition', event.target.value)} placeholder="{{variables.concluido}}" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Máximo de iterações"><Input type="number" min={1} max={10000} value={Number(node.config.maxIterations || 10)} onChange={(event) => config('maxIterations', Math.max(1, Math.min(10000, Number(event.target.value))))} /></Field><Field label="Tempo total (ms)"><Input type="number" min={1000} max={86_400_000} value={Number(node.config.totalTimeoutMs || 60_000)} onChange={(event) => config('totalTimeoutMs', Math.max(1000, Math.min(86_400_000, Number(event.target.value))))} /></Field></div></div>;
}

function LogicParallelInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Conecte várias etapas à saída “Ramificações”. Todas são ativadas de forma independente. Use um bloco Merge depois delas quando o fluxo precisar aguardar o conjunto.</div><Field label="Estratégia de ativação"><NativeSelect value={String(node.config.joinMode || 'wait_all')} onChange={(value) => config('joinMode', value)}><option value="wait_all">Ativar todas as ramificações</option></NativeSelect></Field></div>;
}

function LogicTimeWindowInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const timezoneOptions = [
    { id: 'America/Sao_Paulo', label: 'Brasília / São Paulo' },
    { id: 'America/Manaus', label: 'Manaus' },
    { id: 'America/Cuiaba', label: 'Cuiabá' },
    { id: 'America/Rio_Branco', label: 'Rio Branco' },
    { id: 'UTC', label: 'UTC' },
  ];
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-3"><Field label="Início"><Input type="time" value={String(node.config.startTime || '09:00')} onChange={(event) => config('startTime', event.target.value)} /></Field><Field label="Fim"><Input type="time" value={String(node.config.endTime || '18:00')} onChange={(event) => config('endTime', event.target.value)} /></Field></div><Field label="Fuso horário"><ResourceSelect value={String(node.config.timezone || 'America/Sao_Paulo')} onChange={(value) => config('timezone', value)} options={timezoneOptions} placeholder="Selecione o fuso" /></Field><p className="rounded-xl border border-[var(--wf-border)] p-3 text-xs leading-relaxed text-[var(--wf-muted)]">Faixas que atravessam meia-noite também são aceitas, por exemplo 22:00 até 06:00.</p></div>;
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
          <option value="event">Evento externo identificado</option>
          <option value="message">Próxima mensagem do cliente</option>
          <option value="time">Passagem de tempo</option>
        </NativeSelect>
      </Field>
      <ToggleField label="Pausar o prazo de execução durante a espera" checked={node.config.pauseTimeoutWhileWaiting === true} onCheckedChange={value => config('pauseTimeoutWhileWaiting', value)} description="O limite continua valendo para as etapas ativas. A espera é recuperada pelo worker Nexus." />
      {mode !== 'time' && <ToggleField label="Expirar a espera pelo prazo configurado" checked={node.config.expireEvents === true} onCheckedChange={value => config('expireEvents', value)} />}
      {mode === 'time' || node.config.expireEvents === true ? (
        <div className="space-y-4"><div className="grid grid-cols-[1fr_9rem] gap-3">
          <Field label="Tempo de espera" htmlFor={durationId}><Input id={durationId} type="number" min={1} value={duration.value} onChange={(event) => config('timeoutMs', guidedDurationToMs(Number(event.target.value), duration.unit))} /></Field>
          <Field label="Unidade" htmlFor={unitId}>
            <NativeSelect id={unitId} value={duration.unit} onChange={(unit) => config('timeoutMs', guidedDurationToMs(duration.value, unit as 'minutes' | 'hours' | 'days'))}>
              <option value="minutes">Minutos</option><option value="hours">Horas</option><option value="days">Dias</option>
            </NativeSelect>
          </Field>
        </div>{mode === 'time' && <ToggleField label="Mostrar indicador de digitação" checked={node.config.showTyping === true} onCheckedChange={(value) => config('showTyping', value)} description="No WhatsApp, sinaliza “digitando” durante a espera; em canais sem suporte, o fluxo apenas aguarda." />}</div>
      ) : null}
      {mode === 'event' && (
        <Field label="Acontecimento esperado" htmlFor={eventId} description="Nome enviado pelo callback de eventos, como pagamento_confirmado. Uma mensagem do cliente não libera esta espera nas automações novas.">
          <Input id={eventId} value={String(node.config.resumeEvent || '')} onChange={(event) => config('resumeEvent', event.target.value.trim().replace(/\s+/g, '_'))} placeholder="cliente_respondeu" />
        </Field>
      )}
      <p className="rounded-lg border border-sky-400/15 bg-sky-400/[0.04] p-3 text-xs leading-relaxed text-[var(--wf-muted)]">Se o tempo limite for atingido antes da retomada, conecte a saída “Expirado” ao próximo passo adequado.</p>
    </div>
  );
}

function GotoInspector({ node, onUpdate, workflowNodeOptions = [] }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">O salto é explícito e auditável. Saltos que formam ciclos são bloqueados na publicação; para repetição, use um bloco de loop com limite.</div><Field label="Continuar em"><NativeSelect value={String(node.config.targetNodeId || '')} onChange={(value) => config('targetNodeId', value)}><option value="">Selecione um bloco</option>{workflowNodeOptions.filter((option) => option.id !== node.id && !option.type.startsWith('trigger.') && !['ai.model', 'memory.session', 'knowledge.rag_retriever', 'tool.internal', 'tool.mcp'].includes(option.type)).map((option) => <option key={option.id} value={option.id}>{option.name} · {option.type}</option>)}</NativeSelect></Field></div>;
}

function SubflowInspector({ node, onUpdate, workflowOptions = [], editorMode = 'advanced' }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const selectedWorkflowId = String(node.config.workflowId || '');
  const selectedWorkflow = workflowOptions.find((workflow) => workflow.id === selectedWorkflowId);
  const selectedWorkflowIsAvailable = !selectedWorkflowId || Boolean(selectedWorkflow);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">
        Executa outro fluxo publicado deste workspace e só continua quando ele terminar. O fluxo chamado precisa começar com “Execução manual” e não pode aguardar perguntas ou eventos.
      </div>
      <Field
        label="Fluxo que será executado"
        description="A lista mostra apenas fluxos publicados que podem ser chamados como subfluxo."
      >
        <ResourceSelect
          value={selectedWorkflowId}
          onChange={(value) => config('workflowId', value)}
          options={workflowOptions}
          placeholder="Selecione um fluxo publicado"
        />
      </Field>
      {!selectedWorkflowIsAvailable ? (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3 text-xs leading-relaxed text-amber-100/80">
          O vínculo atual não está publicado, não possui gatilho manual ou pertence a outro workspace. Selecione outro fluxo antes de publicar.
        </p>
      ) : selectedWorkflow ? (
        <p className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.045] p-3 text-xs leading-relaxed text-[var(--wf-muted)]">
          {selectedWorkflow.label}{selectedWorkflow.description ? ` · ${selectedWorkflow.description}` : ''}
        </p>
      ) : null}

      <section className="space-y-3">
        <div>
          <Label>Informações enviadas ao subfluxo</Label>
          <p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">Para cada campo de entrada, informe um valor ou variável, como {'{{variables.cpf}}'}. Sem mapeamento, a entrada atual é repassada inteira.</p>
        </div>
        <GuidedRecordEditor
          value={node.config.inputMapping}
          onChange={(value) => config('inputMapping', value)}
          keyLabel="Campo no subfluxo"
          valueLabel="Valor ou variável"
          addLabel="Adicionar informação"
          emptyMessage="A entrada atual será enviada inteira ao subfluxo."
        />
      </section>

      {editorMode === 'advanced' ? (
        <details className="rounded-xl border border-[var(--wf-border)] bg-white/[0.02]">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-[var(--wf-text)] marker:content-none">
            Contratos de entrada e saída
          </summary>
          <div className="space-y-5 border-t border-[var(--wf-border)] p-4">
            <section className="space-y-3">
              <div><Label>Campos de entrada esperados</Label><p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">Documenta e valida o formato enviado ao fluxo chamado.</p></div>
              <GuidedSchemaEditor value={node.config.inputSchema} onChange={(value) => config('inputSchema', value)} />
              <AdvancedJsonPreview label="Ver schema de entrada" value={node.config.inputSchema} />
            </section>
            <section className="space-y-3">
              <div><Label>Campos devolvidos</Label><p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">Documenta o resultado disponível aos próximos blocos em current.output.</p></div>
              <GuidedSchemaEditor value={node.config.outputSchema} onChange={(value) => config('outputSchema', value)} />
              <AdvancedJsonPreview label="Ver schema de saída" value={node.config.outputSchema} />
            </section>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function GoalCompletionInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return (
    <div className="space-y-5">
      <div role="note" className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">
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
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-violet-400/15 bg-violet-400/[0.05] p-3 text-xs leading-relaxed text-[var(--wf-muted)]">Usa a memória nativa da Dialogy: mensagens recentes, fatos persistidos do contato e contexto operacional. Nenhuma conexão externa é necessária.</div>
      <Field label="Escopo da memória">
        <NativeSelect value={String(node.config.scope || 'hybrid')} onChange={(value) => config('scope', value)}>
          <option value="hybrid">Híbrida: conversa e contato</option>
          <option value="conversation">Somente esta conversa</option>
          <option value="contact">Somente fatos do contato</option>
        </NativeSelect>
      </Field>
      <Field label="Quantas mensagens recentes lembrar" htmlFor={messagesId}>
        <Input id={messagesId} type="number" min={1} max={200} value={Number(node.config.maxMessages || 20)} onChange={(event) => config('maxMessages', Number(event.target.value))} />
      </Field>
      <Field label="Histórico de fatos do contato (dias)" htmlFor={durationId}>
        <Input id={durationId} type="number" min={1} max={730} value={Number(node.config.maxAgeDays || 180)} onChange={(event) => config('maxAgeDays', Number(event.target.value))} />
      </Field>
      <AdvancedJsonPreview label="Ver configuração técnica" value={{ provider: 'dialogy', layers: node.config.layers || ['turn_context', 'operational_state', 'contact_fact', 'case_memory'] }} />
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

function MediaInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const mediaType = String(node.config.mediaType || 'image');
  return <div className="space-y-4"><Field label="Tipo de mídia"><NativeSelect value={mediaType} onChange={(value) => config('mediaType', value)}><option value="image">Imagem</option><option value="video">Vídeo</option><option value="audio">Áudio</option><option value="document">Documento</option></NativeSelect></Field><Field label="Arquivo privado" description="Use a referência produzida por um bloco de arquivo ou voz."><Input value={typeof node.config.file === 'string' ? node.config.file : JSON.stringify(node.config.file || '')} onChange={event => config('file', event.target.value)} placeholder="{{variables.audio}}" /></Field><Field label="URL HTTPS" description="Pode ser uma URL pública ou variável produzida por outro bloco."><Input value={String(node.config.url || '')} onChange={(event) => config('url', event.target.value)} placeholder="https://cdn.exemplo.com/arquivo.pdf ou {{variables.arquivo.url}}" /></Field>{mediaType !== 'audio' ? <Field label="Legenda (opcional)"><Textarea value={String(node.config.caption || '')} onChange={(event) => config('caption', event.target.value)} rows={4} /></Field> : null}{mediaType === 'document' ? <Field label="Nome do arquivo"><Input value={String(node.config.fileName || '')} onChange={(event) => config('fileName', event.target.value)} placeholder="boleto.pdf" /></Field> : null}<Field label="MIME type (opcional)"><Input value={String(node.config.mimeType || '')} onChange={(event) => config('mimeType', event.target.value)} placeholder={mediaType === 'image' ? 'image/jpeg' : mediaType === 'video' ? 'video/mp4' : mediaType === 'audio' ? 'audio/ogg' : 'application/pdf'} /></Field></div>;
}

function RedirectInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">Finaliza a execução entregando uma URL ao canal ou chamador compatível. Este bloco não faz uma requisição HTTP.</div><Field label="URL de destino"><Input value={String(node.config.url || '')} onChange={(event) => config('url', event.target.value)} placeholder="https://app.exemplo.com/pedido/{{variables.id}}" /></Field></div>;
}

function HandoffInspector({ node, onUpdate, teamOptions = [], memberOptions = [], intelligentAgentOptions = [] }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const teamId = `handoff-team-${node.id}`;
  const reasonId = `handoff-reason-${node.id}`;
  const destinationType = String(node.config.destinationType || 'human');
  const humanDestination = node.config.teamId ? 'team' : node.config.agentId ? 'member' : 'team';
  return (
    <div className="space-y-5">
      <Field label="Destino"><NativeSelect value={destinationType} onChange={(value) => config('destinationType', value)}><option value="human">Equipe ou atendente humano</option><option value="intelligent_agent">Atendente Inteligente</option></NativeSelect></Field>
      {destinationType === 'intelligent_agent' ? <Field label="Atendente Inteligente"><ResourceSelect value={String(node.config.systemAgentId || '')} onChange={(value) => config('systemAgentId', value)} options={intelligentAgentOptions} placeholder="Selecione o atendente" /></Field> : <><Field label="Forma de transferência"><NativeSelect value={humanDestination} onChange={(value) => onUpdate({ ...node, config: { ...node.config, ...(value === 'team' ? { agentId: '' } : { teamId: '' }) } })}><option value="team">Distribuir para uma equipe</option><option value="member">Atribuir a uma pessoa específica</option></NativeSelect></Field>{humanDestination === 'team' ? <Field label="Equipe que receberá o atendimento" htmlFor={teamId}><ResourceSelect id={teamId} value={String(node.config.teamId || '')} onChange={(value) => config('teamId', value)} options={teamOptions} placeholder="Selecione a equipe" /></Field> : <Field label="Atendente específico"><ResourceSelect value={String(node.config.agentId || '')} onChange={(value) => config('agentId', value)} options={memberOptions} placeholder="Selecione o atendente" /></Field>}</>}
      <Field label="Motivo da transferência" htmlFor={reasonId} description="Este texto ajuda a equipe humana a entender o contexto.">
        <Textarea id={reasonId} value={String(node.config.reason || '')} onChange={(event) => config('reason', event.target.value)} className="min-h-28" placeholder="Explique quando e por que transferir" />
      </Field>
      <ToggleField label="Confirmar antes de transferir" checked={node.config.requireConfirmation === true} onCheckedChange={(value) => config('requireConfirmation', value)} description="Peça confirmação quando a transferência tiver impacto no atendimento." />
      {node.config.requireConfirmation === true ? <Field label="Caminho da confirmação" description="Informe o booleano true produzido pelo bloco de confirmação, por exemplo variables.transferencia_confirmada."><Input value={String(node.config.confirmationPath || '')} onChange={(event) => config('confirmationPath', event.target.value.trim())} placeholder="variables.transferencia_confirmada" /></Field> : null}
    </div>
  );
}

function CloseConversationInspector({ node, onUpdate, tagOptions = [] }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  const reasonId = `close-reason-${node.id}`;
  const notesId = `close-notes-${node.id}`;
  const tagId = `close-tag-${node.id}`;
  return (
    <div className="space-y-5">
      <div role="note" className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-xs leading-relaxed text-[var(--wf-text)]">
        Este bloco só encerra sem pedido explícito do cliente quando recebe a prova do bloco “Objetivo concluído” na mesma execução. Uma resposta comum ou um agradecimento não autorizam o fechamento.
      </div>
      <Field label="Autorização para encerrar"><NativeSelect value={String(node.config.closePolicy || 'goal_evidence')} onChange={(value) => config('closePolicy', value)}><option value="goal_evidence">Exigir objetivo concluído</option><option value="deterministic_route">Rota determinística publicada</option></NativeSelect></Field>
      <Field label="Motivo do encerramento" htmlFor={reasonId} description="Explique qual objetivo foi concluído.">
        <Input id={reasonId} value={String(node.config.reason || '')} onChange={(event) => config('reason', event.target.value)} placeholder="Objetivo do atendimento concluído" />
      </Field>
      <Field label="Resumo interno" htmlFor={notesId} description="Fica registrado no atendimento e não é enviado ao cliente.">
        <Textarea id={notesId} value={String(node.config.notes || '')} onChange={(event) => config('notes', event.target.value)} className="min-h-24" placeholder="Dados confirmados e resultado alcançado" />
      </Field>
      <Field label="Marcador de motivo (opcional)" htmlFor={tagId}>
        <ResourceSelect id={tagId} value={String(node.config.reasonTagId || '')} onChange={(value) => config('reasonTagId', value)} options={tagOptions.filter((tag) => tag.isCloseReason)} placeholder="Selecione um motivo de encerramento" />
      </Field>
      <ToggleField label="Enviar template de encerramento" checked={node.config.sendCloseMessage === true} onCheckedChange={(value) => config('sendCloseMessage', value)} description="Use somente quando o fluxo não enviou uma mensagem final própria." />
    </div>
  );
}

function EndInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return (
    <div className="space-y-4">
      <div><Label>Informações finais do fluxo</Label><p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">Opcionalmente, defina os dados que serão entregues como resultado da execução.</p></div>
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
        <p className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.05] p-3 text-xs leading-relaxed text-[var(--wf-muted)]">A execução seguirá pela saída “Recuperado”. Conecte essa saída a um caminho que saiba continuar com segurança.</p>
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
          <div><Label>Rotas permitidas</Label><p className="text-xs text-[var(--wf-muted)]">A IA somente pode selecionar IDs declarados aqui.</p></div>
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

function PromptInspector({ node, onUpdate }: InspectorProps) {
  const { config } = useNodeUpdater(node, onUpdate);
  return <div className="space-y-4"><Field label="Instruções da resposta" description="Uma geração de texto com o modelo conectado. Use variáveis do fluxo e mantenha decisões e valores comerciais em blocos próprios."><Textarea className="min-h-64" value={String(node.config.prompt || '')} onChange={event => config('prompt', event.target.value)} /></Field><Field label="Salvar texto na variável"><Input value={String(node.config.outputKey || 'generatedText')} onChange={event => config('outputKey', event.target.value)} /></Field></div>;
}

export function ModelInspector({ node, onUpdate }: InspectorProps) {
  const { config, rename } = useNodeUpdater(node, onUpdate);
  return (
    <div className="space-y-5">
      <Field label="Nome do bloco"><Input value={node.name} onChange={(event) => rename(event.target.value)} /></Field>
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
            <span className="block text-sm font-medium text-[var(--wf-text)]">{summaryTitle}</span>
            <span className="mt-1 block text-xs leading-relaxed text-[var(--wf-muted)]">{summaryDescription}</span>
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
                : 'border-[var(--wf-border)] bg-white/[0.025] text-[var(--wf-text)] hover:border-sky-400/20',
            )}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">Todas as coleções</span>
              <span className="mt-0.5 block text-xs text-[var(--wf-muted)]">Não limitar o escopo por coleção</span>
            </span>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs tabular-nums text-[var(--wf-muted)]">{selection.availableDocuments.length}</span>
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
                    : 'border-[var(--wf-border)] bg-white/[0.025] text-[var(--wf-text)] hover:border-sky-400/20',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{collection.name}</span>
                  {collection.description ? <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-[var(--wf-muted)]">{collection.description}</span> : null}
                </span>
                <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-xs tabular-nums text-[var(--wf-muted)]">{documentCount}</span>
              </button>
            );
          })}
          {knowledgeCollections.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--wf-border)] px-3 py-2 text-xs leading-relaxed text-[var(--wf-muted)]">
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
          <span className="ml-auto text-xs tabular-nums text-[var(--wf-muted)]">{selectedCount}/{selection.scopedDocuments.length}</span>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--wf-muted)]" />
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
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--wf-muted)] hover:bg-white/[0.06] hover:text-[var(--wf-text)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div role="group" aria-label="Documentos disponíveis" className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-[var(--wf-border)] p-2">
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
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--wf-muted)]" />
                    <span className="block truncate text-sm text-[var(--wf-text)]">{document.name}</span>
                    {document.status === 'draft' ? <span className="shrink-0 rounded bg-amber-400/10 px-1.5 py-0.5 text-xs text-amber-300">Rascunho</span> : null}
                  </span>
                  {metadata ? <span className="mt-1 block truncate text-xs text-[var(--wf-muted)]">{metadata}</span> : null}
                  {document.summary ? <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-[var(--wf-muted)]">{document.summary}</span> : null}
                </span>
              </label>
            );
          })}

          {selection.scopedDocuments.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <Database className="mx-auto h-5 w-5 text-[var(--wf-muted)]" />
              <p className="mt-2 text-xs font-medium text-[var(--wf-text)]">
                {selection.availableDocuments.length === 0 ? 'Nenhum documento cadastrado' : 'Nenhum documento nestas coleções'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">
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
              <Search className="mx-auto h-5 w-5 text-[var(--wf-muted)]" />
              <p className="mt-2 text-xs font-medium text-[var(--wf-text)]">Nenhum resultado para “{documentQuery.trim()}”</p>
              <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setDocumentQuery('')}>Limpar busca</Button>
            </div>
          ) : null}
        </div>
        {selection.scopedDocuments.length === 1 ? <p className="text-xs leading-relaxed text-[var(--wf-muted)]">Este é o único documento disponível no escopo e permanece ativo para evitar uma base vazia. Para trocá-lo, adicione outro documento ou escolha outra coleção.</p> : null}
      </Field>

      <details className="group rounded-xl border border-[var(--wf-border)] bg-white/[0.02]">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-[var(--wf-text)] marker:content-none">
          <span className="flex items-center justify-between gap-3">
            Ajustes da busca
            <span className="text-xs font-normal text-[var(--wf-muted)] group-open:hidden">Opcional</span>
          </span>
        </summary>
        <div className="space-y-4 border-t border-[var(--wf-border)] p-4">
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
        <p className="mt-1 text-xs leading-relaxed text-[var(--wf-text)]">Nome, schemas, servidor, risco, timeout e confirmação são sincronizados com a integração ativa antes de testar ou publicar.</p>
      </div>
      <Field label="Nome da ferramenta" htmlFor={toolNameId}><Input id={toolNameId} value={String(node.config.displayName || node.name)} readOnly className="cursor-default opacity-80" /></Field>
      <Field label="Quando a IA pode usar" htmlFor={descriptionId}><Textarea id={descriptionId} value={String(node.config.description || '')} readOnly className="min-h-24 cursor-default opacity-80" /></Field>
      {mcp ? (
        <>
          <Field label="Servidor MCP" htmlFor={serverId}><Input id={serverId} value={String(node.config.serverName || node.config.serverId || '')} readOnly className="cursor-default opacity-80" /></Field>
          <Field label="Ações permitidas"><div className="flex flex-wrap gap-2">{(Array.isArray(node.config.allowedTools) ? node.config.allowedTools : []).map((tool) => <span key={String(tool)} className="rounded-full border border-[var(--wf-border)] bg-white/[0.04] px-2.5 py-1 text-xs text-[var(--wf-text)]">{String(tool)}</span>)}</div></Field>
        </>
      ) : (
        <Field label="Ação interna" htmlFor={actionId}><Input id={actionId} value={String(node.config.action || node.config.name || '')} readOnly className="cursor-default opacity-80" /></Field>
      )}

      <section className="space-y-3" aria-labelledby={`tool-input-heading-${node.id}`}>
        <div>
          <Label id={`tool-input-heading-${node.id}`}>Informações que a ferramenta recebe</Label>
          <p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">Dados que o agente precisa preencher antes de executar a ferramenta.</p>
        </div>
        <AdvancedJsonPreview label="Ver entrada técnica" value={node.config.inputSchema} />
      </section>

      <section className="space-y-3" aria-labelledby={`tool-output-heading-${node.id}`}>
        <div>
          <Label id={`tool-output-heading-${node.id}`}>Informações devolvidas pela ferramenta</Label>
          <p className="mt-1 text-xs leading-relaxed text-[var(--wf-muted)]">Dados que ficarão disponíveis para os próximos blocos.</p>
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

function SubflowToolInspector(props: InspectorProps) {
  const { config } = useNodeUpdater(props.node, props.onUpdate);
  return <div className="space-y-5"><Field label="Nome da ferramenta"><Input value={String(props.node.config.name || '')} onChange={(event) => config('name', event.target.value)} /></Field><Field label="Quando a IA deve chamar este fluxo"><Textarea value={String(props.node.config.description || '')} onChange={(event) => config('description', event.target.value)} /></Field><SubflowInspector {...props} /></div>;
}

export function NativeSpecializedNodeInspector(props: InspectorProps) {
  if (toolboxManifests().some(manifest => manifest.type === props.node.type)) return <WorkflowToolboxInspector node={props.node} onUpdate={props.onUpdate} workspaceId={props.workspaceId} credentials={props.credentialOptions} workflows={props.workflowOptions} />;
  if (BUILTIN_AGENT_TOOL_TYPES.has(props.node.type)) return <div className="space-y-3"><p className="text-sm font-medium text-[var(--wf-text)]">{props.node.name}</p><p className="text-xs leading-relaxed text-[var(--wf-muted)]">{String(props.node.config.description || 'O agente escolhe os argumentos quando precisar desta ferramenta.')}</p><p className="rounded-xl border border-[var(--wf-border)] p-3 text-xs leading-relaxed text-[var(--wf-muted)]">Algumas ferramentas exigem serviços, credenciais ou imagens isoladas configurados pelo administrador. Conecte esta ferramenta ao agente para autorizá-la.</p></div>;
  switch (props.node.type) {
    case 'trigger.received_message':
    case 'trigger.webhook':
    case 'trigger.internal_event':
    case 'trigger.schedule':
    case 'trigger.manual': return <TriggerInspector {...props} />;
    case 'interaction.input': return <InteractionInputInspector {...props} />;
    case 'interaction.options': return <InteractionOptionsInspector {...props} />;
    case 'interaction.date': return <InteractionDateInspector {...props} />;
    case 'interaction.file': return <InteractionFileInspector {...props} />;
    case 'interaction.rating': return <InteractionRatingInspector {...props} />;
    case 'data.set': return <DataSetInspector {...props} />;
    case 'data.transform': return <DataTransformInspector {...props} />;
    case 'data.extract': return <DataExtractInspector {...props} />;
    case 'data.code': return <DataCodeInspector {...props} />;
    case 'data.log': return <DataLogInspector {...props} />;
    case 'data.template': return <DataTemplateInspector {...props} />;
    case 'logic.if': return <LogicIfInspector {...props} />;
    case 'logic.switch': return <LogicSwitchInspector {...props} />;
    case 'logic.ai_router': return <AiRouterInspector {...props} />;
    case 'logic.goal_completion': return <GoalCompletionInspector {...props} />;
    case 'logic.merge': return <LogicMergeInspector {...props} />;
    case 'logic.loop': return <LogicLoopInspector {...props} />;
    case 'logic.parallel': return <LogicParallelInspector {...props} />;
    case 'logic.time_window': return <LogicTimeWindowInspector {...props} />;
    case 'logic.wait': return <LogicWaitInspector {...props} />;
    case 'logic.subflow': return <SubflowInspector {...props} />;
    case 'logic.goto': return <GotoInspector {...props} />;
    case 'integration.http_request': return <HttpRequestInspector {...props} />;
    case 'integration.mcp_call': return <McpCallInspector {...props} />;
    case 'integration.email': return <EmailInspector {...props} />;
    case 'integration.google_sheets_append': return <SheetsInspector {...props} />;
    case 'integration.google_ads_lead': return <GoogleAdsLeadFields config={props.node.config} onChange={(patch) => props.onUpdate({ ...props.node, config: { ...props.node.config, ...patch } })} />;
    case 'integration.database': return <DatabaseInspector {...props} />;
    case 'dialogy.crm_update': return <CrmUpdateInspector {...props} />;
    case 'dialogy.team_availability': return <TeamAvailabilityInspector {...props} />;
    case 'dialogy.chat_tag': return <ChatTagInspector {...props} />;
    case 'dialogy.sgp_identify_customer': return <SgpIdentificationInspector {...props} />;
    case 'dialogy.sgp_contract_status': return <SgpContractStatusInspector {...props} />;
    case 'dialogy.sgp_second_copy': return <SgpSecondCopyInspector {...props} />;
    case 'dialogy.sgp_payment_promise': return <SgpPaymentPromiseInspector {...props} />;
    case 'whatsapp.send_text': return <WhatsappSendTextInspector {...props} />;
    case 'whatsapp.send_media': return <WhatsappSendMediaInspector {...props} />;
    case 'whatsapp.send_catalog': return <WhatsappCatalogInspector {...props} />;
    case 'whatsapp.group_create': return <WhatsappGroupInspector {...props} />;
    case 'ai.model': return <ModelInspector {...props} />;
    case 'ai.prompt': return <PromptInspector {...props} />;
    case 'knowledge.rag_retriever': return <RagInspector {...props} />;
    case 'memory.session': return <MemorySessionInspector {...props} />;
    case 'tool.subflow': return <SubflowToolInspector {...props} />;
    case 'tool.http': return <HttpToolInspector {...props} />;
    case 'tool.database': return <DatabaseToolInspector {...props} />;
    case 'tool.internal':
    case 'tool.mcp': return <ToolInspector {...props} />;
    case 'guardrail.policy': return <GuardrailInspector {...props} />;
    case 'output.respond': return <RespondInspector {...props} />;
    case 'output.media': return <MediaInspector {...props} />;
    case 'output.redirect': return <RedirectInspector {...props} />;
    case 'output.handoff': return <HandoffInspector {...props} />;
    case 'output.close_conversation': return <CloseConversationInspector {...props} />;
    case 'output.end': return <EndInspector {...props} />;
    case 'error.handler': return <ErrorHandlerInspector {...props} />;
    default: return null;
  }
}
