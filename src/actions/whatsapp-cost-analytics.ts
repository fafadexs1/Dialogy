'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { requireWorkspacePermission } from '@/lib/security/access';
import { getStudioCloudAccount } from '@/services/whatsapp/studio-media';
import { resolveWhatsappCostPeriod, type WhatsappCostPeriod } from '@/lib/whatsapp/cost-period';

export type MetaCostPoint = { category: string; volume: number; cost: number | null };
export type MetaCostConnection = { name: string; currency: string | null; points: MetaCostPoint[]; error?: string };

export async function getWhatsappCostAnalytics(selection: WhatsappCostPeriod = 'current'): Promise<{ accounts: MetaCostConnection[]; unofficialConnections: number; referenceRates: Array<{category:string; currency:string; rate:number}>; period: ReturnType<typeof resolveWhatsappCostPeriod> }> {
  if (typeof selection !== 'string') throw new Error('Escolha um mês válido.');
  const period = resolveWhatsappCostPeriod(selection);
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) throw new Error('Faça login para consultar o consumo.');
  const workspace = await db.query('SELECT last_active_workspace_id FROM users WHERE id = $1', [user.id]);
  const workspaceId = workspace.rows[0]?.last_active_workspace_id;
  if (!workspaceId) throw new Error('Workspace não encontrado.');
  await requireWorkspacePermission(workspaceId, 'billing:view');
  const { rows } = await db.query(`SELECT i.instance_name, i.display_name, i.phone_number_id, i.type, c.api_url, c.api_key
    FROM evolution_api_instances i LEFT JOIN whatsapp_clusters c ON c.id=i.cluster_id WHERE i.workspace_id=$1 AND i.type IN ('wa_cloud','baileys')`, [workspaceId]);
  const unofficialConnections = rows.filter(i => i.type === 'baileys').length;
  const accounts = await Promise.all(rows.filter(i => i.type === 'wa_cloud').map(async (instance): Promise<MetaCostConnection> => {
    const name = String(instance.display_name || instance.instance_name);
    try {
      if (!instance.api_url || !instance.api_key) throw new Error('Configuração da conexão indisponível.');
      const account = await getStudioCloudAccount({ api_url: instance.api_url, api_key: instance.api_key }, instance.instance_name);
      const { start, end } = period;
      const version = /^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION || '') ? process.env.META_GRAPH_API_VERSION : 'v25.0';
      const storedId = String(instance.phone_number_id || '');
      if (storedId && account.phoneNumberId && storedId !== account.phoneNumberId) throw new Error('A conexão e a Meta informaram identificadores diferentes.');
      const phoneId = account.phoneNumberId || storedId;
      if (!/^\d+$/.test(phoneId)) throw new Error('Não foi possível identificar automaticamente o número da conexão.');
      const phoneUrl = new URL(`https://graph.facebook.com/${version}/${account.businessId}/phone_numbers`);
      phoneUrl.searchParams.set('fields', 'id,display_phone_number');
      phoneUrl.searchParams.set('limit', '100');
      let phone = '';
      const seen = new Set<string>();
      for (let page = 0; page < 20; page++) {
        const response = await fetch(phoneUrl, { headers: { Authorization: `Bearer ${account.token}` }, signal: AbortSignal.timeout(12000), cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || payload.error || !Array.isArray(payload.data)) throw new Error('Não foi possível consultar os números da conta Meta.');
        const match = payload.data.find((item: {id?: string}) => item.id === phoneId);
        if (match) { phone = String(match.display_phone_number || '').replace(/\D/g, ''); break; }
        if (!payload.paging?.next) break;
        const after = payload.paging?.cursors?.after;
        if (typeof after !== 'string' || !after || seen.has(after)) throw new Error('A Meta retornou uma lista de números incompleta.');
        seen.add(after);
        phoneUrl.searchParams.set('after', after);
      }
      if (!/^\d{7,15}$/.test(phone)) throw new Error('Não foi possível identificar automaticamente o número da conexão.');
      const url = new URL(`https://graph.facebook.com/${version}/${account.businessId}`);
      url.searchParams.set('fields', `currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY).phone_numbers(["${phone}"]).dimensions(PRICING_CATEGORY)`);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${account.token}` }, signal: AbortSignal.timeout(20000), cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error('A Meta não disponibilizou os dados desta conta.');
      const analytics = payload.pricing_analytics;
      if (!analytics) return { name, currency: typeof payload.currency === 'string' ? payload.currency : null, points: [] };
      if (!Array.isArray(analytics.data) || analytics.paging?.next) throw new Error('A Meta retornou uma página incompleta de dados.');
      const points: MetaCostPoint[] = [];
      for (const page of analytics.data) {
        if (!Array.isArray(page.data_points) || page.paging?.next) throw new Error('A Meta retornou uma página incompleta de dados.');
        for (const point of page.data_points) {
          if (typeof point.pricing_category !== 'string' || typeof point.volume !== 'number') throw new Error('A Meta retornou dados de consumo incompletos.');
          points.push({ category: point.pricing_category, volume: point.volume, cost: typeof point.cost === 'number' ? point.cost : null });
        }
      }
      return { name, currency: typeof payload.currency === 'string' ? payload.currency : null, points };
    } catch (error) {
      return { name, currency: null, points: [], error: error instanceof Error && (error.message.startsWith('Não foi possível identificar') || error.message.startsWith('A conexão e a Meta')) ? error.message : 'Não foi possível consultar os dados oficiais desta conta.' };
    }
  }));
  const rates = await db.query('SELECT category,currency,rate::float8 AS rate FROM whatsapp_reference_rates ORDER BY category');
  return { accounts, unofficialConnections, referenceRates: rates.rows, period };
}
