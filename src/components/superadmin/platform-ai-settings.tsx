'use client';

import { useEffect, useState } from 'react';
import { Plus, Save, Trash2, KeyRound, RefreshCw, Server, BrainCircuit, Coins } from 'lucide-react';
import { getPlatformAiSettingsAction, savePlatformAiSettingsAction, savePlatformAiKeyAction, grantAiCreditsAction } from '@/actions/ai-credits';
import { getLmStudioConfigAction, saveLmStudioConfigAction, syncLmStudioModelsAction, saveAiDecisionModelConfigAction } from '@/actions/ai-models';
import type { PlatformAiConfig, PlatformAiModel } from '@/lib/platform-ai';
import { AI_DECISION_MODEL_ROLES, DEFAULT_AI_DECISION_MODEL_CONFIG, type AiDecisionModelConfig } from '@/lib/ai-decision-models';
import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiCreditReconciliation } from './ai-credit-reconciliation';
import { toast } from '@/hooks/use-toast';
import { createClientUuid } from '@/lib/client-uuid';

const initial: PlatformAiConfig = { defaultModel:'',models:[],creditValueBrl:0.01,costCurrency:'BRL',usdToBrl:5,billingEnabled:false };
const emptyRates = { inputCost:0, outputCost:0, inputMarkup:0, outputMarkup:0 };
const fields = [['inputCost','Custo de entrada / 1M'],['inputMarkup','Acréscimo na entrada (%)'],['outputCost','Custo de saída / 1M'],['outputMarkup','Acréscimo na saída (%)']] as const;
const selectClass = 'block w-full min-w-0 rounded-md border bg-background p-2 text-sm';
const providerNames: Record<string,string> = {openai:'OpenAI',googleai:'Google / Gemini',deepseek:'DeepSeek',lmstudio:'LM Studio'};

export function PlatformAiSettings() {
  const [config,setConfig] = useState(initial);
  const [decisions,setDecisions] = useState<AiDecisionModelConfig>(DEFAULT_AI_DECISION_MODEL_CONFIG);
  const [tab,setTab] = useState('models');
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [workspaces,setWorkspaces] = useState<Array<{id:string;name:string;balance:string;reserved:string}>>([]);
  const [providers,setProviders] = useState<string[]>([]);
  const [provider,setProvider] = useState('openai');
  const [key,setKey] = useState('');
  const [workspaceId,setWorkspaceId] = useState('');
  const [credits,setCredits] = useState(1000);
  const [reason,setReason] = useState('');
  const [requestId,setRequestId] = useState('');
  const [lm,setLm] = useState({baseUrl:'',apiToken:''});
  const refresh = async (loadConfig=true) => {
    const data = await getPlatformAiSettingsAction();
    if(loadConfig) {
      setConfig(data.config || {...initial, models:data.legacyModels.map(model=>({...model,...emptyRates}))});
      setDecisions(data.decisions);
    }
    setWorkspaces(data.workspaces);setProviders(data.configuredProviders);setError('');
  };
  useEffect(() => {
    setRequestId(createClientUuid());
    void refresh().catch(e=>setError(e.message)).finally(()=>setLoading(false));
    void getLmStudioConfigAction().then(result=>{if(!result.error)setLm(result.config);}).catch(()=>undefined);
  },[]);
  const run = async (action:()=>Promise<unknown>) => {
    setBusy(true);
    try { await action();toast({title:'Alterações salvas'}); }
    catch(e) { toast({title:'Erro',description:e instanceof Error?e.message:'Tente novamente.',variant:'destructive'}); }
    finally {setBusy(false);}
  };
  const patch = (i:number,value:Partial<PlatformAiModel>) => setConfig(current=>({...current,models:current.models.map((m,n)=>i===n?{...m,...value}:m)}));
  const save = () => run(async()=>{
    if(tab==='decisions') {
      const result=await saveAiDecisionModelConfigAction(decisions);
      if(!result.success)throw new Error(result.error);
    } else await savePlatformAiSettingsAction(config);
  });
  const syncModels = () => run(async()=>{
    const result=await syncLmStudioModelsAction();
    if(!result.success)throw new Error(result.error);
    setConfig(current=>({...current,models:[...current.models,...(result.models||[]).filter(m=>m.id.startsWith('lmstudio/')&&!current.models.some(existing=>existing.id===m.id)).map(m=>({...m,...emptyRates}))]}));
  });

  if(loading)return <p>Carregando...</p>;
  if(error)return <div role="alert">{error}<Button onClick={()=>run(()=>refresh())}>Tentar novamente</Button></div>;

  return <div className="min-w-0 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">IA Global</h1><p className="mt-1 text-sm text-muted-foreground">{config.models.length} modelos cadastrados · {config.models.filter(m=>m.enabled).length} ativos</p></div>
      <Button disabled={busy} onClick={save}><Save className="mr-2 h-4 w-4"/>{tab==='decisions'?'Salvar modelos de decisão':'Salvar configuração'}</Button>
    </header>
    <Tabs value={tab} onValueChange={setTab} className="min-w-0">
      <TabsList className="grid h-auto w-full grid-cols-3 items-stretch gap-1 bg-transparent p-0">
        <TabsTrigger value="models" className="min-w-0 whitespace-normal border-b-2 py-3 text-center data-[state=active]:border-primary"><Server className="hidden h-4 w-4 shrink-0 sm:block"/>Provedores e modelos</TabsTrigger>
        <TabsTrigger value="decisions" className="min-w-0 whitespace-normal border-b-2 py-3 text-center data-[state=active]:border-primary"><BrainCircuit className="hidden h-4 w-4 shrink-0 sm:block"/>Decisões do Autopilot</TabsTrigger>
        <TabsTrigger value="credits" className="min-w-0 whitespace-normal border-b-2 py-3 text-center data-[state=active]:border-primary"><Coins className="hidden h-4 w-4 shrink-0 sm:block"/>Créditos de IA</TabsTrigger>
      </TabsList>

      <TabsContent value="models" className="space-y-6 pt-5">
        <section className="space-y-3 border-b pb-6">
          <h2 className="text-lg font-semibold">Provedores</h2>
          <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
            <label className="text-sm">Provedor<select className={selectClass} value={provider} onChange={e=>{setProvider(e.target.value);setKey('');}}>{Object.entries(providerNames).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
            {provider!=='lmstudio'&&<label className="text-sm">Chave de API<Input type="password" autoComplete="new-password" value={key} onChange={e=>setKey(e.target.value)} placeholder={providers.includes(provider)?'Chave cadastrada. Digite para substituir.':'Chave de API'}/></label>}
          </div>
          {provider==='lmstudio'?<div className="space-y-3">
            <label className="block text-sm">Endpoint<Input value={lm.baseUrl} onChange={e=>setLm({...lm,baseUrl:e.target.value})}/></label>
            <label className="block text-sm">Token<Input type="password" autoComplete="new-password" value={lm.apiToken} onChange={e=>setLm({...lm,apiToken:e.target.value})}/></label>
            <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>run(async()=>{const result=await saveLmStudioConfigAction(lm);if(!result.success)throw new Error(result.error);})}><Save className="mr-2 h-4 w-4"/>Salvar LM Studio</Button><Button variant="outline" disabled={busy} onClick={syncModels}><RefreshCw className="mr-2 h-4 w-4"/>Sincronizar modelos</Button></div>
          </div>:<Button disabled={busy||!key.trim()} onClick={()=>run(async()=>{await savePlatformAiKeyAction(provider,key);setKey('');setProviders(current=>Array.from(new Set([...current,provider])));})}><KeyRound className="mr-2 h-4 w-4"/>Salvar chave</Button>}
        </section>
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Catálogo de modelos</h2><Button variant="outline" onClick={()=>setConfig({...config,models:[...config.models,{id:'',label:'',enabled:true,...emptyRates}]})}><Plus className="mr-2 h-4 w-4"/>Adicionar modelo</Button></div>
          <label className="block max-w-xl text-sm">Modelo principal<select className={selectClass} value={config.defaultModel} onChange={e=>setConfig({...config,defaultModel:e.target.value})}><option value="">Selecionar</option>{config.models.filter(m=>m.enabled&&m.id).map((m,i)=><option key={i} value={m.id}>{m.label||m.id}</option>)}</select></label>
          {!config.defaultModel&&<p role="status" className="text-sm text-amber-700">Modelo principal pendente.</p>}
          {config.models.map((m,i)=><div key={i} className="space-y-3 rounded-lg border p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <label className="min-w-0 text-sm">Nome<Input value={m.label} onChange={e=>patch(i,{label:e.target.value})}/></label>
              <label className="min-w-0 text-sm">ID do modelo<Input value={m.id} onChange={e=>patch(i,{id:e.target.value})} placeholder="openai/gpt-..."/></label>
              <label className="flex items-center gap-2 self-end py-2 text-sm"><Switch checked={m.enabled} onCheckedChange={enabled=>patch(i,{enabled})}/>Ativo</label>
              <div className="space-y-2 text-xs"><span>Formatos confirmados para ferramentas do Flowbuilder</span>{(['image','pdf'] as const).map(type => <label key={type} className="flex items-center gap-2"><input type="checkbox" disabled={type === 'pdf' && !m.id.startsWith('googleai/')} checked={m.supportedMediaTypes?.includes(type) || false} onChange={e => patch(i,{supportedMediaTypes:e.target.checked ? [...new Set([...(m.supportedMediaTypes || []),type])] : (m.supportedMediaTypes || []).filter(value => value !== type)})} />{type === 'image' ? 'Imagens' : 'PDFs multimodais (Google)'}</label>)}</div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{providerNames[getAiModelRuntimeProvider(m.id)]||'Provedor não identificado'}</span>{!m.id&&<Button size="icon" variant="ghost" title="Descartar modelo vazio" aria-label="Descartar modelo vazio" onClick={()=>setConfig({...config,models:config.models.filter((_,n)=>n!==i)})}><Trash2 className="h-4 w-4"/></Button>}</div>
            <label className="block text-sm">Descrição<Input value={m.description||''} onChange={e=>patch(i,{description:e.target.value})}/></label>
          </div>)}
        </section>
      </TabsContent>

      <TabsContent value="decisions" className="space-y-5 pt-5">
        <h2 className="text-lg font-semibold">Modelos de decisão do Autopilot</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {AI_DECISION_MODEL_ROLES.map(role=><div key={role.id} className="space-y-4 rounded-lg border p-4">
            <div><h3 className="font-semibold">{role.label}</h3><p className="mt-1 text-sm text-muted-foreground">{role.description}</p></div>
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <label className="min-w-0 text-sm">Modelo<select aria-label={`Modelo de ${role.label}`} className={selectClass} value={decisions[role.id].model} onChange={e=>setDecisions({...decisions,[role.id]:{...decisions[role.id],model:e.target.value}})}>
                {!config.models.some(m=>m.id===decisions[role.id].model&&m.enabled)&&<option value={decisions[role.id].model}>{decisions[role.id].model} (indisponível)</option>}
                {config.models.filter(m=>m.enabled&&m.id).map((m,i)=><option key={i} value={m.id}>{m.label||m.id}</option>)}
              </select></label>
              <label className="text-sm">Timeout (ms)<Input aria-label={`Timeout de ${role.label} (ms)`} type="number" min="500" max="15000" step="100" value={decisions[role.id].timeoutMs} onChange={e=>setDecisions({...decisions,[role.id]:{...decisions[role.id],timeoutMs:Number(e.target.value)}})}/></label>
            </div>
          </div>)}
        </div>
      </TabsContent>

      <TabsContent value="credits" className="space-y-6 pt-5">
        <section className="space-y-4 border-b pb-6">
          <h2 className="text-lg font-semibold">Cobrança por créditos</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm">Valor de 1 crédito (R$)<Input type="number" min="0.000001" step="0.000001" value={config.creditValueBrl} onChange={e=>setConfig({...config,creditValueBrl:Number(e.target.value)})}/></label>
            <label className="text-sm">Moeda dos custos<select className={selectClass} value={config.costCurrency} onChange={e=>setConfig({...config,costCurrency:e.target.value as 'BRL'|'USD'})}><option value="BRL">Real (R$)</option><option value="USD">Dólar (US$)</option></select></label>
            {config.costCurrency==='USD'&&<label className="text-sm">Cotação do dólar em R$<Input type="number" min="0.01" step="0.01" value={config.usdToBrl} onChange={e=>setConfig({...config,usdToBrl:Number(e.target.value)})}/></label>}
          </div>
          <label className="flex items-center gap-3 text-sm"><Switch checked={config.billingEnabled} onCheckedChange={billingEnabled=>setConfig({...config,billingEnabled})}/>Cobrança por créditos ativa</label>
        </section>
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Custos e acréscimos por modelo</h2>
          {config.models.map((m,i)=><div key={i} className="space-y-3 rounded-lg border p-4">
            <h3 className="break-words font-semibold">{m.label||m.id||'Modelo sem nome'}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{fields.map(([field,label])=><label key={field} className="min-w-0 text-sm">{label}<Input type="number" min="0" step="0.01" value={m[field]} onChange={e=>patch(i,{[field]:Number(e.target.value)})}/></label>)}</div>
            <p className="text-xs text-muted-foreground">Venda / 1M: entrada {(m.inputCost*(1+m.inputMarkup/100)).toFixed(4)} {config.costCurrency} · saída {(m.outputCost*(1+m.outputMarkup/100)).toFixed(4)} {config.costCurrency}</p>
          </div>)}
        </section>
        <section className="space-y-3 border-t pt-6">
          <h2 className="text-lg font-semibold">Conceder créditos</h2>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Workspace<select className={selectClass} value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)}><option value="">Selecionar</option>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name} · saldo {Number(w.balance).toLocaleString('pt-BR')}</option>)}</select></label><label className="text-sm">Créditos<Input type="number" min="1" value={credits} onChange={e=>setCredits(Number(e.target.value))}/></label></div>
          <label className="block text-sm">Motivo<Input value={reason} onChange={e=>setReason(e.target.value)}/></label>
          <Button disabled={busy||!workspaceId||reason.trim().length<3} onClick={()=>run(async()=>{await grantAiCreditsAction({workspaceId,credits,reason,requestId});setRequestId(createClientUuid());setReason('');await refresh(false);})}><Plus className="mr-2 h-4 w-4"/>Conceder créditos</Button>
        </section>
        <AiCreditReconciliation />
      </TabsContent>
    </Tabs>
  </div>;
}
