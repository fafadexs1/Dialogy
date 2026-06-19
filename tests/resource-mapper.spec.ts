import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import { mapAgentToolActionsToResources } from '@/services/resource-mapper/agent-tool-actions';
import { mapCrmContactCustomFields } from '@/services/resource-mapper/crm-contact-custom-fields';
import { extractAutopilotSlots } from '@/services/autopilot/slots';
import type { Contact } from '@/lib/types';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

const fieldRows = [
  { id: 'field-cpf', label: 'CPF/CNPJ', type: 'text', placeholder: null, options: null },
  { id: 'field-name', label: 'Nome completo', type: 'text', placeholder: null, options: null },
  { id: 'field-phone', label: 'Telefone', type: 'phone', placeholder: null, options: null },
  { id: 'field-interest', label: 'Interesse do cliente', type: 'text', placeholder: null, options: null },
];

const contact = {
  id: 'contact-1',
  workspace_id: 'workspace-1',
  name: '',
  phone: '5561995215930',
  phone_number_jid: '5561995215930@s.whatsapp.net',
} satisfies Contact;

describe('resource mapper', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
    vi.mocked(db.query).mockResolvedValue({ rows: fieldRows } as any);
  });

  it('maps model CRM labels to concrete workspace field ids', async () => {
    const result = await mapCrmContactCustomFields({
      workspaceId: 'workspace-1',
      customerMessage: 'Meu CPF e 529.982.247-25',
      contact,
      fields: {
        CPF: '52998224725',
        Telefone: '(61) 99521-5930',
      },
    });

    expect(result.status).toBe('partial');
    expect(result.mappedAction?.payload?.fields).toMatchObject({
      'field-cpf': '52998224725',
      'field-phone': '5561995215930',
    });
    expect(result.mappings.map((mapping) => mapping.fieldLabel)).toEqual(['CPF/CNPJ', 'Telefone']);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.payloadHash).toMatch(/^sha256:/);
  });

  it('uses workspace resource mapping profile aliases for CRM fields', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({
        rows: [
          { id: 'field-documento-erp', label: 'Codigo externo', type: 'text', placeholder: null, options: null },
        ],
      } as any)
      .mockResolvedValueOnce({
        rows: [{
          field_aliases_json: {
            'field-documento-erp': ['cpf', 'documento do cliente'],
          },
        }],
      } as any);

    const result = await mapCrmContactCustomFields({
      workspaceId: 'workspace-1',
      customerMessage: 'Atualizar cadastro.',
      fields: {
        CPF: '52998224725',
      },
    });

    expect(result.status).toBe('mapped');
    expect(result.mappedAction?.payload?.fields).toEqual({
      'field-documento-erp': '52998224725',
    });
    expect(result.mappings[0]).toMatchObject({
      fieldId: 'field-documento-erp',
      fieldLabel: 'Codigo externo',
    });
  });

  it('keeps mapping by native field labels when profile table is not migrated yet', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: fieldRows } as any)
      .mockRejectedValueOnce(new Error('relation "resource_mapping_profiles" does not exist'));

    const result = await mapCrmContactCustomFields({
      workspaceId: 'workspace-1',
      customerMessage: 'Atualizar cadastro.',
      fields: {
        CPF: '52998224725',
      },
    });

    expect(result.mappedAction?.payload?.fields).toMatchObject({
      'field-cpf': '52998224725',
    });
    expect(result.status).toBe('mapped');
  });

  it('infers CRM update actions from extracted slots when the model omits the action', async () => {
    const slotExtraction = extractAutopilotSlots({
      customerMessage: 'Meu nome completo e Fabricio de Sousa Soares. Quero contratar consultoria premium. Meu telefone e o mesmo que estou falando contigo.',
      contact,
    });

    const result = await mapAgentToolActionsToResources({
      workspaceId: 'workspace-1',
      customerMessage: 'Meu nome completo e Fabricio de Sousa Soares. Quero contratar consultoria premium. Meu telefone e o mesmo que estou falando contigo.',
      contact,
      slotExtraction,
      actions: [],
      enabledToolNames: ['crm_update_contact_custom_fields'],
      inferCrmUpdateFromSlots: true,
    });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      type: 'crm_update_contact_custom_fields',
      payload: {
        fields: {
          'field-name': 'Fabricio de Sousa Soares',
          'field-phone': '5561995215930',
          'field-interest': 'contratar consultoria premium',
        },
      },
    });
    expect(result.mappings[0].status).toBe('mapped');
  });

  it('records resource mapping ledger when chat context is available', async () => {
    const slotExtraction = extractAutopilotSlots({
      customerMessage: 'Meu CPF e 529.982.247-25',
      contact,
    });

    await mapAgentToolActionsToResources({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      procedureExecutionId: 'procedure-session-1',
      customerMessage: 'Meu CPF e 529.982.247-25',
      contact,
      slotExtraction,
      actions: [
        {
          type: 'crm_update_contact_custom_fields',
          reason: 'Salvar CPF.',
          payload: { fields: { CPF: '52998224725' } },
        },
      ],
      enabledToolNames: ['crm_update_contact_custom_fields'],
    });

    const ledgerCall = vi.mocked(db.query).mock.calls.find(([query]) => (
      String(query).includes('INSERT INTO resource_mapping_ledger')
    ));
    expect(ledgerCall).toBeTruthy();
    expect(String(ledgerCall?.[0])).toContain('orchestrator_run_id');
    expect(String(ledgerCall?.[0])).toContain('procedure_session_id');
    expect(ledgerCall?.[1]?.[4]).toBe('procedure-session-1');
  });

  it('does not create a payload when no real CRM field matches the requested data', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ id: 'field-random', label: 'Observacao interna', type: 'text', placeholder: null, options: null }],
    } as any);

    const result = await mapCrmContactCustomFields({
      workspaceId: 'workspace-1',
      customerMessage: 'Meu CPF e 529.982.247-25',
      contact,
      fields: {
        senha_wifi: '12345678',
      },
    });

    expect(result.status).toBe('unmapped');
    expect(result.mappedAction).toBeNull();
    expect(result.rejected[0]?.reason).toContain('Nenhum campo de CRM');
  });
});
