import { describe, expect, it } from 'vitest';

import { sanitizeAutopilotRules } from '@/services/autopilot/automation-rules';

describe('auto responder raw rules input', () => {
  it('keeps malformed legacy rows recoverable for sanitation before prompting', () => {
    const result = sanitizeAutopilotRules([
      { id: 'legacy-rule', action: { type: 'reply', payload: {} } },
      null,
      'invalid-row',
    ]);

    expect(result.rules).toEqual([]);
    expect(result.invalid).toHaveLength(3);
  });
});
