import { describe, expect, it } from 'vitest';

import { buildAuditedAgentToolInput } from '@/services/agent-tools/audit';
import { fingerprintAuditedToolOperation } from '@/services/agent-tools/action-fingerprint';

describe('agent tool audit input', () => {
  it('redacts customer identity while retaining a deterministic operation fingerprint', () => {
    const action = {
      type: 'sgp_fetch_contact_panel_data' as const,
      payload: { customerIdentifier: '52998224725' },
    };
    const audited = buildAuditedAgentToolInput(action) as Record<string, any>;

    expect(JSON.stringify(audited)).not.toContain('52998224725');
    expect(audited.payload.customerIdentifier).toBe('[cpf-redacted]');
    expect(audited.operationFingerprint).toBe(fingerprintAuditedToolOperation(action));
    expect(audited.operationFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
