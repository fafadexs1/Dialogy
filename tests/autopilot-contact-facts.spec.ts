import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { query: vi.fn() },
}));

import { db } from '@/lib/db';
import { persistAutopilotContactFacts } from '@/services/autopilot/contact-facts';
import type { ExtractedSlotDetail } from '@/services/autopilot/slots';

function detail(
  name: ExtractedSlotDetail['name'],
  value: string,
): ExtractedSlotDetail {
  return { name, value, source: 'message', confidence: 0.9 };
}

describe('autopilot contact fact persistence', () => {
  beforeEach(() => vi.mocked(db.query).mockReset());

  it('persists only explicitly supplied safe core contact facts', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ id: 'contact' }], rowCount: 1 } as any);

    const result = await persistAutopilotContactFacts({
      workspaceId: 'workspace',
      contactId: 'contact',
      customerMessage: 'Meu nome é Ana; email ana@example.com; meu endereço é Rua Nova 99',
      details: [
        detail('name', 'Ana'),
        detail('email', 'ana@example.com'),
        detail('address', 'Rua Nova 99'),
      ],
    });

    expect(result).toEqual({ persisted: true, fields: ['name', 'email', 'address'] });
    expect(vi.mocked(db.query).mock.calls[0]?.[1]).toEqual([
      'contact',
      'workspace',
      'Ana',
      'ana@example.com',
      'Rua Nova 99',
    ]);
  });

  it('does not overwrite the core name from an unlabelled heuristic candidate', async () => {
    const result = await persistAutopilotContactFacts({
      workspaceId: 'workspace',
      contactId: 'contact',
      customerMessage: 'Ana 01310-100',
      details: [detail('name', 'Ana'), detail('address', 'CEP 01310-100')],
    });

    expect(result).toEqual({ persisted: true, fields: [] });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('does not replace a full core address with a CEP-only value', async () => {
    const result = await persistAutopilotContactFacts({
      workspaceId: 'workspace',
      contactId: 'contact',
      customerMessage: 'Meu CEP agora é 01310-100',
      details: [detail('address', 'CEP 01310-100')],
    });

    expect(result).toEqual({ persisted: true, fields: [] });
    expect(db.query).not.toHaveBeenCalled();
  });
});
