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
