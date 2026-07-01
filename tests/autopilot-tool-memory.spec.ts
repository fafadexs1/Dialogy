import { describe, expect, it } from 'vitest';

import {
  buildMcpResponseFromToolResults,
  buildToolContinuationContext,
} from '@/services/autopilot/runtime/tool-memory';

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

  it('formats structured MCP results as readable text instead of raw JSON', () => {
    const response = buildMcpResponseFromToolResults([
      {
        toolName: 'mcp:canary:schedule_pickup',
        status: 'success',
        input: {
          type: 'mcp_call_tool',
          payload: {
            toolName: 'mcp:canary:schedule_pickup',
            arguments: { package_code: 'CX-77', pickup_window: '14h as 18h' },
          },
        },
        output: {
          content: [{
            type: 'text',
            text: '{"status":"coleta agendada","package_code":"CX-77","protocol":"CANARY-CX-77"}',
          }],
          structuredContent: {
            status: 'coleta agendada',
            package_code: 'CX-77',
            protocol: 'CANARY-CX-77',
          },
        },
      },
    ]);

    expect(response).toContain('Status: coleta agendada');
    expect(response).toContain('Codigo do pacote: CX-77');
    expect(response).toContain('Protocolo: CANARY-CX-77');
    expect(response).not.toContain('{"');
  });
});
