import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstagramMessagingService } from '@/services/meta/instagram-messaging-service';
import type { MetaChannelRecord } from '@/services/meta/meta-channel.service';

describe('InstagramMessagingService', () => {
  const baseChannel: MetaChannelRecord = {
    id: 'channel-1',
    workspace_id: 'ws-1',
    type: 'instagram',
    external_page_id: 'page-1',
    ig_business_id: 'ig-123',
    access_token: 'access-token',
    app_secret: null,
    verify_token: 'verify-token',
    name: 'Instagram',
    status: 'active',
  };

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts to the IG business endpoint without messaging_type', async () => {
    const service = new InstagramMessagingService(baseChannel);
    await service.sendText('user-1', 'hello');

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, options] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v20.0/ig-123/messages');

    const body = JSON.parse(options.body);
    expect(body.messaging_type).toBeUndefined();
    expect(body.recipient).toEqual({ id: 'user-1' });
  });

  it('throws when no IG business or page id is configured', async () => {
    const service = new InstagramMessagingService({
      ...baseChannel,
      ig_business_id: null,
      external_page_id: null,
    });

    await expect(service.sendText('user-1', 'hello')).rejects.toThrow('Instagram Business');
  });
});
