'use client';

import { studioFieldPreset } from '@/services/agent-studio/sgp-template';
import { createClientUuid } from '@/lib/client-uuid';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FIELD_DATA_TYPES, FIELD_DATA_TYPE_LABELS, type AgentStudioDocument, type CollectedFieldDefinition } from '@/services/agent-studio/types';

export type StudioResources = { teams: { id: string; name: string }[]; tags: { id: string; name: string }[]; fields: { id: string; name: string; type: string }[] };
const control = 'mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white';
export function StudioFieldEditor({ field, onChange, crmFields = [] }: { field: CollectedFieldDefinition; onChange: (field: CollectedFieldDefinition) => void; crmFields?: StudioResources['fields'] }) {
  const update = (patch: Partial<CollectedFieldDefinition>) => onChange({ ...field, ...patch });
  return <div className="space-y-3 text-xs text-slate-300">
    <div className="flex flex-wrap gap-2">{(['cpf_cnpj', 'name', 'phone', 'email'] as const).map((type) => <Button key={type} type="button" size="sm" variant="outline" onClick={() => onChange(studioFieldPreset(type, field.id))}>{ { cpf_cnpj: 'CPF/CNPJ se faltar', name: 'Nome se faltar', phone: 'Telefone se faltar', email: 'E-mail se faltar' }[type]}</Button>)}</div>
    <p>Um valor válido já coletado é reaproveitado. A origem configurada abaixo é validada; se estiver vazia ou inválida, a IA pergunta ao cliente.</p>
    <label className="block">Variável que guarda o dado<Input className={control} value={field.variableKey} onChange={(event) => update({ variableKey: event.target.value })} /></label>
    <label className="block">Nome do dado<Input className={control} value={field.name} onChange={(event) => update({ name: event.target.value })} placeholder="Ex.: E-mail para contato" /></label>
    <label className="block">Outros nomes que o cliente pode usar<Input className={control} value={(field.aliases || []).join(', ')} onChange={(event) => update({ aliases: event.target.value.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 10) })} placeholder="Ex.: celular, WhatsApp" /><span className="mt-1 block text-slate-400">Separe por vírgulas. Isso ajuda a reconhecer respostas rotuladas e pedidos de correção sem adivinhação.</span></label>
    <label className="block">Tipo<select className={control} value={field.type} onChange={(event) => update({ type: event.target.value as CollectedFieldDefinition['type'], isSensitive: ['cpf', 'cnpj', 'file'].includes(event.target.value) || field.isSensitive })}>{FIELD_DATA_TYPES.map((type) => <option key={type} value={type}>{FIELD_DATA_TYPE_LABELS[type]}</option>)}</select></label>
    <label className="block">Como perguntar ao cliente<Textarea className={control} value={field.promptMessage} onChange={(event) => update({ promptMessage: event.target.value })} rows={2} /></label>
    {['single_select', 'multi_select'].includes(field.type) && <label className="block">Opções, uma por linha<Textarea className={control} value={(field.options || []).join('\n')} onChange={(event) => update({ options: event.target.value.split('\n') })} /></label>}
    <label className="flex items-center justify-between gap-3">Obrigatório<input type="checkbox" checked={field.required} onChange={(event) => update({ required: event.target.checked })} /></label>
    <p className="text-slate-400">No modo adaptativo, as informações são coletadas pelo objetivo: a IA pode aproveitar vários dados e mudar a ordem das perguntas independentes. Se o cliente não souber, registra como não informado sem insistir. Dados dispensáveis podem ser deixados de fora; operações e confirmações mantêm suas exigências.</p>
    <label className="flex items-center justify-between gap-3">Pedir confirmação antes de usar<input type="checkbox" checked={field.requiresConfirmation} onChange={(event) => update({ requiresConfirmation: event.target.checked })} /></label>
    {field.type !== 'file' && <label className="block">Se o cliente ainda não informou, aproveitar do contato<select className={control} value={field.reuseFrom?.sourceType === 'contact_property' ? field.reuseFrom.sourceValue : ''} onChange={(event) => update({ reuseFrom: event.target.value ? { sourceType: 'contact_property', sourceValue: event.target.value } : undefined })}><option value="">Não aproveitar · perguntar ao cliente</option><option value="name">Nome do contato</option><option value="email">E-mail do contato</option><option value="phone">Telefone do contato</option></select><span className="mt-1 block text-slate-400">O formato será validado. Um dado do cadastro não comprova identidade ou autorização de acesso.</span></label>}
    {field.type !== 'file' && <label className="block">Ou aproveitar um dado do CRM desta conversa<select className={control} value={field.reuseFrom?.sourceType === 'contact_property' && (field.reuseFrom.sourceValue.startsWith('custom_fields.') || field.reuseFrom.sourceValue === 'address') ? field.reuseFrom.sourceValue : ''} onChange={(event) => update({ reuseFrom: event.target.value ? { sourceType: 'contact_property', sourceValue: event.target.value } : undefined })}><option value="">Não selecionado</option><option value="custom_fields.sgp_document">CPF/CNPJ mapeado na integração SGP</option><option value="address">Endereço do contato</option>{crmFields.map((item) => <option key={item.id} value={`custom_fields.${item.id}`}>{item.name}</option>)}</select></label>}
    <label className="flex items-center justify-between gap-3">Dado sensível · ocultar no histórico técnico<input type="checkbox" checked={field.isSensitive} onChange={(event) => update({ isSensitive: event.target.checked })} /></label>
    {field.type !== 'file' && <label className="block">Ou reaproveitar variável de entrada do fluxo<Input className={control} placeholder="Ex.: customer_cpf" value={field.reuseFrom?.sourceType === 'flow_input' ? field.reuseFrom.sourceValue : ''} onChange={(event) => update({ reuseFrom: event.target.value ? { sourceType: 'flow_input', sourceValue: event.target.value } : undefined })} /></label>}
    <details><summary className="cursor-pointer text-slate-400">Validação e tentativas</summary><div className="space-y-3 pt-3">
      <label className="block">Mensagem quando o dado não for válido<Input className={control} value={field.errorMessage || ''} onChange={(event) => update({ errorMessage: event.target.value })} placeholder="Usar orientação automática" /></label>
      <label className="block">Máximo de tentativas<select className={control} value={field.maxAttempts} onChange={(event) => update({ maxAttempts: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label>
      {['number', 'currency'].includes(field.type) && <div className="grid grid-cols-2 gap-3">{(['minValue', 'maxValue'] as const).map((key) => <label key={key}>{key === 'minValue' ? 'Mínimo' : 'Máximo'}<Input className={control} type="number" value={field[key] ?? ''} onChange={(event) => update({ [key]: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>)}</div>}
      <p className="text-[11px] text-slate-400">CPF, CNPJ, e-mail, datas e demais formatos são validados automaticamente. Ao exceder as tentativas, o agente chama a equipe configurada.</p>
    </div></details>
  </div>;
}

export function StudioStageSettings({ stage, document, onChange, onClose, resources }: {
  stage: 'understand' | 'conclude'; document: AgentStudioDocument; onChange: (document: AgentStudioDocument) => void;
  onClose: () => void; resources: StudioResources;
}) {
  const [draft, setDraft] = useState(() => structuredClone(document));
  const titles = { understand: 'Entender o cliente', conclude: 'Concluir o atendimento' };
  const understand = (patch: Partial<AgentStudioDocument['understandStage']>) => setDraft((old) => ({ ...old, understandStage: { ...old.understandStage, ...patch } }));
  const conclude = (patch: Partial<AgentStudioDocument['concludeStage']>) => setDraft((old) => ({ ...old, concludeStage: { ...old.concludeStage, ...patch } }));
  const moveField = (index: number, direction: number) => { const fields = [...draft.understandStage.initialFields]; const target = index + direction; [fields[index], fields[target]] = [fields[target], fields[index]]; understand({ initialFields: fields }); };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="dark max-w-xl border-slate-800 bg-[#0f172a] text-slate-100"><DialogHeader><DialogTitle>{titles[stage]}</DialogTitle><DialogDescription>Configure em linguagem simples. A mudança fica no rascunho até você publicar.</DialogDescription></DialogHeader>
    <div className="max-h-[65vh] overflow-auto space-y-4 pr-2 text-xs">
      {stage === 'understand' && <>
        <label className="block">Boas-vindas<Textarea className={control} value={draft.understandStage.welcomeMessage} onChange={(event) => understand({ welcomeMessage: event.target.value })} /></label>
        <label className="flex justify-between">Coletar dados antes de escolher o procedimento<input type="checkbox" checked={draft.understandStage.askInitialData} onChange={(event) => understand({ askInitialData: event.target.checked })} /></label>
        {draft.understandStage.askInitialData && <>
          {draft.understandStage.initialFields.map((field, index, fields) => <div key={field.id} className="space-y-3 rounded-xl border border-slate-700 p-4"><div className="flex items-center justify-between"><strong>{index + 1}. {field.name}</strong><div className="flex gap-1"><Button size="icon" variant="ghost" disabled={!index} aria-label="Mover dado para cima" onClick={() => moveField(index, -1)}><ArrowUp className="h-3 w-3" /></Button><Button size="icon" variant="ghost" disabled={index === fields.length - 1} aria-label="Mover dado para baixo" onClick={() => moveField(index, 1)}><ArrowDown className="h-3 w-3" /></Button><Button size="icon" variant="ghost" aria-label="Remover dado" onClick={() => understand({ initialFields: fields.filter((item) => item.id !== field.id) })}><Trash2 className="h-3 w-3" /></Button></div></div><StudioFieldEditor crmFields={resources.fields} field={field} onChange={(updated) => understand({ initialFields: fields.map((item) => item.id === field.id ? updated : item) })} /></div>)}
          <Button variant="outline" onClick={() => { const id = createClientUuid(); understand({ initialFields: [...draft.understandStage.initialFields, { id, variableKey: `field_${id.replaceAll('-', '_')}`, name: 'Novo dado', type: 'text', promptMessage: '', required: true, requiresConfirmation: false, isSensitive: false, maxAttempts: 3 }] }); }}><Plus className="mr-1 h-3 w-3" />Adicionar dado</Button>
        </>}
        <label className="block">Quando o assunto estiver fora do escopo<Textarea className={control} value={draft.understandStage.outOfScopeMessage} onChange={(event) => understand({ outOfScopeMessage: event.target.value })} /></label>
      </>}
      {stage === 'conclude' && <>
        <label className="block">Pergunta para confirmar a solução<Textarea className={control} value={draft.concludeStage.confirmResolutionQuestion} onChange={(event) => conclude({ confirmResolutionQuestion: event.target.value })} /></label>
        <label className="block">Mensagem ao concluir<Textarea className={control} value={draft.concludeStage.successClosingMessage} onChange={(event) => conclude({ successClosingMessage: event.target.value })} /></label>
        <label className="block">Equipe quando não conseguir resolver<select className={control} value={resources.teams.find((team) => team.id === draft.concludeStage.handoffTeam || team.name === draft.concludeStage.handoffTeam)?.id || ''} onChange={(event) => conclude({ handoffTeam: event.target.value })}><option value="">Selecione uma equipe</option>{resources.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label className="block">Mensagem de transferência<Textarea className={control} value={draft.concludeStage.handoffMessage} onChange={(event) => conclude({ handoffMessage: event.target.value })} /></label>
        <label className="block">Tentativas para entender o pedido<select className={control} value={draft.concludeStage.maxRetriesBeforeHandoff} onChange={(event) => conclude({ maxRetriesBeforeHandoff: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label>
      </>}
    </div><DialogFooter><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button className="bg-emerald-600" onClick={() => { onChange(draft); onClose(); }}>Aplicar ao rascunho</Button></DialogFooter>
  </DialogContent></Dialog>;
}
