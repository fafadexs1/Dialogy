import { describe, expect, it } from 'vitest';

import { importLegacyNexusFlow } from '@/modules/nexus/services/legacy-import';
import { NEXUSFLOW_LEGACY_BLOCK_PARITY, nexusParitySummary } from '@/modules/nexus/services/parity-matrix';
import { createDefaultNodeHandlerRegistry, getWorkflowNodeManifest } from '@/services/workflow-runtime';

const model = {
  provider: 'google' as const,
  model: 'gemini-2.5-flash',
  temperature: 0.2,
  maxOutputTokens: 2048,
  supportsTools: true,
  supportsStructuredOutput: true,
  supportsStreaming: true,
  timeoutMs: 60_000,
  maxRetries: 2,
};

describe('NexusFlow parity matrix', () => {
  it('accounts for all 51 saved NodeTypes, including the four historical Supabase blocks', () => {
    expect(NEXUSFLOW_LEGACY_BLOCK_PARITY).toHaveLength(51);
    const types = NEXUSFLOW_LEGACY_BLOCK_PARITY.map((item) => item.legacyType);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toEqual(expect.arrayContaining([
      'supabase-read-row',
      'supabase-create-row',
      'supabase-update-row',
      'supabase-delete-row',
    ]));
  });

  it('backs every complete handler mapping with a manifest and registered handler', () => {
    const handlers = createDefaultNodeHandlerRegistry();
    for (const item of NEXUSFLOW_LEGACY_BLOCK_PARITY) {
      if (item.status !== 'complete' || item.runtime !== 'handler') continue;
      for (const type of item.nativeTypes) {
        const manifest = getWorkflowNodeManifest(type);
        expect(manifest, `${item.legacyType} -> ${type} manifest`).toBeTruthy();
        if (manifest?.attachment) continue;
        expect(handlers.get(type), `${item.legacyType} -> ${type} handler`).toBeTruthy();
      }
    }
  });

  it('converts every saved legacy block type without a neutral placeholder', () => {
    for (const item of NEXUSFLOW_LEGACY_BLOCK_PARITY) {
      const result = importLegacyNexusFlow({
        raw: { nodes: [{ id: 'legacy', type: item.legacyType }], connections: [] },
        workspaceId: 'workspace-parity',
        configId: `parity-${item.legacyType}`,
        name: `Paridade ${item.label}`,
        model,
      });
      expect(result.report.placeholders, item.legacyType).toBe(0);
      expect(
        result.workflow.nodes.some((node) => item.nativeTypes.includes(node.type)),
        `${item.legacyType} -> ${item.nativeTypes.join(', ')}`,
      ).toBe(true);
    }
  });

  it('keeps incomplete work explicit instead of silently claiming parity', () => {
    const summary = nexusParitySummary();
    expect(summary.complete + summary.partial + summary.pending).toBe(51);
    for (const item of NEXUSFLOW_LEGACY_BLOCK_PARITY.filter((entry) => entry.status !== 'complete')) {
      expect(item.gap?.trim().length).toBeGreaterThan(0);
    }
  });
});
