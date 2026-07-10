import { describe, expect, it } from 'vitest';

import {
  NATIVE_WORKFLOW_CATEGORY_COLOR,
  NATIVE_WORKFLOW_CONNECTION_META,
  NATIVE_WORKFLOW_SHELL_CLASS,
} from '@/components/workflow/native-workflow-visuals';
import { listStableWorkflowNodeManifests } from '@/services/workflow-runtime/catalog';
import type { ConnectionType } from '@/services/workflow-runtime/types';

const ALL_CONNECTION_TYPES: ConnectionType[] = [
  'main',
  'error',
  'event',
  'model',
  'memory',
  'knowledge',
  'tool',
  'agent_tool',
  'guardrail',
];

const ATTACHMENT_TYPES: ConnectionType[] = [
  'model',
  'memory',
  'knowledge',
  'tool',
  'agent_tool',
  'guardrail',
];

function rgb(hex: string) {
  const normalized = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

function colorDistance(left: string, right: string) {
  const a = rgb(left);
  const b = rgb(right);
  return Math.sqrt(a.reduce((sum, channel, index) => sum + ((channel - b[index]!) ** 2), 0));
}

describe('native workflow visual contract', () => {
  it('fills the available app shell without an artificial viewport gap', () => {
    expect(NATIVE_WORKFLOW_SHELL_CLASS).toMatch(/(?:^|\s)h-full(?:\s|$)/);
    expect(NATIVE_WORKFLOW_SHELL_CLASS).toMatch(/(?:^|\s)min-h-0(?:\s|$)/);
    expect(NATIVE_WORKFLOW_SHELL_CLASS).toMatch(/(?:^|\s)w-full(?:\s|$)/);
    expect(NATIVE_WORKFLOW_SHELL_CLASS).not.toMatch(/calc\(|100vh|100dvh|min-h-\[|rounded/);
  });

  it('gives every handle type an explicit, visible and non-black color', () => {
    expect(Object.keys(NATIVE_WORKFLOW_CONNECTION_META).sort()).toEqual([...ALL_CONNECTION_TYPES].sort());
    for (const type of ALL_CONNECTION_TYPES) {
      const color = NATIVE_WORKFLOW_CONNECTION_META[type].color;
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colorDistance(color, '#080d14')).toBeGreaterThan(90);
    }
  });

  it('keeps execution edges solid and capability attachments dashed', () => {
    expect(NATIVE_WORKFLOW_CONNECTION_META.main.dashed).toBe(false);
    expect(NATIVE_WORKFLOW_CONNECTION_META.error.dashed).toBe(false);
    expect(NATIVE_WORKFLOW_CONNECTION_META.event.dashed).toBe(false);
    for (const type of ATTACHMENT_TYPES) {
      expect(NATIVE_WORKFLOW_CONNECTION_META[type].dashed).toBe(true);
    }
  });

  it('defines a visible category accent for every stable catalog section', () => {
    const stableCategories = new Set(listStableWorkflowNodeManifests().map((manifest) => manifest.category));
    for (const category of stableCategories) {
      expect(NATIVE_WORKFLOW_CATEGORY_COLOR[category]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colorDistance(NATIVE_WORKFLOW_CATEGORY_COLOR[category], '#080d14')).toBeGreaterThan(90);
    }
  });
});
