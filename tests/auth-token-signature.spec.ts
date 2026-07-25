import { describe, expect, it } from 'vitest';

import { decodeSupabaseJwt } from '@/lib/auth/token';

/**
 * A verificacao de assinatura precisa reprovar token forjado.
 *
 * O servidor confia em decodeSupabaseJwt para montar o usuario da sessao:
 * createClient() chama mapPayloadToSupabaseUser com o retorno desta funcao e
 * substitui supabase.auth.getUser por uma versao que devolve esse usuario. Um
 * payload aceito sem assinatura valida vira, na pratica, sessao autenticada
 * como qualquer id de usuario que o atacante escolher.
 */

const SEGREDO = 'segredo-de-teste-para-assinatura-hs256';

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

async function assinar(payload: Record<string, unknown>, segredo: string): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = base64url(JSON.stringify(payload));
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const assinatura = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${header}.${corpo}`));
  return `${header}.${corpo}.${Buffer.from(assinatura).toString('base64url')}`;
}

function forjar(payload: Record<string, unknown>): string {
  // Assinatura inventada — nenhum segredo envolvido.
  return `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(
    JSON.stringify(payload),
  )}.assinatura-invalida`;
}

const PAYLOAD = {
  sub: '00000000-0000-0000-0000-00000000dead',
  email: 'invasor@exemplo.com',
  role: 'authenticated',
  aud: 'authenticated',
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe('decodeSupabaseJwt', () => {
  it('aceita token legitimamente assinado', async () => {
    process.env.SUPABASE_JWT_SECRET = SEGREDO;
    const token = await assinar(PAYLOAD, SEGREDO);

    const resultado = await decodeSupabaseJwt(token);
    expect(resultado?.sub).toBe(PAYLOAD.sub);
  });

  it('REPROVA token com assinatura invalida', async () => {
    process.env.SUPABASE_JWT_SECRET = SEGREDO;

    const resultado = await decodeSupabaseJwt(forjar(PAYLOAD));

    // Se isto falhar, qualquer pessoa autentica como qualquer usuario apenas
    // montando um JWT com o `sub` desejado — sem conhecer segredo nenhum.
    expect(resultado).toBeNull();
  });

  it('REPROVA token assinado com o segredo errado', async () => {
    process.env.SUPABASE_JWT_SECRET = SEGREDO;
    const token = await assinar(PAYLOAD, 'segredo-errado');

    const resultado = await decodeSupabaseJwt(token);
    expect(resultado).toBeNull();
  });

  it('REPROVA token sem assinatura (alg none)', async () => {
    process.env.SUPABASE_JWT_SECRET = SEGREDO;
    const token = `${base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64url(
      JSON.stringify(PAYLOAD),
    )}.`;

    const resultado = await decodeSupabaseJwt(token);
    expect(resultado).toBeNull();
  });
});
