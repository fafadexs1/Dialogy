import { describe, expect, it } from 'vitest';

import { selectAutopilotConfigForRuntime } from '@/services/autopilot/config-selection';
import type { AutopilotConfig } from '@/lib/types';

function config(id: string, overrides: Partial<AutopilotConfig> = {}): AutopilotConfig {
  return {
    id,
    workspace_id: 'workspace-1',
    user_id: 'user-1',
    name: id,
    gemini_api_key: null,
    ai_model: null,
    transcription_model: null,
    knowledge_base: null,
    knowledge_base_documents: [],
    is_primary: false,
    is_active: true,
    is_private: false,
    default_fallback_reply: null,
    escalation_policy: null,
    closing_policy: null,
    enabled_tool_names: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('autopilot runtime config selection', () => {
  it('uses the explicitly assigned config instead of the primary config', () => {
    const selected = selectAutopilotConfigForRuntime([
      config('primary', { is_primary: true }),
      config('assigned'),
    ], 'assigned');

    expect(selected?.id).toBe('assigned');
  });

  it('does not fall back when an explicitly assigned config is missing', () => {
    const selected = selectAutopilotConfigForRuntime([
      config('primary', { is_primary: true }),
      config('other'),
    ], 'missing');

    expect(selected).toBeNull();
  });

  it('falls back to the public primary only when there is no explicit assignment', () => {
    const selected = selectAutopilotConfigForRuntime([
      config('private-primary', { is_primary: true, is_private: true }),
      config('public-primary', { is_primary: true }),
      config('other'),
    ]);

    expect(selected?.id).toBe('public-primary');
  });
});
