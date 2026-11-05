import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { getPoolStats } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Estado do pool de conexoes, para acompanhar teste de carga.
 *
 * A metrica que decide se o pool e o gargalo e `waiting`: enquanto for zero,
 * ninguem esta esperando por conexao e a latencia vem de outro lugar. Assim que
 * passa de zero de forma sustentada, o pool saturou.
 *
 * Cada replica responde pelo SEU processo — sao pools independentes. Com mais de
 * uma replica atras do proxy, colete de todas antes de concluir.
 */
function autorizado(request: Request): boolean {
  const esperado = process.env.DIALOGY_INTERNAL_SECRET;
  const recebido = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!esperado || !recebido) return false;

  // Compara hashes para nao vazar o tamanho do segredo pelo tempo de resposta.
  return timingSafeEqual(
    createHash('sha256').update(esperado).digest(),
    createHash('sha256').update(recebido).digest(),
  );
}

export async function GET(request: Request) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(
    {
      at: new Date().toISOString(),
      pid: process.pid,
      pool: getPoolStats(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
