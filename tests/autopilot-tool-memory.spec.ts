import { describe, expect, it } from 'vitest';

import { buildToolContinuationContext } from '@/services/autopilot/runtime/tool-memory';

describe('autopilot tool continuation context', () => {
  it('adds strict customer-facing rules after operational tool results', () => {
    const context = buildToolContinuationContext([
      {
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
        output: {
          contracts: [{ id: '123', connectionStatus: 'offline' }],
        },
      },
    ]);

    expect(context).toContain('use exclusivamente fatos presentes nesses resultados');
    expect(context).toContain('Nunca invente');
    expect(context).toContain('Nao exponha JSON');
    expect(context).toContain('dd/MM/yyyy HH:mm');
  });
});
