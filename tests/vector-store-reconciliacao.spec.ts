import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Reconciliacao de embeddings orfaos, contra um Postgres REAL.
 *
 * A sincronizacao da base de conhecimento era baseada em diff
 * (previousDocs x nextDocs), e diff so remove o que sabe que existiu. Um
 * documento que sai da lista sem ter os embeddings apagados nunca mais e
 * comparado — o id nao volta a aparecer em `previousDocs`. Auditoria em
 * producao (26/07/2026) achou 149 documentos orfaos, 251 chunks, todos
 * `active` e portanto recuperaveis pela busca semantica: a IA podia citar uma
 * politica que ja tinha sido revisada.
 *
 * Estes testes exercitam o SQL de verdade — `NOT (... = ANY($2::text[]))` com
 * cast de uuid para texto e o ramo de autopilot_config_id nulo nao sao
 * verificaveis com db.query mockado.
 *
 * Suba o banco descartavel antes:
 *   docker run -d --name dialogy-test-pg -e POSTGRES_PASSWORD=teste \
 *     -e POSTGRES_DB=dialogy_teste -p 5499:5432 postgres:17-alpine
 */

const TEST_DB_URL = 'postgresql://postgres:teste@127.0.0.1:5499/dialogy_teste';

process.env.DATABASE_URL = TEST_DB_URL;
process.env.DB_POOL_MAX = '4';

if (!/(127\.0\.0\.1|localhost)/.test(TEST_DB_URL)) {
  throw new Error('Recusando rodar: DATABASE_URL nao aponta para localhost.');
}

const WS = '11111111-1111-1111-1111-111111111111';
const OUTRO_WS = '22222222-2222-2222-2222-222222222222';
const CFG = '33333333-3333-3333-3333-333333333333';
const OUTRA_CFG = '44444444-4444-4444-4444-444444444444';

const VIVO = 'aaaaaaaa-0000-4000-8000-000000000001';
const ORFAO = 'aaaaaaaa-0000-4000-8000-000000000002';
const ORFAO2 = 'aaaaaaaa-0000-4000-8000-000000000003';

async function postgresDisponivel(): Promise<boolean> {
  try {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: TEST_DB_URL, connectionTimeoutMillis: 1500 });
    await c.connect();
    await c.query('SELECT 1');
    await c.end();
    return true;
  } catch {
    return false;
  }
}

const temPostgres = await postgresDisponivel();

if (!temPostgres) {
  console.warn(`\n[vector-store] Postgres de teste ausente em ${TEST_DB_URL} — suite pulada.\n`);
}

let db: import('pg').Pool;
let VectorStore: typeof import('@/lib/vector-store').VectorStore;

beforeAll(async () => {
  if (!temPostgres) return;
  ({ db } = await import('@/lib/db'));
  ({ VectorStore } = await import('@/lib/vector-store'));

  // Estrutura minima da tabela; o tipo vector nao e necessario para o DELETE.
  await db.query(`
    CREATE TABLE IF NOT EXISTS embeddings_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      content text,
      document_id uuid NOT NULL,
      document_name text,
      workspace_id uuid NOT NULL,
      autopilot_config_id uuid,
      metadata jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now()
    )`);
});

afterAll(async () => {
  await db?.end();
});

beforeEach(async () => {
  if (!temPostgres) return;
  await db.query('TRUNCATE embeddings_documents');
});

async function semear(linhas: Array<{ doc: string; ws?: string; cfg?: string | null }>) {
  for (const l of linhas) {
    await db.query(
      `INSERT INTO embeddings_documents (content, document_id, document_name, workspace_id, autopilot_config_id)
       VALUES ('trecho', $1, 'Doc', $2, $3)`,
      [l.doc, l.ws ?? WS, l.cfg === undefined ? CFG : l.cfg],
    );
  }
}

const idsRestantes = async (): Promise<string[]> => {
  const { rows } = await db.query('SELECT DISTINCT document_id::text AS id FROM embeddings_documents ORDER BY 1');
  return rows.map((r) => r.id);
};

describe.skipIf(!temPostgres)('VectorStore.deleteEmbeddingsNotIn', () => {
  it('remove o orfao e preserva o documento que continua na lista', async () => {
    await semear([{ doc: VIVO }, { doc: ORFAO }]);

    const removidos = await VectorStore.deleteEmbeddingsNotIn({
      workspaceId: WS,
      autopilotConfigId: CFG,
      keepDocumentIds: [VIVO],
    });

    expect(removidos).toBe(1);
    expect(await idsRestantes()).toEqual([VIVO]);
  });

  it('remove todos os chunks de um mesmo documento orfao', async () => {
    await semear([{ doc: ORFAO }, { doc: ORFAO }, { doc: ORFAO }, { doc: VIVO }]);

    const removidos = await VectorStore.deleteEmbeddingsNotIn({
      workspaceId: WS,
      autopilotConfigId: CFG,
      keepDocumentIds: [VIVO],
    });

    expect(removidos).toBe(3);
  });

  it('NAO toca em outro workspace', async () => {
    await semear([{ doc: ORFAO, ws: OUTRO_WS }]);

    const removidos = await VectorStore.deleteEmbeddingsNotIn({
      workspaceId: WS,
      autopilotConfigId: CFG,
      keepDocumentIds: [],
    });

    expect(removidos).toBe(0);
    expect(await idsRestantes()).toEqual([ORFAO]);
  });

  it('NAO toca em outro agente do mesmo workspace', async () => {
    await semear([{ doc: ORFAO, cfg: OUTRA_CFG }]);

    const removidos = await VectorStore.deleteEmbeddingsNotIn({
      workspaceId: WS,
      autopilotConfigId: CFG,
      keepDocumentIds: [],
    });

    expect(removidos).toBe(0);
  });

  it('trata autopilotConfigId nulo sem confundir com os que tem agente', async () => {
    await semear([{ doc: ORFAO, cfg: null }, { doc: ORFAO2, cfg: CFG }]);

    const removidos = await VectorStore.deleteEmbeddingsNotIn({
      workspaceId: WS,
      autopilotConfigId: null,
      keepDocumentIds: [],
    });

    expect(removidos).toBe(1);
    expect(await idsRestantes()).toEqual([ORFAO2]);
  });

  it('lista vazia limpa tudo daquele agente — configuracao sem documentos', async () => {
    await semear([{ doc: VIVO }, { doc: ORFAO }]);

    const removidos = await VectorStore.deleteEmbeddingsNotIn({
      workspaceId: WS,
      autopilotConfigId: CFG,
      keepDocumentIds: [],
    });

    expect(removidos).toBe(2);
    expect(await idsRestantes()).toEqual([]);
  });

  it('id nao-uuid na lista nao aborta a limpeza', async () => {
    // Ids historicos vieram de JSON e nem todos sao uuid valido. Um cast direto
    // para uuid derrubaria a query inteira e o vazamento continuaria.
    await semear([{ doc: VIVO }, { doc: ORFAO }]);

    const removidos = await VectorStore.deleteEmbeddingsNotIn({
      workspaceId: WS,
      autopilotConfigId: CFG,
      keepDocumentIds: [VIVO, 'nao-e-uuid', ''],
    });

    expect(removidos).toBe(1);
    expect(await idsRestantes()).toEqual([VIVO]);
  });

  it('exige workspaceId', async () => {
    await expect(
      VectorStore.deleteEmbeddingsNotIn({ workspaceId: '', autopilotConfigId: CFG, keepDocumentIds: [] }),
    ).rejects.toThrow(/workspaceId/);
  });
});
