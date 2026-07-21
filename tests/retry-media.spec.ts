import { describe, expect, it } from 'vitest';

import {
  buildRetryMediaPayload,
  extractRetriedMediaResponseDetails,
  isRetryableMediaMessageType,
} from '@/services/messages/retry-media';
import {
  RETRY_MEDIA_RETENTION_DAYS,
  RETRY_MEDIA_RETENTION_MS,
} from '@/services/messages/temp-media-retention';

describe('retry media messages', () => {
  it('keeps temporary media available for one day before cleanup', () => {
    expect(RETRY_MEDIA_RETENTION_DAYS).toBe(1);
    expect(RETRY_MEDIA_RETENTION_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('builds a retry payload for audio and video messages', () => {
    expect(buildRetryMediaPayload({
      type: 'audio',
      content: '',
      metadata: {
        mediaUrl: 'https://cdn.example.com/audio.ogg',
        mimetype: 'audio/ogg',
        fileName: 'audio_gravado.ogg',
      },
    }).payload).toMatchObject({
      mediatype: 'audio',
      mediaUrl: 'https://cdn.example.com/audio.ogg',
      mimetype: 'audio/ogg',
      filename: 'audio_gravado.ogg',
    });

    expect(buildRetryMediaPayload({
      type: 'video',
      content: 'Legenda',
      metadata: {
        mediaUrl: 'https://cdn.example.com/video.mp4',
        mimetype: 'video/mp4',
      },
    }).payload).toMatchObject({
      mediatype: 'video',
      mediaUrl: 'https://cdn.example.com/video.mp4',
      mimetype: 'video/mp4',
      caption: 'Legenda',
    });
  });

  it('does not treat thumbnails as the media source for retry', () => {
    const result = buildRetryMediaPayload({
      type: 'video',
      content: '',
      metadata: {
        thumbnail: 'data:image/jpeg;base64,preview',
        mimetype: 'video/mp4',
      },
    });

    expect(result.payload).toBeNull();
    expect(result.error).toBe('Midia original nao encontrada para reenvio.');
  });

  it('recognizes only real media message types', () => {
    expect(isRetryableMediaMessageType('audio')).toBe(true);
    expect(isRetryableMediaMessageType('video')).toBe(true);
    expect(isRetryableMediaMessageType('text')).toBe(false);
    expect(isRetryableMediaMessageType('location')).toBe(false);
  });

  it('extracts provider ids and returned media details from Evolution responses', () => {
    const details = extractRetriedMediaResponseDetails({
      key: { id: 'provider-1' },
      message: {
        videoMessage: {
          url: 'https://evolution.example.com/video.mp4',
          mimetype: 'video/mp4',
        },
      },
    }, 'video');

    expect(details).toEqual({
      messageIdFromApi: 'provider-1',
      returnedMediaUrl: 'https://evolution.example.com/video.mp4',
      returnedMimetype: 'video/mp4',
    });
  });

  it('keeps the normalized MIME returned by Dialogy when Evolution omits it', () => {
    const details = extractRetriedMediaResponseDetails({
      key: { id: 'provider-2' },
      tempMediaPublicUrl: 'https://cdn.example.com/audio.mp3',
      tempMediaMimetype: 'audio/mpeg',
    }, 'audio');

    expect(details).toEqual({
      messageIdFromApi: 'provider-2',
      returnedMediaUrl: 'https://cdn.example.com/audio.mp3',
      returnedMimetype: 'audio/mpeg',
    });
  });
});
