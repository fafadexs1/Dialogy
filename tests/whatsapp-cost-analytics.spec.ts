import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), permission: vi.fn(), query: vi.fn(), account: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/security/access', () => ({ requireWorkspacePermission: mocks.permission }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/services/whatsapp/studio-media', () => ({ getStudioCloudAccount: mocks.account }));
import { getWhatsappCostAnalytics } from '@/actions/whatsapp-cost-analytics';

describe('WhatsApp billing analytics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({data:{user:{id:'user'}}});
    mocks.permission.mockResolvedValue({});
    mocks.query.mockResolvedValueOnce({rows:[{last_active_workspace_id:'workspace'}]}).mockResolvedValueOnce({rows:[{type:'wa_cloud', instance_name:'one',display_name:'Oficial',phone_number_id:'123456789',api_url:'https://example.test',api_key:'secret'}, {type:'baileys'}]}).mockResolvedValueOnce({rows:[]});
    mocks.account.mockResolvedValue({businessId:'1234',token:'secret',phoneNumberId:'123456789'});
    mocks.fetch.mockResolvedValueOnce({ok:true,json:async()=>({data:[{id:'123456789',display_phone_number:'+55 11 99999-9999'}]})}).mockResolvedValueOnce({ok:true,json:async()=>({currency:'USD',pricing_analytics:{data:[{data_points:[{pricing_category:'UTILITY',volume:10,cost:0.2},{pricing_category:'SERVICE',volume:5}]}]}})});
    vi.stubGlobal('fetch', mocks.fetch);
  });
  it('requires billing permission and scopes Meta analytics to the connected number', async () => {
    const result=await getWhatsappCostAnalytics();
    expect(mocks.permission).toHaveBeenCalledWith('workspace','billing:view');
    const url=mocks.fetch.mock.calls[1][0] as URL;
    expect(url.searchParams.get('fields')).toContain('phone_numbers(["5511999999999"])');
    expect(result.unofficialConnections).toBe(1);
    expect(result.accounts[0].points).toEqual([{category:'UTILITY',volume:10,cost:0.2},{category:'SERVICE',volume:5,cost:null}]);
  });
  it('queries the selected calendar month rather than a rolling 30-day range', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T19:43:00Z'));
    try {
      const result = await getWhatsappCostAnalytics('previous');
      const fields = (mocks.fetch.mock.calls[1][0] as URL).searchParams.get('fields');
      expect(result.period.month).toBe('2026-09');
      expect(fields).toContain(`start(${Date.parse('2026-09-01T03:00:00Z') / 1000})`);
      expect(fields).toContain(`end(${Date.parse('2026-10-01T03:00:00Z') / 1000})`);
    } finally { vi.useRealTimers(); }
  });
  it('does not access providers without billing permission', async () => {
    mocks.permission.mockRejectedValue(new Error('Denied'));
    await expect(getWhatsappCostAnalytics()).rejects.toThrow();
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it('does not query a different phone if the connection identifiers diverge', async () => {
    mocks.account.mockResolvedValue({businessId:'1234',token:'secret',phoneNumberId:'987654321'});
    const result=await getWhatsappCostAnalytics();
    expect(result.accounts[0].error).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('does not fall back to all WABA numbers if the number is missing', async () => {
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValueOnce({ok:true,json:async()=>({data:[]})});
    const result=await getWhatsappCostAnalytics();
    expect(result.accounts[0].error).toContain('identificar automaticamente');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not report partial data as complete', async () => {
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValueOnce({ok:true,json:async()=>({data:[{id:'123456789',display_phone_number:'+55 11 99999-9999'}]})}).mockResolvedValueOnce({ok:true,json:async()=>({currency:'USD',pricing_analytics:{data:[],paging:{next:'https://example.test'}}})});
    const result=await getWhatsappCostAnalytics();
    expect(result.accounts[0].error).toBeTruthy();
    expect(result.accounts[0].points).toEqual([]);
  });
});

