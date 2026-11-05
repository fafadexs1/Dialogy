import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PlatformAiConfigSchema, quoteAiCredits, type PlatformAiConfig } from '@/lib/platform-ai';

const holder = vi.hoisted(() => ({ database:null as unknown as PGlite }));
const adminId = '00000000-0000-4000-8000-000000000001';
vi.mock('@/actions/user',()=>({getCurrentUser:async()=>({id:'00000000-0000-4000-8000-000000000001'})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'00000000-0000-4000-8000-000000000001'}}})}})}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn(),revalidateTag:vi.fn(),unstable_cache:(fn:unknown)=>fn}));
vi.mock('@/lib/db',()=>({db:{
  query:(sql:string,values?:unknown[])=>holder.database.query(sql,values).then(r=>({...r,rowCount:r.affectedRows ?? r.rows.length})),
  connect:async()=>({query:(sql:string,values?:unknown[])=>holder.database.query(sql,values).then(r=>({...r,rowCount:r.affectedRows ?? r.rows.length})),release:()=>{}}),
}}));
import { addAiCredits,reserveAiCredits,settleAiCredits,finishAiCreditCall } from '@/services/ai/credits';
import { resolveAutopilotModelFromCatalog } from '@/services/ai/model-selection';
import { meteredAiCall } from '@/services/ai/metered-call';
import { requestPlatformJson as requestOpenAiCompatibleJson } from '@/services/ai/platform-json';
import { z } from 'zod';
import { fulfillAiCreditCheckout } from '@/services/ai/credit-payments';
import { requestDecisionJson } from '@/services/ai/platform-json';
import { resolveAiDecisionModel } from '@/services/ai/decision-model-config';
import { AI_DECISION_MODEL_ROLES } from '@/lib/ai-decision-models';
import { getPlatformAiSettingsAction, savePlatformAiSettingsAction } from '@/actions/ai-credits';
import { saveAiDecisionModelConfigAction } from '@/actions/ai-models';

const config:PlatformAiConfig={defaultModel:'openai/test',models:[{id:'openai/test',label:'Test',enabled:true,inputCost:2,outputCost:8,inputMarkup:50,outputMarkup:25}],creditValueBrl:0.01,costCurrency:'BRL',usdToBrl:5,billingEnabled:true};
const workspaceId=randomUUID();
beforeAll(async()=>{
  holder.database=new PGlite();
  await holder.database.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE workspaces(id uuid PRIMARY KEY,name text); CREATE TABLE users(id uuid PRIMARY KEY,is_superadmin boolean); CREATE TABLE system_settings(key text PRIMARY KEY,value text,updated_at timestamptz);');
  await holder.database.query('INSERT INTO users(id,is_superadmin) VALUES($1,true)',[adminId]);
  await holder.database.exec(readFileSync('prisma/migrations/20260912160000_platform_ai_credits/migration.sql','utf8'));
  await holder.database.query('INSERT INTO workspaces(id) VALUES($1)',[workspaceId]);
  await holder.database.query("INSERT INTO ai_platform_settings(id,config) VALUES('global',$1)",[JSON.stringify(config)]);
  await holder.database.query('INSERT INTO ai_provider_credentials(provider,api_key) VALUES($1,$2)',['openai','isolated-test-key']);
},30000);
afterAll(async()=>{await holder.database.close();});

describe('Platform AI credits',()=>{
  it('validates pricing, default model and duplicate IDs',()=>{
    expect(PlatformAiConfigSchema.safeParse(config).success).toBe(true);
    for(const value of [{...config,defaultModel:'other'}, {...config,models:[...config.models,...config.models]}, {...config,creditValueBrl:0}, {...config,models:[{...config.models[0],inputCost:-1}]}]) expect(PlatformAiConfigSchema.safeParse(value).success).toBe(false);
  });
  it('prices input/output independently, includes markup and conversion',()=>{
    expect(quoteAiCredits(config,config.models[0],1000,500)).toBe(0.8);
    expect(quoteAiCredits({...config,costCurrency:'USD'},config.models[0],1000,500)).toBe(4);
    expect(()=>quoteAiCredits(config,config.models[0],-1,1)).toThrow();
    expect(()=>quoteAiCredits(config,config.models[0],NaN,1)).toThrow();
  });
  it('ignores user and published model overrides',async()=>{
    expect((await resolveAutopilotModelFromCatalog('deepseek/old-published-model')).model).toBe('openai/test');
  });
  it('grants once, reserves, blocks competing spending and settles once at original price',async()=>{
    const reference=`grant:${randomUUID()}`;
    expect(await addAiCredits({workspaceId,credits:1,reference,description:'Test',kind:'grant'})).toBe(true);
    expect(await addAiCredits({workspaceId,credits:1,reference,description:'Test',kind:'grant'})).toBe(false);
    const reservation={workspaceId,config,model:config.models[0],source:'test',inputTokens:1000,outputTokens:500};
    const id=await reserveAiCredits(reservation);
    await expect(reserveAiCredits(reservation)).rejects.toThrow('insuficientes');
    await settleAiCredits(id,{inputTokens:100,outputTokens:50});
    await settleAiCredits(id,{inputTokens:100,outputTokens:50});
    const wallet=await holder.database.query<{balance:string;reserved:string}>('SELECT * FROM ai_credit_wallets WHERE workspace_id=$1',[workspaceId]);
    expect(Number(wallet.rows[0].balance)).toBe(0.92);
    expect(Number(wallet.rows[0].reserved)).toBe(0);
    const entries=await holder.database.query("SELECT * FROM ai_credit_entries WHERE kind='usage'");
    expect(entries.rows).toHaveLength(1);
  });
  it('releases rejected calls and retains uncertain reservations without inventing charges',async()=>{
    const reservation={workspaceId,config,model:config.models[0],source:'test',inputTokens:100,outputTokens:50};
    const id=await reserveAiCredits(reservation);
    await finishAiCreditCall(id,true);
    const pending=await holder.database.query<{status:string}>('SELECT status FROM ai_credit_calls WHERE id=$1',[id]);
    expect(pending.rows[0].status).toBe('review');
    await settleAiCredits(id,{inputTokens:100,outputTokens:50});
    const rejected=await reserveAiCredits(reservation);
    await finishAiCreditCall(rejected,false);
    await finishAiCreditCall(rejected,false);
    const wallet=await holder.database.query<{reserved:string}>('SELECT reserved FROM ai_credit_wallets WHERE workspace_id=$1',[workspaceId]);
    expect(Number(wallet.rows[0].reserved)).toBe(0);
  });
  it('does not dispatch paid calls without scope or enough balance',async()=>{
    const execute=vi.fn();
    await expect(meteredAiCall({model:'openai/test',source:'test',execute})).rejects.toThrow('workspace');
    await expect(meteredAiCall({workspaceId,model:'openai/test',source:'test',execute})).rejects.toThrow('insuficientes');
    expect(execute).not.toHaveBeenCalled();
  });
  it('settles before returning output and blocks direct browser access to wallets',async()=>{
    const output=await meteredAiCall({workspaceId,model:'openai/test',source:'test',inputTokenBudget:100,outputTokenBudget:50,
      execute:async record=>{await record({inputTokens:100,outputTokens:50});return 'ok';}});
    expect(output).toBe('ok');
    await holder.database.exec('SET ROLE authenticated');
    await expect(holder.database.query('SELECT * FROM ai_credit_wallets')).rejects.toThrow('permission denied');
    await expect(holder.database.query('UPDATE ai_credit_wallets SET balance=100000')).rejects.toThrow('permission denied');
    await expect(holder.database.query('SELECT * FROM ai_provider_credentials')).rejects.toThrow('permission denied');
    await expect(holder.database.query('UPDATE ai_platform_settings SET config=\'{}\'')).rejects.toThrow('permission denied');
    await holder.database.exec('RESET ROLE');
  });
  it('routes through the configured provider and persists its reported usage before parsing output',async()=>{
    await addAiCredits({workspaceId,credits:100,reference:randomUUID(),description:'Gateway test',kind:'grant'});
    const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      expect(body.model).toBe('test');
      return new Response(JSON.stringify({id:'completion-test',object:'chat.completion',created:1,model:'test',
        choices:[{index:0,message:{role:'assistant',content:'{"text":"ok"}'},finish_reason:'stop'}],
        usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}}),{status:200,headers:{'content-type':'application/json'}});
    });
    const result=await requestOpenAiCompatibleJson({workspaceId,model:'deepseek/untrusted-override',apiKey:'untrusted-key',
      schema:z.object({text:z.string()}),schemaName:'gateway_test',jsonSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},
      systemPrompt:'Test',userPrompt:'Test',fetch:transport as typeof fetch,maxTokens:100});
    expect(result).toEqual({text:'ok'});
    expect(transport).toHaveBeenCalledOnce();
    const calls=await holder.database.query<{status:string;input_tokens:number;output_tokens:number}>("SELECT * FROM ai_credit_calls WHERE source='gateway_test'");
    expect(calls.rows).toHaveLength(1);
    expect(calls.rows[0].status).toBe('settled');
    expect(Number(calls.rows[0].input_tokens)).toBe(200);
    expect(Number(calls.rows[0].output_tokens)).toBe(100);
  });
  it('credits only paid matching checkout orders and survives webhook redelivery',async()=>{
    const id=randomUUID();
    await holder.database.query('INSERT INTO ai_credit_orders(id,workspace_id,credits,amount_cents,stripe_session_id) VALUES($1,$2,1000,1000,$3)',[id,workspaceId,'cs_isolated']);
    const session={id:'cs_isolated',metadata:{type:'ai_credits',orderId:id},payment_status:'unpaid',currency:'brl',amount_total:1000,client_reference_id:id};
    await fulfillAiCreditCheckout(session as any);
    expect((await holder.database.query("SELECT id FROM ai_credit_entries WHERE kind='purchase'")).rows).toHaveLength(0);
    await expect(fulfillAiCreditCheckout({...session,payment_status:'paid',amount_total:100} as any)).rejects.toThrow('divergente');
    await fulfillAiCreditCheckout({...session,payment_status:'paid'} as any);
    await fulfillAiCreditCheckout({...session,payment_status:'paid'} as any);
    const rows=await holder.database.query<{amount:string}>("SELECT amount FROM ai_credit_entries WHERE kind='purchase'");
    expect(rows.rows).toHaveLength(1);expect(Number(rows.rows[0].amount)).toBe(1000);
  });
  it('uses every saved decision model, provider key and price independently of the main model',async()=>{
    const decisionModels=AI_DECISION_MODEL_ROLES.map((role,i)=>({...config.models[0],id:'deepseek/'+role.id,inputCost:10+i}));
    const extended={...config,models:[...config.models,...decisionModels]};
    const settings=Object.fromEntries(AI_DECISION_MODEL_ROLES.map((role,i)=>[role.id,{model:decisionModels[i].id,timeoutMs:2500}]));
    await holder.database.query("UPDATE ai_platform_settings SET config=$1 WHERE id='global'",[JSON.stringify(extended)]);
    await holder.database.query("INSERT INTO system_settings(key,value) VALUES('ai_decision_model_config',$1)",[JSON.stringify(settings)]);
    await holder.database.query("INSERT INTO ai_provider_credentials(provider,api_key) VALUES('deepseek','decision-test-key')");
    const before=await holder.database.query<{balance:string}>('SELECT balance FROM ai_credit_wallets WHERE workspace_id=$1',[workspaceId]);
    let expectedCost=0;
    for(const [i,role] of AI_DECISION_MODEL_ROLES.entries()){
      expect(await resolveAiDecisionModel(role.id)).toBe(decisionModels[i].id);
      const transport=vi.fn(async(url:unknown,init?:RequestInit)=>{
        expect(String(url)).toContain('api.deepseek.com');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer decision-test-key');
        expect(JSON.parse(String(init?.body)).model).toBe(role.id);
        return new Response(JSON.stringify({choices:[{index:0,message:{role:'assistant',content:'{"text":"decision"}'},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}}),{status:200,headers:{'content-type':'application/json'}});
      });
      await requestDecisionJson(role.id,{workspaceId,schema:z.object({text:z.string()}),schemaName:'decision_'+role.id,
        jsonSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},systemPrompt:'Test',userPrompt:'Test',maxTokens:100,fetch:transport as typeof fetch});
      expect(transport).toHaveBeenCalledOnce();
      const calls=await holder.database.query<{model:string;status:string}>('SELECT model,status FROM ai_credit_calls WHERE source=$1',['decision_'+role.id]);
      expect(calls.rows).toEqual([{model:decisionModels[i].id,status:'settled'}]);
      expectedCost+=quoteAiCredits(extended,decisionModels[i],200,100);
    }
    const after=await holder.database.query<{balance:string}>('SELECT balance FROM ai_credit_wallets WHERE workspace_id=$1',[workspaceId]);
    expect(Number(before.rows[0].balance)-Number(after.rows[0].balance)).toBeCloseTo(expectedCost,6);
    await holder.database.query("UPDATE ai_platform_settings SET config=$1 WHERE id='global'",[JSON.stringify(config)]);
    await expect(requestDecisionJson('toolIntentGate',{workspaceId,schema:z.object({text:z.string()}),schemaName:'disabled_decision',jsonSchema:{},systemPrompt:'Test',userPrompt:'Test'})).rejects.toThrow('Modelo nao autorizado');
  });
  it('persists decision settings and rejects invalid model dependencies without changing saved data',async()=>{
    const settings=Object.fromEntries(AI_DECISION_MODEL_ROLES.map(role=>[role.id,{model:'openai/test',timeoutMs:3200}])) as any;
    expect(await saveAiDecisionModelConfigAction(settings)).toEqual({success:true});
    expect(await resolveAiDecisionModel('intentClassifier')).toBe('openai/test');
    const invalid={...settings,intentClassifier:{model:'deepseek/unregistered',timeoutMs:3200}};
    expect((await saveAiDecisionModelConfigAction(invalid)).success).toBe(false);
    expect(await resolveAiDecisionModel('intentClassifier')).toBe('openai/test');
    await expect(savePlatformAiSettingsAction({...config,defaultModel:'openai/new',models:[{...config.models[0],enabled:false},{...config.models[0],id:'openai/new'}]})).rejects.toThrow('Tool Intent Gate');
    const persisted=await holder.database.query<{config:PlatformAiConfig}>("SELECT config FROM ai_platform_settings WHERE id='global'");
    expect(persisted.rows[0].config.defaultModel).toBe('openai/test');
    await savePlatformAiSettingsAction({...config,models:[{...config.models[0],description:'Preserved description'}]});
    expect((await getPlatformAiSettingsAction()).config?.models[0].description).toBe('Preserved description');
  });
  it('loads the legacy catalog without rewriting or dropping registrations before setup',async()=>{
    const legacy=[{id:'deepseek/legacy',label:'Legacy label',description:'Original description',enabled:true,provider:'deepseek'}];
    await holder.database.query("INSERT INTO system_settings(key,value) VALUES('ai_model_catalog',$1)",[JSON.stringify(legacy)]);
    await holder.database.exec('BEGIN');
    try {
      // Hide the row in this isolated transaction to exercise pre-setup reads.
      await holder.database.exec('ALTER TABLE ai_platform_settings RENAME TO saved_settings; CREATE TABLE ai_platform_settings(id text,config jsonb);');
      const result=await getPlatformAiSettingsAction();
      expect(result.config).toBeNull();
      expect(result.legacyModels).toEqual(legacy);
      expect((await holder.database.query<{value:string}>("SELECT value FROM system_settings WHERE key='ai_model_catalog'")).rows[0].value).toBe(JSON.stringify(legacy));
    } finally { await holder.database.exec('ROLLBACK'); }
  });
});
