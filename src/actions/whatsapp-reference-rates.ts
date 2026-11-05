'use server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
const categories = ['MARKETING','MARKETING_LITE','UTILITY','SERVICE','AUTHENTICATION','AUTHENTICATION_INTERNATIONAL'] as const;
async function admin() {
  const {data:{user}}=await (await createClient()).auth.getUser();
  if (!user || !(await db.query('SELECT is_superadmin FROM users WHERE id=$1',[user.id])).rows[0]?.is_superadmin) throw new Error('Acesso restrito ao superadmin.');
  return user.id;
}
export async function getWhatsappReferenceRates() {
  await admin();
  const result = await db.query('SELECT category,currency,rate::float8 AS rate FROM whatsapp_reference_rates ORDER BY category');
  return result.rows as Array<{category:string;currency:string;rate:number}>;
}
export async function saveWhatsappReferenceRates(input: {currency:string; rates: Record<string,number|null>}) {
  const userId=await admin();
  const parsed=z.object({currency:z.string().regex(/^[A-Z]{3}$/),rates:z.record(z.string(),z.number().finite().min(0).max(1000000).nullable())}).parse(input);
  if (Object.keys(parsed.rates).some(category => !categories.includes(category as typeof categories[number]))) throw new Error('Categoria inválida.');
  const client=await db.connect();
  try { await client.query('BEGIN'); for (const category of categories) { const rate=parsed.rates[category]; if (rate == null) await client.query('DELETE FROM whatsapp_reference_rates WHERE category=$1',[category]); else await client.query(`INSERT INTO whatsapp_reference_rates(category,currency,rate,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(category) DO UPDATE SET currency=EXCLUDED.currency,rate=EXCLUDED.rate,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()`,[category,parsed.currency,rate,userId]); } await client.query('COMMIT'); }
  catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  return {success:true};
}
