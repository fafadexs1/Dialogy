import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { query: vi.fn() },
}));

import { db } from '@/lib/db';
import {
  isContactIdentityVerificationToolName,
  loadRecentContactVerificationReceipts,
} from '@/services/autopilot/runtime/tool-memory';

describe('autopilot contact verification memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    'sgp_fetch_contracts',
    'sgp_fetch_contact_panel_data',
    'mcp:crm:get_customer_profile',
    'mcp:erp:buscar_cliente',
  ])('recognizes a conservative identity lookup: %s', (toolName) => {
    expect(isContactIdentityVerificationToolName(toolName)).toBe(true);
  });

  it.each([
    'sgp_generate_invoice_pix',
    'mcp:commerce:get_order_status',
    'mcp:router:reboot_router',
  ])('does not treat an unrelated or mutable operation as identity verification: %s', (toolName) => {
    expect(isContactIdentityVerificationToolName(toolName)).toBe(false);
  });

  it('loads successful receipts across chats for the same CRM contact without reusing tool output', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        {
          tool_name: 'sgp_fetch_contact_panel_data',
          chat_id: 'older-chat',
          created_at: '2026-07-12T12:00:00.000Z',
          output: { shouldNeverLeak: true },
        },
      ],
    } as any);

    const receipts = await loadRecentContactVerificationReceipts({
      workspaceId: 'workspace-1',
      contactId: 'contact-1',
      toolNames: ['sgp_fetch_contact_panel_data', 'sgp_generate_invoice_pix'],
      maxAgeDays: 30,
    });

    expect(receipts).toEqual([{
      toolName: 'sgp_fetch_contact_panel_data',
      chatId: 'older-chat',
      scope: 'contact_identity_context',
      verifiedAt: '2026-07-12T12:00:00.000Z',
      expiresAt: '2026-08-11T12:00:00.000Z',
      source: 'successful_tool_execution',
    }]);
    expect(JSON.stringify(receipts)).not.toContain('shouldNeverLeak');
    expect(vi.mocked(db.query).mock.calls[0]?.[0]).toContain('chat.contact_id = $2');
    expect(vi.mocked(db.query).mock.calls[0]?.[1]).toEqual([
      'workspace-1',
      'contact-1',
      ['sgp_fetch_contact_panel_data'],
      30,
      8,
    ]);
  });
});
