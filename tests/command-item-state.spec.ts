import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import selectorParser from 'postcss-selector-parser';
import { describe, expect, it } from 'vitest';
import { Command, CommandItem } from '@/components/ui/command';

// Exercise cmdk's actual boolean attributes against Tailwind's compiled rules.
// Checking only aria-disabled misses CSS that blocks enabled items with the mouse.
async function itemPointerStyle(disabled?: boolean) {
  const html = renderToStaticMarkup(createElement(Command, null,
    createElement(CommandItem, { value: 'operation', disabled }, 'Operação')));
  const tag = html.match(/<div\b[^>]*cmdk-item=""[^>]*>/)?.[0];
  if (!tag) throw new Error('CommandItem did not render.');
  const attributes = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
  const classes = new Set(attributes.get('class')?.split(' '));
  const css = await postcss([tailwindcss({ content: [{ raw: html, extension: 'html' }], corePlugins: { preflight: false } })]).process('@tailwind utilities;', { from: undefined });
  const style: Record<string, string> = { 'pointer-events': 'auto', opacity: '1' };
  css.root.walkRules((rule) => {
    const matches = selectorParser().astSync(rule.selector).nodes.some((selector) => selector.nodes.every((node) => {
      if (node.type === 'class') return classes.has(node.value);
      if (node.type === 'attribute') return attributes.has(node.attribute) && (!node.operator || (node.operator === '=' && attributes.get(node.attribute) === node.value));
      return false;
    }));
    if (matches) rule.walkDecls((declaration) => { if (declaration.prop in style) style[declaration.prop] = declaration.value; });
  });
  return { disabled: attributes.get('data-disabled'), ...style };
}

describe('command item pointer interaction', () => {
  it.each([undefined, false])('keeps enabled items clickable and draggable when disabled=%s', async (disabled) => {
    expect(await itemPointerStyle(disabled)).toEqual({ disabled: 'false', 'pointer-events': 'auto', opacity: '1' });
  });
  it('still blocks pointer interaction for explicitly disabled items', async () => {
    expect(await itemPointerStyle(true)).toEqual({ disabled: 'true', 'pointer-events': 'none', opacity: '0.5' });
  });
});
