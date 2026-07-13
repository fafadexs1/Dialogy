import { describe, expect, it } from 'vitest';

import { normalizeCommunityMedia } from '@/lib/community-media';

describe('normalizeCommunityMedia', () => {
  it('keeps an HTTPS image URL without downloading it', () => {
    expect(normalizeCommunityMedia({ type: 'image', url: 'https://cdn.example.com/meme.png' })).toEqual({
      type: 'image',
      url: 'https://cdn.example.com/meme.png',
    });
  });

  it('normalizes YouTube and Vimeo URLs to safe embed hosts', () => {
    expect(normalizeCommunityMedia({ type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' })?.url)
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(normalizeCommunityMedia({ type: 'video', url: 'https://vimeo.com/123456789' })?.url)
      .toBe('https://player.vimeo.com/video/123456789');
  });

  it.each([
    'javascript:alert(1)',
    'http://example.com/image.png',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://user:password@example.com/image.png',
  ])('rejects unsafe media URL %s', (url) => {
    expect(() => normalizeCommunityMedia({ type: 'video', url })).toThrow();
  });
});
