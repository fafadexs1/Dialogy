import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('normalizeSupabaseStorageUrl', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rewrites old public storage host to current host', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.vps1.klyraai.com.br');
    const { normalizeSupabaseStorageUrl } = await import('../src/lib/storage-url');

    const input = 'https://oldproj.supabase.co/storage/v1/object/public/photo_user/avatar-1.png';
    const output = normalizeSupabaseStorageUrl(input);

    expect(output).toBe('https://supabase.vps1.klyraai.com.br/storage/v1/object/public/photo_user/avatar-1.png');
  });

  it('rewrites signed storage url to public url on current host', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.vps1.klyraai.com.br');
    const { normalizeSupabaseStorageUrl } = await import('../src/lib/storage-url');

    const input = 'https://oldproj.supabase.co/storage/v1/object/sign/workspace-avatars/public/logo.png?token=abc123';
    const output = normalizeSupabaseStorageUrl(input);

    expect(output).toBe('https://supabase.vps1.klyraai.com.br/storage/v1/object/public/workspace-avatars/public/logo.png');
  });

  it('keeps non-supabase urls unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.vps1.klyraai.com.br');
    const { normalizeSupabaseStorageUrl } = await import('../src/lib/storage-url');

    const input = 'https://cdn.example.com/avatar.png';
    const output = normalizeSupabaseStorageUrl(input);

    expect(output).toBe(input);
  });
});

describe('resolveClientMediaUrl', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('proxies external media urls through the internal media route', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://dialogy.klyraai.com.br');
    const { resolveClientMediaUrl } = await import('../src/lib/storage-url');

    const input =
      'https://pps.whatsapp.net/v/t61.24694-24/example.jpg?oh=token&oe=expires';

    expect(resolveClientMediaUrl(input, { kind: 'image' })).toBe(
      `/api/media?url=${encodeURIComponent(input)}&kind=image`
    );
  });

  it('keeps same-origin absolute urls unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://dialogy.klyraai.com.br');
    const { resolveClientMediaUrl } = await import('../src/lib/storage-url');

    const input = 'https://dialogy.klyraai.com.br/uploads/avatar.png';

    expect(resolveClientMediaUrl(input, { kind: 'image' })).toBe(input);
  });

  it('builds an absolute app url from a relative proxy path', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://dialogy.klyraai.com.br');
    const { toAbsoluteAppUrl } = await import('../src/lib/storage-url');

    const input = '/api/media?url=https%3A%2F%2Fcdn.example.com%2Ffile.png&kind=image';

    expect(toAbsoluteAppUrl(input)).toBe(`https://dialogy.klyraai.com.br${input}`);
  });
});
