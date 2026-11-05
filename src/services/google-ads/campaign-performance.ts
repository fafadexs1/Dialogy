import { db } from '@/lib/db';

import { fetchCampaignCosts, loadWorkspaceGoogleAdsContext, GoogleAdsApiError } from './api-client';

export type CampaignPerformanceRow = {
  campaignId: string;
  campaignName: string;
  cost: number;
  impressions: number;
  clicks: number;
  trackedClicks: number;
  conversations: number;
  wonDeals: number;
  revenue: number;
  costPerConversation: number | null;
  costPerAcquisition: number | null;
  roas: number | null;
};

export type CampaignPerformanceReport = {
  currencyCode: string;
  startDate: string;
  endDate: string;
  rows: CampaignPerformanceRow[];
  totals: {
    cost: number;
    conversations: number;
    wonDeals: number;
    revenue: number;
    roas: number | null;
    costPerAcquisition: number | null;
  };
  costUnavailableReason?: string;
};

type FunnelRow = {
  campaign_id: string;
  campaign_name: string | null;
  tracked_clicks: string | number;
  conversations: string | number;
  won_deals: string | number;
  revenue: string | number;
};

const NO_CAMPAIGN = 'sem_campanha';

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Lado do Dialogy: quantos cliques viraram conversa, quantas conversas viraram
 * negocio ganho e quanto isso rendeu, por campanha.
 *
 * A receita e apurada por contato distinto. Um contato atribuido a duas
 * campanhas aparece nas duas — atribuicao multi-touch e escolha de negocio, nao
 * algo que o banco decida sozinho.
 */
async function loadFunnelByCampaign(
  workspaceId: string,
  startDate: string,
  endDate: string
): Promise<FunnelRow[]> {
  const hasDeals = await db.query(`SELECT to_regclass('public.deals') AS table_name`);
  const dealsAvailable = Boolean(hasDeals.rows[0]?.table_name);

  const revenueCte = dealsAvailable
    ? `
      revenue AS (
        SELECT
          cc.campaign_id,
          COUNT(DISTINCT d.id) AS won_deals,
          COALESCE(SUM(d.value), 0) AS revenue
        FROM campaign_contacts cc
        JOIN deals d ON d.contact_id = cc.contact_id::uuid
        WHERE d.workspace_id = $1::uuid
          AND d.won = true
        GROUP BY cc.campaign_id
      )`
    : `
      revenue AS (
        SELECT NULL::text AS campaign_id, 0::bigint AS won_deals, 0::numeric AS revenue
        WHERE false
      )`;

  const result = await db.query(
    `
    WITH scoped_clicks AS (
      SELECT
        ac.id,
        COALESCE(NULLIF(ac.campaign_id, ''), '${NO_CAMPAIGN}') AS campaign_id,
        ac.campaign
      FROM ad_clicks ac
      WHERE ac.workspace_id = $1
        AND ac.clicked_at >= $2::timestamptz
        AND ac.clicked_at < ($3::timestamptz + interval '1 day')
    ),
    attributions AS (
      SELECT sc.campaign_id, aa.id AS attribution_id, aa.contact_id
      FROM scoped_clicks sc
      JOIN ad_attributions aa ON aa.ad_click_id = sc.id
    ),
    campaign_contacts AS (
      SELECT DISTINCT campaign_id, contact_id FROM attributions
    ),
    ${revenueCte},
    totals AS (
      SELECT campaign_id, COUNT(*) AS tracked_clicks, MAX(campaign) AS campaign_name
      FROM scoped_clicks
      GROUP BY campaign_id
    ),
    conversations AS (
      SELECT campaign_id, COUNT(DISTINCT attribution_id) AS conversations
      FROM attributions
      GROUP BY campaign_id
    )
    SELECT
      t.campaign_id,
      t.campaign_name,
      t.tracked_clicks,
      COALESCE(c.conversations, 0) AS conversations,
      COALESCE(r.won_deals, 0) AS won_deals,
      COALESCE(r.revenue, 0) AS revenue
    FROM totals t
    LEFT JOIN conversations c ON c.campaign_id = t.campaign_id
    LEFT JOIN revenue r ON r.campaign_id = t.campaign_id
    `,
    [workspaceId, startDate, endDate]
  );

  return result.rows as FunnelRow[];
}

/**
 * Junta o custo que so o Google conhece com a receita que so o Dialogy conhece.
 * Sem as duas pontas nao existe CAC nem ROAS reais.
 */
export async function getCampaignPerformance(params: {
  workspaceId: string;
  startDate: string;
  endDate: string;
}): Promise<CampaignPerformanceReport> {
  const funnelRows = await loadFunnelByCampaign(params.workspaceId, params.startDate, params.endDate);

  let costByCampaign = new Map<string, { cost: number; impressions: number; clicks: number; name: string }>();
  let currencyCode = 'BRL';
  let costUnavailableReason: string | undefined;

  try {
    const context = await loadWorkspaceGoogleAdsContext(params.workspaceId);
    if (!context.customerId) {
      costUnavailableReason = 'Conta do Google Ads ainda nao selecionada.';
    } else {
      const costs = await fetchCampaignCosts({
        credentials: context.credentials,
        customerId: context.customerId,
        loginCustomerId: context.loginCustomerId,
        startDate: params.startDate,
        endDate: params.endDate,
      });

      currencyCode = costs[0]?.currencyCode || 'BRL';
      costByCampaign = new Map(
        costs.map((row) => [
          row.campaignId,
          { cost: row.cost, impressions: row.impressions, clicks: row.clicks, name: row.campaignName },
        ])
      );
    }
  } catch (error) {
    // O funil continua util mesmo sem custo: nao derruba o relatorio inteiro.
    costUnavailableReason =
      error instanceof GoogleAdsApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Falha ao consultar o Google Ads.';
  }

  const campaignIds = new Set<string>([
    ...funnelRows.map((row) => row.campaign_id),
    ...costByCampaign.keys(),
  ]);

  const rows: CampaignPerformanceRow[] = Array.from(campaignIds).map((campaignId) => {
    const funnel = funnelRows.find((row) => row.campaign_id === campaignId);
    const cost = costByCampaign.get(campaignId);

    const conversations = Number(funnel?.conversations || 0);
    const wonDeals = Number(funnel?.won_deals || 0);
    const revenue = Number(funnel?.revenue || 0);
    const spend = cost?.cost ?? 0;

    return {
      campaignId,
      campaignName: cost?.name || funnel?.campaign_name || (campaignId === NO_CAMPAIGN ? 'Sem campanha' : campaignId),
      cost: spend,
      impressions: cost?.impressions ?? 0,
      clicks: cost?.clicks ?? 0,
      trackedClicks: Number(funnel?.tracked_clicks || 0),
      conversations,
      wonDeals,
      revenue,
      costPerConversation: ratio(spend, conversations),
      costPerAcquisition: ratio(spend, wonDeals),
      roas: ratio(revenue, spend),
    };
  });

  rows.sort((left, right) => right.cost - left.cost || right.revenue - left.revenue);

  const totals = rows.reduce(
    (accumulator, row) => ({
      cost: accumulator.cost + row.cost,
      conversations: accumulator.conversations + row.conversations,
      wonDeals: accumulator.wonDeals + row.wonDeals,
      revenue: accumulator.revenue + row.revenue,
    }),
    { cost: 0, conversations: 0, wonDeals: 0, revenue: 0 }
  );

  return {
    currencyCode,
    startDate: params.startDate,
    endDate: params.endDate,
    rows,
    totals: {
      ...totals,
      roas: ratio(totals.revenue, totals.cost),
      costPerAcquisition: ratio(totals.cost, totals.wonDeals),
    },
    costUnavailableReason,
  };
}
