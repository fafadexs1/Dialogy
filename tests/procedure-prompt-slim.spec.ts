import { describe, expect, it } from 'vitest';

import type { AgentToolExecutionResult } from '@/services/agent-tools/types';
import {
  buildProcedureSlimChatHistory,
  compactProcedureText,
  compactProcedureToolResults,
} from '@/services/autopilot/procedure-prompt-slim';

describe('procedure prompt slim helpers', () => {
  it('keeps only recent chat history lines within the configured budget', () => {
    const history = Array.from({ length: 20 }, (_, index) => (
      `${index % 2 === 0 ? 'Cliente' : 'Atendente'}: mensagem ${index + 1}`
    )).join('\n');

    const slim = buildProcedureSlimChatHistory(history, {
      maxLines: 4,
      maxChars: 200,
    });

    expect(slim).toContain('mensagem 17');
    expect(slim).toContain('mensagem 20');
    expect(slim).not.toContain('mensagem 16');
    expect(slim.length).toBeLessThanOrEqual(200);
  });

  it('compacts persona text with a hard char limit', () => {
    const slim = compactProcedureText('a'.repeat(200), 40);

    expect(slim.length).toBeLessThanOrEqual(40);
    expect(slim.endsWith('...')).toBe(true);
  });

  it('compacts tool results without leaking huge raw payloads', () => {
    const result: AgentToolExecutionResult = {
      toolName: 'sgp_fetch_contact_panel_data',
      status: 'success',
      input: { type: 'sgp_fetch_contact_panel_data', payload: {} },
      output: {
        customerName: 'Cliente Teste',
        cpfCnpj: '52998224725',
        contracts: Array.from({ length: 20 }, (_, index) => ({
          id: `contract-${index + 1}`,
          planDescription: `Plano ${index + 1}`,
          connectionStatus: 'online',
          statusLabel: 'Ativo',
          addressLabel: 'Rua de Teste',
          giantField: 'x'.repeat(2000),
        })),
      },
    };

    const compacted = compactProcedureToolResults([result], {
      maxChars: 1200,
      maxOutputChars: 900,
    });

    const serialized = JSON.stringify(compacted);
    expect(serialized.length).toBeLessThanOrEqual(1200);
    expect(serialized).toContain('Cliente Teste');
    expect(serialized).toContain('contract-1');
    expect(serialized).not.toContain('giantField');
  });
});
