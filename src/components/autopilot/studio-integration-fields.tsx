'use client';

import { createClientUuid } from '@/lib/client-uuid';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { testHttpRequestAction, testMcpToolAction } from '@/actions/agent-studio';
import type { HttpRequestStepConfig, ProcedureStep } from '@/services/agent-studio/types';
import type { McpToolConfig } from '@/services/mcp/types';
import { readStudioValue } from '@/services/agent-studio/data-mapping';
import { studioMcpFields } from '@/services/agent-studio/mcp-fields';
import type { StudioDataOption } from '@/services/agent-studio/data-availability';
export { availableStudioData } from '@/services/agent-studio/data-availability';

type Mapping = HttpRequestStepConfig['sentDataMappings'][number];
type DataOption = StudioDataOption;
const inputClass = 'h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100';
const sourceLabels = { collected_field: 'Dado coletado', step_output: 'Resultado anterior', contact_property: 'Contato', flow_input: 'Entrada do fluxo', static_value: 'Valor fixo' };

export function StudioIntegrationFields({ agentId, step, onChange, data, tool }: {
  agentId: string;
  step: ProcedureStep;
  onChange: (step: ProcedureStep) => void;
  data: DataOption[];
  tool?: McpToolConfig;
}) {
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ success: boolean; response?: unknown; error?: string } | null>(null);
  const testConfiguration = JSON.stringify(step.httpRequest || step.mcpTool);
  useEffect(() => { setConfirmed(false); }, [testConfiguration]);
  const isHttp = Boolean(step.httpRequest);
  const mappings: Mapping[] = step.httpRequest?.sentDataMappings || step.mcpTool?.argumentMappings.map((item) => ({
    apiField: item.argumentName, sourceType: item.sourceType || 'collected_field', sourceValue: item.sourceChipKey, valueType: item.valueType,
  })) || [];
  const outputs = step.httpRequest?.outputMappings || step.mcpTool?.outputMappings || [];
  const properties = studioMcpFields(tool?.inputSchema);
  const required = Object.keys(properties).filter((key) => properties[key].required);
  const changeMappings = (next: Mapping[]) => {
    setConfirmed(false); setResult(null);
    onChange(step.httpRequest ? { ...step, httpRequest: { ...step.httpRequest, sentDataMappings: next } } : {
      ...step, mcpTool: { ...step.mcpTool!, argumentMappings: next.map((item) => ({
        argumentName: item.apiField, sourceType: item.sourceType, sourceChipKey: item.sourceValue,
        sourceChipLabel: data.find((option) => option.key === item.sourceValue)?.label || item.sourceValue,
        valueType: item.valueType,
      })) },
    });
  };
  const patch = (index: number, update: Partial<Mapping>) => changeMappings(mappings.map((item, position) => position === index ? { ...item, ...update } : item));
  const changeOutputs = (next: typeof outputs) => onChange(step.httpRequest
    ? { ...step, httpRequest: { ...step.httpRequest, outputMappings: next } }
    : { ...step, mcpTool: { ...step.mcpTool!, outputMappings: next } });
  const sampleFields = mappings.filter((item, index, list) => item.sourceType !== 'static_value' && item.sourceValue && list.findIndex((other) => `${other.sourceType}:${other.sourceValue}` === `${item.sourceType}:${item.sourceValue}`) === index);
  const discovered = useMemo(() => {
    const entries: Array<{ path: string; label: string }> = [];
    const visit = (value: unknown, path: string, depth: number) => {
      if (depth > 5 || entries.length >= 80) return;
      if (path) entries.push({ path, label: `${path} (${Array.isArray(value) ? 'lista' : value === null ? 'vazio' : typeof value === 'object' ? 'objeto' : typeof value === 'number' ? 'número' : 'valor'})` });
      if (value && typeof value === 'object') for (const [key, child] of Object.entries(value).slice(0, 20)) visit(child, path ? `${path}.${key}` : key, depth + 1);
    };
    visit(result?.response, '', 0);
    return entries;
  }, [result]);

  const runTest = async () => {
    if (!confirmed || busy) return;
    setBusy(true); setResult(null);
    try {
      const context = { values: {} as Record<string, unknown>, contact: {} as Record<string, unknown>, input: {} as Record<string, unknown>, realExecutionConfirmed: true };
      for (const item of sampleFields) {
        const raw = testValues[`${item.sourceType}:${item.sourceValue}`] || '';
        let value: unknown = raw;
        if (['number', 'boolean', 'json'].includes(item.valueType || '')) value = JSON.parse(raw);
        const target = item.sourceType === 'contact_property' ? context.contact : item.sourceType === 'flow_input' ? context.input : context.values;
        // Validate before constructing nested test data.
        readStudioValue({}, item.sourceValue);
        const parts = item.sourceValue.split('.');
        let cursor = target;
        for (const part of parts.slice(0, -1)) { cursor[part] ??= {}; cursor = cursor[part] as Record<string, unknown>; }
        cursor[parts.at(-1)!] = value;
      }
      // Once configured, validate the same mappings that production will consume.
      const outcome = step.httpRequest
        ? await testHttpRequestAction(agentId, step.httpRequest, context)
        : await testMcpToolAction(agentId, step.mcpTool!, context);
      setResult(outcome);
    } catch (error) {
      setResult({ success: false, error: error instanceof Error ? error.message : 'Não foi possível testar.' });
    } finally { setBusy(false); setConfirmed(false); }
  };

  return <div className="space-y-4 border-t border-slate-700 pt-4">
    <section className="space-y-3" aria-label="Dados enviados">
      <h5 className="text-xs font-semibold text-slate-100">Quais dados serão enviados?</h5>
      {!isHttp && tool && <p className="text-xs text-slate-400">{tool.description} {required.length > 0 && `Obrigatórios: ${required.map((key) => properties[key]?.title || key).join(', ')}.`}</p>}
      {mappings.map((mapping, index) => <fieldset key={index} className="space-y-2 rounded-lg border border-slate-700 p-3">
        <legend className="px-1 text-xs text-slate-300">Campo {index + 1}</legend>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="space-y-1 text-xs text-slate-400">Campo da integração
            {!isHttp && Object.keys(properties).length ? <select className={inputClass} value={mapping.apiField} onChange={(event) => {
              const type = properties[event.target.value]?.type;
              patch(index, { apiField: event.target.value, valueType: type === 'number' || type === 'integer' ? 'number' : type === 'boolean' ? 'boolean' : type === 'object' || type === 'array' ? 'json' : 'text' });
            }}><option value="">Selecione o parâmetro</option>{Object.entries(properties).map(([key, property]) => <option key={key} value={key}>{property.title || key}{required.includes(key) ? ' *' : ''}</option>)}</select>
              : <Input className={inputClass} value={mapping.apiField} placeholder="Ex.: document" onChange={(event) => patch(index, { apiField: event.target.value })} />}
          </label>
          <Button type="button" size="icon" variant="ghost" className="mt-4" aria-label={`Remover campo ${index + 1}`} onClick={() => changeMappings(mappings.filter((_, position) => position !== index))}><Trash2 className="h-4 w-4" /></Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs text-slate-400">De onde vem
            <select className={inputClass} value={mapping.sourceType} onChange={(event) => patch(index, { sourceType: event.target.value as Mapping['sourceType'], sourceValue: '' })}>{Object.entries(sourceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          </label>
          <label className="space-y-1 text-xs text-slate-400">{mapping.sourceType === 'static_value' ? 'Valor' : 'Dado disponível'}
            {mapping.sourceType === 'static_value' && properties[mapping.apiField]?.enum
              ? <select className={inputClass} value={mapping.sourceValue} onChange={(event) => patch(index, { sourceValue: event.target.value })}><option value="">Selecione uma opção permitida</option>{properties[mapping.apiField].enum!.map((value, position) => <option key={position} value={typeof value === 'string' ? value : JSON.stringify(value)}>{typeof value === 'string' ? value : JSON.stringify(value)}</option>)}</select>
              : mapping.sourceType === 'static_value' && mapping.valueType === 'boolean'
              ? <select className={inputClass} value={mapping.sourceValue} onChange={(event) => patch(index, { sourceValue: event.target.value })}><option value="">Selecione</option><option value="true">Sim</option><option value="false">Não</option></select>
              : mapping.sourceType === 'static_value' && mapping.valueType === 'json'
              ? <Textarea className="min-h-24 border-slate-700 bg-slate-950 text-xs" value={mapping.sourceValue} onChange={(event) => patch(index, { sourceValue: event.target.value })} placeholder="Objeto ou lista em JSON" />
              : mapping.sourceType === 'static_value' || mapping.sourceType === 'flow_input'
              ? <Input className={inputClass} value={mapping.sourceValue} onChange={(event) => patch(index, { sourceValue: event.target.value })} placeholder={mapping.sourceType === 'flow_input' ? 'Nome do dado de entrada' : 'Informe o valor'} />
              : <select className={inputClass} value={mapping.sourceValue} onChange={(event) => patch(index, { sourceValue: event.target.value })}><option value="">Selecione um dado</option>{data.filter((item) => item.sourceType === mapping.sourceType).map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select>}
          </label>
        </div>
        {properties[mapping.apiField]?.description && <p className="text-xs text-slate-400">{properties[mapping.apiField].description}</p>}
        <div className="grid grid-cols-2 gap-2">
          {isHttp && <label className="space-y-1 text-xs text-slate-400">Enviar em<select className={inputClass} value={mapping.location || (step.httpRequest?.method === 'GET' ? 'query' : 'body')} onChange={(event) => patch(index, { location: event.target.value as Mapping['location'] })}><option value="query">Parâmetro de consulta</option><option value="body">Corpo da requisição</option><option value="path">Caminho</option><option value="header">Cabeçalho não secreto</option></select></label>}
          <label className="space-y-1 text-xs text-slate-400">Tipo esperado<select className={inputClass} value={mapping.valueType || ''} onChange={(event) => patch(index, { valueType: event.target.value as Mapping['valueType'] || undefined })}><option value="">Preservar tipo original</option><option value="text">Texto</option><option value="number">Número</option><option value="boolean">Verdadeiro ou falso</option><option value="json">Objeto ou lista</option></select></label>
        </div>
      </fieldset>)}
      <Button type="button" variant="outline" size="sm" onClick={() => changeMappings([...mappings, { apiField: '', sourceType: 'collected_field', sourceValue: '' }])}><Plus className="mr-1 h-3 w-3" />Adicionar dado enviado</Button>
    </section>
    <section className="space-y-2" aria-label="Resultados disponíveis">
      <h5 className="text-xs font-semibold text-slate-100">Quais resultados usar depois?</h5>
      {outputs.map((output, index) => <fieldset key={output.chipKey} className="space-y-2 rounded-lg border border-slate-700 p-3">
        <legend className="px-1 text-xs text-slate-300">Resultado {index + 1}</legend>
        <label className="block text-xs text-slate-400">Nome para as próximas etapas<Input className={inputClass} value={output.chipLabel} placeholder="Ex.: Link da fatura" onChange={(event) => changeOutputs(outputs.map((item, position) => position === index ? { ...item, chipLabel: event.target.value } : item))} /></label>
        <label className="block text-xs text-slate-400">Campo retornado pela integração
          <input list={`studio-result-fields-${step.id}`} className={inputClass} value={output.jsonPath} placeholder="Teste a integração e selecione um campo" onChange={(event) => changeOutputs(outputs.map((item, position) => position === index ? { ...item, jsonPath: event.target.value } : item))} />
        </label>
        <div className="flex items-center justify-between text-xs text-slate-400"><label className="flex gap-2"><input type="checkbox" checked={output.required !== false} onChange={(event) => changeOutputs(outputs.map((item, position) => position === index ? { ...item, required: event.target.checked } : item))} />Resultado obrigatório</label><Button type="button" size="icon" variant="ghost" aria-label={`Remover resultado ${index + 1}`} onClick={() => changeOutputs(outputs.filter((_, position) => position !== index))}><Trash2 className="h-4 w-4" /></Button></div>
      </fieldset>)}
      <datalist id={`studio-result-fields-${step.id}`}>{discovered.map((item) => <option key={item.path} value={item.path}>{item.label}</option>)}</datalist>
      <Button type="button" variant="outline" size="sm" onClick={() => changeOutputs([...outputs, { chipKey: `result_${createClientUuid().replaceAll('-', '')}`, chipLabel: '', jsonPath: '', required: true }])}><Plus className="mr-1 h-3 w-3" />Guardar resultado</Button>
    </section>
    <details className="rounded-lg border border-amber-500/30 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-amber-300">Testar integração real</summary>
      <p className="my-3 text-xs text-slate-400">A chamada será enviada ao serviço conectado e pode alterar dados. Use uma conexão de testes. A simulação da conversa não executa estas chamadas.</p>
      <div className="space-y-2">{sampleFields.map((item) => <label key={`${item.sourceType}:${item.sourceValue}`} className="block text-xs text-slate-300">{data.find((option) => option.key === item.sourceValue && option.sourceType === item.sourceType)?.label || item.apiField}<Input className={inputClass} value={testValues[`${item.sourceType}:${item.sourceValue}`] || ''} placeholder={`Valor de teste${item.valueType === 'json' ? ' em JSON' : ''}`} onChange={(event) => { setConfirmed(false); setTestValues({ ...testValues, [`${item.sourceType}:${item.sourceValue}`]: event.target.value }); }} /></label>)}</div>
      <label className="my-3 flex gap-2 text-xs text-amber-200"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />Confirmo a chamada real e seus possíveis efeitos neste serviço.</label>
      <Button type="button" variant="outline" size="sm" disabled={!confirmed || busy} onClick={runTest}><Play className="mr-1 h-3 w-3" />{busy ? 'Executando…' : 'Executar teste real'}</Button>
      {result && <div role="status" className="mt-3 text-xs"><p className={result.success ? 'text-emerald-300' : 'text-red-300'}>{result.success ? 'A integração respondeu. Revise os campos retornados abaixo.' : result.error}</p>{result.success && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 text-slate-300">{JSON.stringify(result.response, null, 2)?.slice(0, 12000)}</pre>}</div>}
    </details>
  </div>;
}
