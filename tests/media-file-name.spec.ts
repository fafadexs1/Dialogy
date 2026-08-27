import { describe, expect, it } from 'vitest';

import {
  createUniqueMediaFileName,
  createUniqueMediaStoragePath,
} from '@/lib/media-file-name';

describe('unique media names', () => {
  it('includes the timestamp, UUID and original extension', () => {
    expect(createUniqueMediaFileName('minha foto.PNG', 1770000000000, 'uuid-1'))
      .toBe('minha_foto_1770000000000-uuid-1.png');
  });

  it('does not collide when files share a timestamp', () => {
    const first = createUniqueMediaFileName('image.png', 1770000000000, 'uuid-1');
    const second = createUniqueMediaFileName('image.png', 1770000000000, 'uuid-2');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^image_1770000000000-uuid-1\.png$/);
    expect(second).toMatch(/^image_1770000000000-uuid-2\.png$/);
  });

  it('keeps Storage paths scoped and unique for every media type', () => {
    expect(createUniqueMediaStoragePath('video.mp4', 'chat-media', 1770000000000, 'video-id'))
      .toBe('chat-media/video_1770000000000-video-id.mp4');
    expect(createUniqueMediaStoragePath('document.pdf', 'chat-media', 1770000000000, 'document-id'))
      .toBe('chat-media/document_1770000000000-document-id.pdf');
    expect(createUniqueMediaStoragePath('audio', 'chat-media', 1770000000000, 'audio-id'))
      .toBe('chat-media/audio_1770000000000-audio-id');
  });
});
