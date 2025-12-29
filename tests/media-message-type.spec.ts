import { describe, expect, it } from 'vitest';
import { resolveMediaMessageType, normalizeMimeType } from '@/lib/media-message-type';

describe('resolveMediaMessageType', () => {
  it('prefers audio mimetype over current type', () => {
    const result = resolveMediaMessageType({
      currentType: 'video',
      mimetype: 'audio/ogg; codecs=opus',
      fileName: 'voice.ogg',
    });
    expect(result).toBe('audio');
  });

  it('uses filename when mimetype is missing', () => {
    const result = resolveMediaMessageType({
      currentType: 'document',
      fileName: 'recording.mp3',
    });
    expect(result).toBe('audio');
  });

  it('keeps type when nothing matches', () => {
    const result = resolveMediaMessageType({
      currentType: 'text',
      mimetype: undefined,
      fileName: undefined,
    });
    expect(result).toBe('text');
  });
});

describe('normalizeMimeType', () => {
  it('strips parameters', () => {
    expect(normalizeMimeType('audio/ogg; codecs=opus')).toBe('audio/ogg');
  });
});
