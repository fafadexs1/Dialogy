'use server';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getCurrentUser } from './user';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { PlatformAiConfigSchema, type PlatformAiConfig } from '@/lib/platform-ai';
import { readPlatformAiConfig, requirePlatformAiConfig, withPlatformAiSettingsTransaction } from '@/services/ai/platform-config';
import { addAiCredits, settleAiCredits, finishAiCreditCall } from '@/services/ai/credits';
import { getStripe } from '@/lib/stripe';
import { parseAiModelCatalog, SYSTEM_AI_MODEL_CATALOG_KEY } from '@/lib/ai-models';
import { getGlobalAiDecisionModelConfig } from '@/services/ai/decision-model-config';
import { assertDecisionModelsAvailable, parseAiDecisionModelConfig, SYSTEM_AI_DECISION_MODELS_KEY } from '@/lib/ai-decision-models';

async function admin() {
  const user = await getCurrentUser();
  if (!user || !(await db.query('SELECT is_superadmin FROM users WHERE id=$1', [user.id])).rows[0]?.is_superadmin) throw new Error('Acesso restrito ao superadmin.');
  return user;
}

async function workspace() {
  const user = await getCurrentUser();
  if (!user?.activeWorkspaceId || !await hasWorkspacePermission(user.id, user.activeWorkspaceId, 'billing:view')) throw new Error('Acesso negado ao faturamento.');
  return { user, workspaceId: user.activeWorkspaceId };
}

export async function getPlatformAiSettingsAction() {
  await admin();
  const [config, keys, workspaces, legacy, decisions] = await Promise.all([
    readPlatformAiConfig(),
    db.query('SELECT provider FROM ai_provider_credentials WHERE length(api_key)>0'),
    db.query('SELECT w.id,w.name,COALESCE(c.balance,0)::text AS balance,COALESCE(c.reserved,0)::text AS reserved FROM workspaces w LEFT JOIN ai_credit_wallets c ON c.workspace_id=w.id ORDER BY w.name'),
    db.query('SELECT value FROM public.system_settings WHERE key=$1', [SYSTEM_AI_MODEL_CATALOG_KEY]),
    getGlobalAiDecisionModelConfig(),
  ]);
  const legacyModels = legacy.rows[0]?.value ? parseAiModelCatalog(legacy.rows[0].value) : [];
  return { config, legacyModels, decisions, configuredProviders: keys.rows.map(r => String(r.provider)), workspaces: workspaces.rows as Array<{ id:string; name:string; balance:string; reserved:string }> };
}

export async function savePlatformAiSettingsAction(input: PlatformAiConfig) {
  await admin();
  const config = PlatformAiConfigSchema.parse(input);
  await withPlatformAiSettingsTransaction(async client => {
    const decisions = await client.query('SELECT value FROM public.system_settings WHERE key=$1', [SYSTEM_AI_DECISION_MODELS_KEY]);
    if (decisions.rows[0]?.value) assertDecisionModelsAvailable(parseAiDecisionModelConfig(decisions.rows[0].value), config.models);
    await client.query(`INSERT INTO ai_platform_settings(id,config) VALUES('global',$1) ON CONFLICT(id) DO UPDATE SET config=$1,updated_at=now()`, [JSON.stringify(config)]);
  });
  revalidatePath('/superadmin/ai-models');
  return { success: true };
}

export async function savePlatformAiKeyAction(provider: string, apiKey: string) {
  await admin();
  z.enum(['googleai','openai','deepseek']).parse(provider);
  const key = z.string().trim().min(10).max(4096).parse(apiKey);
  await db.query(`INSERT INTO ai_provider_credentials(provider,api_key) VALUES($1,$2) ON CONFLICT(provider) DO UPDATE SET api_key=$2,updated_at=now()`, [provider,key]);
  return { success: true };
}

export async function grantAiCreditsAction(input: { workspaceId:string; credits:number; reason:string; requestId:string }) {
  const user = await admin();
  z.object({ workspaceId:z.string().uuid(),credits:z.number().positive().max(1e9),reason:z.string().trim().min(3).max(300),requestId:z.string().uuid() }).parse(input);
  await addAiCredits({ workspaceId:input.workspaceId,credits:input.credits,reference:`grant:${input.requestId}`,description:input.reason,kind:'grant',createdBy:user.id });
  return { success: true };
}

export async function getAiCreditBalanceAction() {
  const { workspaceId } = await workspace();
  const [wallet, entries, config] = await Promise.all([
    db.query('SELECT balance::text,reserved::text FROM ai_credit_wallets WHERE workspace_id=$1',[workspaceId]),
    db.query('SELECT id,amount::text,kind,description,created_at FROM ai_credit_entries WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[workspaceId]),
    readPlatformAiConfig(),
  ]);
  return { workspaceId, balance:Number(wallet.rows[0]?.balance || 0),reserved:Number(wallet.rows[0]?.reserved || 0),creditValueBrl:config?.creditValueBrl ?? null,billingEnabled:config?.billingEnabled ?? false,
    entries:entries.rows.map(row => ({ id:String(row.id),amount:Number(row.amount),kind:String(row.kind),description:String(row.description),createdAt:new Date(row.created_at).toISOString() })) };
}

export async function getPendingAiCreditCallsAction() {
  await admin();
  const result=await db.query(`SELECT c.id,w.name AS workspace,c.model,c.source,c.reserved::text,c.created_at
    FROM ai_credit_calls c JOIN workspaces w ON w.id=c.workspace_id
    WHERE c.status='review' OR (c.status='reserved' AND c.created_at < now()-interval '30 minutes')
    ORDER BY c.created_at LIMIT 100`);
  return result.rows.map(r=>({id:String(r.id),workspace:String(r.workspace),model:String(r.model),source:String(r.source),reserved:Number(r.reserved),createdAt:new Date(r.created_at).toISOString()}));
}

export async function reconcileAiCreditCallAction(input:{id:string;outcome:'release'|'settle';inputTokens:number;outputTokens:number}) {
  const user=await admin();
  z.object({id:z.string().uuid(),outcome:z.enum(['release','settle']),inputTokens:z.number().int().nonnegative().max(10_000_000),outputTokens:z.number().int().nonnegative().max(10_000_000)}).parse(input);
  const call=await db.query("SELECT id FROM ai_credit_calls WHERE id=$1 AND (status='review' OR (status='reserved' AND created_at<now()-interval '30 minutes'))",[input.id]);
  if(!call.rowCount)throw new Error('Reserva em andamento ou ja conciliada.');
  if(input.outcome==='release')await finishAiCreditCall(input.id,false,user.id);
  else await settleAiCredits(input.id,input,user.id);
  return {success:true};
}

export async function createAiCreditCheckoutAction(credits: number) {
  const { user, workspaceId } = await workspace();
  if (!await hasWorkspacePermission(user.id,workspaceId,'workspace:settings:edit')) throw new Error('Sem permissao para recarregar.');
  z.number().int().min(1).max(1_000_000).parse(credits);
  const config = await requirePlatformAiConfig();
  const amount = Math.ceil(credits * config.creditValueBrl * 100);
  if (amount < 500 || amount > 99_999_999) throw new Error('A recarga deve ser de pelo menos R$ 5 e no maximo R$ 999.999,99.');
  const id = randomUUID();
  await db.query('INSERT INTO ai_credit_orders(id,workspace_id,credits,amount_cents) VALUES($1,$2,$3,$4)',[id,workspaceId,credits,amount]);
  const stripe = await getStripe();
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:9045').origin;
  const session = await stripe.checkout.sessions.create({ mode:'payment',client_reference_id:id,
    metadata:{ type:'ai_credits',orderId:id },
    line_items:[{ price_data:{ currency:'brl',unit_amount:amount,product_data:{ name:`${credits} creditos de IA Dialogy` } },quantity:1 }],
    success_url:`${origin}/settings/billing?credits=success`,cancel_url:`${origin}/settings/billing?credits=cancelled`,
  }, { idempotencyKey:`ai-credit-order:${id}` });
  await db.query('UPDATE ai_credit_orders SET stripe_session_id=$2 WHERE id=$1',[id,session.id]);
  return { url:session.url };
}
