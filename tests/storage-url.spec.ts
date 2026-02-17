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
