import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnimatedComposer } from '@/components/chat/animated-composer';
import { catalogComposerProps } from './fixtures/catalog-composer';
import type { Chat } from '@/lib/types';

describe('catalog entry in the actual conversation composer', () => {
  it.each([undefined, 'baileys', 'wa_cloud'] as const)('shows the labelled catalog button for WhatsApp transport %s', (instance_type) => {
    const html = renderToStaticMarkup(<AnimatedComposer {...catalogComposerProps({ instance_type })} />);
    expect(html).toContain('aria-label="Enviar catálogo de produtos"');
    expect(html).toContain('Catálogo</span>');
  });
  it.each([
    { instance_type: 'telegram' },
    { metaPlatform: 'instagram' },
    { metaPlatform: 'messenger' },
    { source: 'webchat' },
  ] as Partial<Chat>[])('keeps the WhatsApp action out of other channels: %j', (overrides) => {
    expect(renderToStaticMarkup(<AnimatedComposer {...catalogComposerProps(overrides)} />)).not.toContain('aria-label="Enviar catálogo de produtos"');
  });
  it('does not offer a customer catalog while composing an internal note', () => {
    const props = { ...catalogComposerProps({ instance_type: 'baileys' }), isInternalNote: true };
    expect(renderToStaticMarkup(<AnimatedComposer {...props} />)).not.toContain('aria-label="Enviar catálogo de produtos"');
  });
});
