import 'server-only';
import { z } from 'zod';
import { loadWorkspaceGoogleAdsContext, searchGoogleAds } from '@/services/google-ads/api-client';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((date) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
});
export const GoogleAdsReportArguments = z.object({ startDate: isoDate, endDate: isoDate }).strict();
export const googleAdsReportJsonSchema = { type: 'object', properties: { startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, required: ['startDate', 'endDate'], additionalProperties: false };

/** A fixed, bounded read-only report; the model never supplies GAQL or credentials. */
export async function googleAdsCampaignReport(workspaceId: string, args: unknown, signal: AbortSignal) {
  const { startDate, endDate } = GoogleAdsReportArguments.parse(args);
  const start = Date.parse(`${startDate}T00:00:00Z`), end = Date.parse(`${endDate}T00:00:00Z`);
  if (end < start || end - start > 30 * 86400000) throw new Error('Use um período de até 31 dias, com início anterior ao fim.');
  signal.throwIfAborted();
  const context = await loadWorkspaceGoogleAdsContext(workspaceId);
  if (!context.customerId) throw new Error('Conecte uma conta Google Ads ao workspace.');
  const rows = await searchGoogleAds({ credentials: context.credentials, customerId: context.customerId, loginCustomerId: context.loginCustomerId,
    query: `SELECT campaign.id, campaign.name, campaign.status, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}' LIMIT 500`, maxPages: 1 });
  signal.throwIfAborted();
  return { startDate, endDate, customerId: context.customerId, rows, truncated: rows.length >= 500, timezone: 'Fuso horário da conta Google Ads' };
}
