import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { runCrmUpdateContactCustomFieldsTool } from '@/services/agent-tools/crm-tools';

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(),
  },
}));

describe('crm_update_contact_custom_fields tool', () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset();
  });

  it('saves custom fields on every equivalent customer contact, not only the current chat contact', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({
        rows: [{ id: 'contact-primary' }, { id: 'contact-related' }],
      } as any)
      .mockResolvedValueOnce({
        rows: [{ id: 'field-cpf', label: 'CPF', type: 'text' }],
      } as any)
      .mockResolvedValue({ rows: [] } as any);

    const result = await runCrmUpdateContactCustomFieldsTool(
      {
        workspaceId: 'workspace-1',
        chat: { id: 'chat-1' },
        contact: { id: 'contact-primary' },
      } as any,
      {
        type: 'crm_update_contact_custom_fields',
        payload: { fields: { CPF: '52998224725' } },
      }
    );

    expect(result.status).toBe('success');
    expect(result.output).toMatchObject({
      contactId: 'contact-primary',
      contactIds: ['contact-primary', 'contact-related'],
    });

    const upsertCalls = vi.mocked(db.query).mock.calls.filter(([query]) =>
      String(query).includes('INSERT INTO public.contact_custom_field_values')
    );

    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls.map(([, params]) => params)).toEqual([
      ['contact-primary', 'field-cpf', '52998224725'],
      ['contact-related', 'field-cpf', '52998224725'],
    ]);
  });
});
