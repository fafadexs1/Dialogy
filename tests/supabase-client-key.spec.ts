import { describe, expect, it } from 'vitest';
import { resolveSupabasePublicKey } from '@/lib/supabase/public-key';

const serviceRoleJwt = 'eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature';
const anonJwt = 'eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYW5vbiJ9.signature';

describe('resolveSupabasePublicKey', () => {
  it('prefers a safe browser key when the publishable variable is misconfigured', () => {
    expect(resolveSupabasePublicKey({
      anonKey: anonJwt,
      publishableKey: serviceRoleJwt,
    })).toBe(anonJwt);
  });

  it('rejects service_role when no browser-safe key is available', () => {
    expect(() => resolveSupabasePublicKey({ publishableKey: serviceRoleJwt })).toThrow(/service_role/i);
  });

  it('accepts the new opaque publishable-key format', () => {
    expect(resolveSupabasePublicKey({ publishableKey: 'sb_publishable_example' })).toBe('sb_publishable_example');
  });

  it('rejects the new opaque secret-key format', () => {
    expect(() => resolveSupabasePublicKey({ publishableKey: 'sb_secret_example' })).toThrow(/service_role/i);
  });
});
