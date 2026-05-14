import { describe, expect, it } from 'vitest';

import { resolveAutopilotIntent } from '@/services/autopilot-intent';
import { deriveToolPrearmSignal, buildToolPrearmContent } from '@/services/autopilot/tool-prearm';

describe('autopilot tool prearm', () => {
  it('prearms SGP lookup when support workflow is waiting for CPF', () => {
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'Nao resolveu',
      chatHistory: 'Cliente: Problemas de conexao',
    });

    const signal = deriveToolPrearmSignal({
      intentResolution,
      missingSlots: ['customer_identifier'],
      enabledToolNames: ['sgp_fetch_contact_panel_data', 'crm_update_contact_custom_fields'],
      reason: 'Workflow operacional precisa de identificador antes de consultar ferramenta.',
    });

    expect(signal).toMatchObject({
      toolName: 'sgp_fetch_contact_panel_data',
      status: 'prearmed',
      intent: 'troubleshooting',
      missingSlots: ['customer_identifier'],
    });
    expect(buildToolPrearmContent(signal!)).toContain('Tool pre-engatilhada: sgp_fetch_contact_panel_data');
  });

  it('does not prearm when no compatible tool is enabled', () => {
    const intentResolution = resolveAutopilotIntent({
      customerMessage: 'Preciso da segunda via do boleto',
    });

    const signal = deriveToolPrearmSignal({
      intentResolution,
      missingSlots: ['customer_identifier'],
      enabledToolNames: ['transfer_chat'],
    });

    expect(signal).toBeNull();
  });
});
