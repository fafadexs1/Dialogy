import { describe, expect, it } from 'vitest';

import { buildWifiChannelAnalysisResponse } from '@/services/autopilot/wifi-channel-analysis';

describe('Wi-Fi channel analysis', () => {
  it('recommends a non-overlapping 2.4 GHz channel from structured scan evidence', () => {
    const response = buildWifiChannelAnalysisResponse({
      structuredContent: {
        source: 'live_router_scan',
        networks: [
          { band: '2.4 GHz', channel: '1', signal: '-42' },
          { band: '2.4 GHz', channel: '1', signal: '-63' },
          { band: '2.4 GHz', channel: '6', signal: '-55' },
          { band: '5 GHz', channel: '36', signal: '-51' },
        ],
      },
    });

    expect(response).toContain('canal 11');
    expect(response).toContain('Nenhuma configuracao foi alterada');
    expect(response).not.toContain('{');
  });

  it('parses legacy MCP JSON text and clearly labels cached evidence', () => {
    const response = buildWifiChannelAnalysisResponse({
      content: [{
        type: 'text',
        text: JSON.stringify({
          source: 'cached_wifi_scan',
          updated_at: '2026-06-28T00:00:00Z',
          networks: [{ band: '2.4 GHz', channel: 6, signal: -60 }],
        }),
      }],
    }, { isCached: true });

    expect(response).toContain('cache');
    expect(response).toContain('novo scan ao vivo');
    expect(response).toContain('canal');
  });

  it('does not invent congestion when the scan has no observations', () => {
    const response = buildWifiChannelAnalysisResponse({
      structuredContent: { source: 'cached_wifi_scan', networks: [] },
    });

    expect(response).toContain('nenhuma rede vizinha');
    expect(response).toContain('canal em automatico');
  });

  it('preserves a bounded evidence-bearing summary from a legacy text-only tool', () => {
    const response = buildWifiChannelAnalysisResponse({
      content: [{
        type: 'text',
        text: 'Foram encontradas 11 redes proximas no canal 6. Recomendacao: manter 5 GHz no canal 44.',
      }],
    });

    expect(response).toContain('canal 6');
    expect(response).toContain('Recomendacao');
    expect(response).toContain('Nenhuma configuracao foi alterada');
  });
});
