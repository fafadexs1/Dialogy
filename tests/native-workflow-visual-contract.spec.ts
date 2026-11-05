import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NATIVE_WORKFLOW_CATEGORY_COLOR, NATIVE_WORKFLOW_CONNECTION_META, NATIVE_WORKFLOW_SHELL_CLASS } from '@/components/workflow/native-workflow-visuals';
import { listStableWorkflowNodeManifests } from '@/services/workflow-runtime/catalog';

const css = readFileSync('src/components/workflow/workflow-editor.css', 'utf8');
function luminance(hex: string) {
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.replace('#', '').slice(offset, offset + 2), 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('native workflow visual contracts', () => {
  it('fills the app shell and inherits the chosen application theme', () => {
    expect(NATIVE_WORKFLOW_SHELL_CLASS.split(' ')).toEqual(expect.arrayContaining(['h-full', 'min-h-0', 'w-full', 'workflow-editor']));
    expect(NATIVE_WORKFLOW_SHELL_CLASS.split(' ')).not.toContain('dark');
    expect(css).toContain(':root.light .workflow-portal');
  });

  it('keeps primary and secondary text readable on both themed surfaces', () => {
    const blocks = [css.split('.workflow-editor, .workflow-portal {')[1].split('}')[0], css.split(':root.light .workflow-editor, :root.light .workflow-portal {')[1].split('}')[0]];
    for (const block of blocks) {
      const tokens = Object.fromEntries([...block.matchAll(/--wf-([\w-]+): (#[\da-f]{6});/g)].map((match) => [match[1], match[2]]));
      for (const foreground of ['text', 'muted']) for (const surface of ['canvas', 'panel', 'card']) expect(contrast(tokens[foreground], tokens[surface]), `${foreground} / ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens['accent-text'], tokens.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('covers all runtime connection types without conflating capabilities and execution', () => {
    expect(Object.keys(NATIVE_WORKFLOW_CONNECTION_META).sort()).toEqual(['main', 'error', 'event', 'model', 'memory', 'knowledge', 'tool', 'agent_tool', 'guardrail'].sort());
    for (const [type, meta] of Object.entries(NATIVE_WORKFLOW_CONNECTION_META)) {
      expect(meta.label).toBeTruthy();
      expect(meta.color).toMatch(/^#[\da-f]{6}$/i);
      expect(meta.dashed).toBe(!['main', 'error', 'event'].includes(type));
    }
  });

  it('gives every catalog category an accent and honors reduced motion', () => {
    for (const manifest of listStableWorkflowNodeManifests()) expect(NATIVE_WORKFLOW_CATEGORY_COLOR[manifest.category]).toMatch(/^#[\da-f]{6}$/i);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
