import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { quoteAiCredits, type PlatformAiConfig, type PlatformAiModel } from '@/lib/platform-ai';

async function transaction<T>(run: (client: import('pg').PoolClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function addAiCredits(input: {
  workspaceId: string; credits: number; reference: string; description: string;
  kind: 'grant' | 'purchase' | 'refund'; createdBy?: string;
}) {
  if (!Number.isFinite(input.credits) || input.credits <= 0 || input.credits > 1e9 || Math.round(input.credits*1e6)/1e6!==input.credits) throw new Error('Quantidade de creditos invalida.');
  return transaction(async client => {
    await client.query('INSERT INTO ai_credit_wallets(workspace_id) VALUES($1) ON CONFLICT DO NOTHING', [input.workspaceId]);
    await client.query('SELECT workspace_id FROM ai_credit_wallets WHERE workspace_id=$1 FOR UPDATE', [input.workspaceId]);
    const entry = await client.query(`INSERT INTO ai_credit_entries(id,workspace_id,reference,kind,amount,description,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(reference) DO NOTHING RETURNING id`,
    [randomUUID(), input.workspaceId, input.reference, input.kind, input.credits, input.description, input.createdBy || null]);
    if (!entry.rowCount) {
      const existing=await client.query('SELECT workspace_id,amount,kind FROM ai_credit_entries WHERE reference=$1',[input.reference]);
      const row=existing.rows[0];
      if(!row || row.workspace_id!==input.workspaceId || Number(row.amount)!==input.credits || row.kind!==input.kind) throw new Error('Referencia de recarga ja utilizada com outros dados.');
      return false;
    }
    await client.query('UPDATE ai_credit_wallets SET balance=balance+$2, updated_at=now() WHERE workspace_id=$1', [input.workspaceId, input.credits]);
    return true;
  });
}

export async function reserveAiCredits(input: {
  workspaceId: string; source: string; config: PlatformAiConfig; model: PlatformAiModel; inputTokens: number; outputTokens: number;
}) {
  const amount = quoteAiCredits(input.config, input.model, input.inputTokens, input.outputTokens);
  const id = randomUUID();
  await transaction(async client => {
    await client.query('INSERT INTO ai_credit_wallets(workspace_id) VALUES($1) ON CONFLICT DO NOTHING', [input.workspaceId]);
    const wallet = await client.query(`UPDATE ai_credit_wallets SET reserved=reserved+$2,updated_at=now()
      WHERE workspace_id=$1 AND balance-reserved >= $2 RETURNING workspace_id`, [input.workspaceId, amount]);
    if (!wallet.rowCount) throw new Error('Creditos de IA insuficientes. Recarregue o saldo em Faturamento.');
    await client.query(`INSERT INTO ai_credit_calls(id,workspace_id,model,source,reserved,status,pricing)
      VALUES($1,$2,$3,$4,$5,'reserved',$6)`, [id,input.workspaceId,input.model.id,input.source,amount,JSON.stringify({ config: input.config, model: input.model })]);
  });
  return id;
}

export async function settleAiCredits(id: string, usage: { inputTokens: number; outputTokens: number }, actorId?:string) {
  await transaction(async client => {
    const result = await client.query('SELECT * FROM ai_credit_calls WHERE id=$1 FOR UPDATE', [id]);
    const call = result.rows[0];
    if (!call || !['reserved','review'].includes(call.status)) return;
    const amount = quoteAiCredits(call.pricing.config,call.pricing.model,usage.inputTokens,usage.outputTokens);
    // Actual provider usage is authoritative, including reasoning tokens. A rare
    // estimate overrun becomes debt and blocks subsequent calls; it is never lost.
    await client.query(`UPDATE ai_credit_wallets SET balance=balance-$2,reserved=reserved-$3,updated_at=now() WHERE workspace_id=$1`, [call.workspace_id,amount,call.reserved]);
    await client.query(`INSERT INTO ai_credit_entries(id,workspace_id,reference,kind,amount,description,metadata)
      VALUES($1,$2,$3,'usage',$4,$5,$6)`, [randomUUID(),call.workspace_id,`call:${id}`,-amount,call.source,JSON.stringify({ model:call.model,...usage,pricing:call.pricing })]);
    await client.query(`UPDATE ai_credit_calls SET status='settled',input_tokens=$2,output_tokens=$3,resolved_by=$4,updated_at=now() WHERE id=$1`, [id,usage.inputTokens,usage.outputTokens,actorId||null]);
  });
}

export async function finishAiCreditCall(id: string, uncertain: boolean, actorId?:string) {
  await transaction(async client => {
    const result = await client.query('SELECT * FROM ai_credit_calls WHERE id=$1 FOR UPDATE', [id]);
    const call = result.rows[0];
    if (!call || !['reserved','review'].includes(call.status)) return;
    if (!uncertain) await client.query('UPDATE ai_credit_wallets SET reserved=reserved-$2,updated_at=now() WHERE workspace_id=$1', [call.workspace_id,call.reserved]);
    await client.query('UPDATE ai_credit_calls SET status=$2,resolved_by=$3,updated_at=now() WHERE id=$1', [id,uncertain ? 'review' : 'released',actorId||null]);
  });
}
