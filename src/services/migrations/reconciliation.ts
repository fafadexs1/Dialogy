import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export const RECONCILIATION_CONFIRMATION = 'RECONCILE_VERIFIED_MIGRATIONS';

export type MigrationInvariant =
  | { kind: 'table'; schema: string; name: string; present: boolean }
  | { kind: 'column'; schema: string; table: string; name: string; present: boolean }
  | { kind: 'column_default'; schema: string; table: string; name: string; expected: string; present: true }
  | { kind: 'index'; schema: string; name: string; present: boolean }
  | { kind: 'constraint'; schema: string; table: string; name: string; present: boolean }
  | { kind: 'policy'; schema: string; table: string; name: string; present: boolean }
  | { kind: 'trigger'; schema: string; name: string; present: boolean }
  | { kind: 'function'; schema: string; name: string; present: boolean }
  | { kind: 'type'; schema: string; name: string; present: boolean }
  | { kind: 'view'; schema: string; name: string; present: boolean }
  | { kind: 'rls'; schema: string; table: string; present: boolean };

export interface LocalMigration {
  name: string;
  sql: string;
  checksum: string;
  invariants: MigrationInvariant[];
  blockers: string[];
}

export interface LedgerMigration {
  migration_name: string;
  checksum: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
}

export interface InvariantResult {
  invariant: MigrationInvariant;
  passed: boolean;
}

export interface MigrationAuditResult {
  name: string;
  status: 'applied' | 'failed_ledger_entry' | 'missing_verified' | 'missing_blocked' | 'checksum_mismatch';
  checksum: string;
  ledgerChecksum?: string;
  blockers: string[];
  invariantResults: InvariantResult[];
}

const identifier = String.raw`(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))`;

function value(quoted: string | undefined, plain: string | undefined): string {
  return quoted ?? plain ?? '';
}

function uniqueInvariants(invariants: MigrationInvariant[]): MigrationInvariant[] {
  const seen = new Set<string>();
  return invariants.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');
}

function schemaAndName(rawSchema: string | undefined, rawName: string): { schema: string; name: string } {
  return { schema: rawSchema || 'public', name: rawName };
}

/**
 * Extracts catalog-verifiable postconditions only. Anything with data mutation is
 * deliberately blocked: a schema-shaped database is not proof that its backfill ran.
 */
export function inferMigrationInvariants(sql: string): { invariants: MigrationInvariant[]; blockers: string[] } {
  const source = stripComments(sql);
  const invariants: MigrationInvariant[] = [];
  const blockers: string[] = [];

  const tablePattern = new RegExp(String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"([^"]+)"|([a-zA-Z_][\w]*))\.)?${identifier}`, 'gi');
  for (const match of source.matchAll(tablePattern)) {
    const schema = value(match[1], match[2]) || 'public';
    invariants.push({ kind: 'table', schema, name: value(match[3], match[4]), present: true });
  }

  const dropTablePattern = new RegExp(String.raw`DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:(?:"([^"]+)"|([a-zA-Z_][\w]*))\.)?${identifier}`, 'gi');
  for (const match of source.matchAll(dropTablePattern)) {
    const schema = value(match[1], match[2]) || 'public';
    invariants.push({ kind: 'table', schema, name: value(match[3], match[4]), present: false });
  }

  const alterPattern = new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:(?:"([^"]+)"|([a-zA-Z_][\w]*))\.)?${identifier}([\s\S]*?);`, 'gi');
  for (const match of source.matchAll(alterPattern)) {
    const schema = value(match[1], match[2]) || 'public';
    const table = value(match[3], match[4]);
    const body = match[5];
    const addColumn = new RegExp(String.raw`ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?${identifier}`, 'gi');
    for (const column of body.matchAll(addColumn)) {
      const name = value(column[1], column[2]);
      if (!['constraint', 'primary', 'foreign', 'unique', 'check'].includes(name.toLowerCase())) {
        invariants.push({ kind: 'column', schema, table, name, present: true });
      }
    }
    const dropColumn = new RegExp(String.raw`DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?${identifier}`, 'gi');
    for (const column of body.matchAll(dropColumn)) {
      invariants.push({ kind: 'column', schema, table, name: value(column[1], column[2]), present: false });
    }
    const columnDefault = new RegExp(String.raw`ALTER\s+COLUMN\s+${identifier}\s+SET\s+DEFAULT\s+((?:'[^']*')|(?:[a-zA-Z0-9_.()]+))`, 'gi');
    for (const column of body.matchAll(columnDefault)) {
      invariants.push({
        kind: 'column_default',
        schema,
        table,
        name: value(column[1], column[2]),
        expected: column[3].trim(),
        present: true,
      });
    }
    const addConstraint = new RegExp(String.raw`ADD\s+CONSTRAINT\s+${identifier}`, 'gi');
    for (const constraint of body.matchAll(addConstraint)) {
      invariants.push({ kind: 'constraint', schema, table, name: value(constraint[1], constraint[2]), present: true });
    }
    const dropConstraint = new RegExp(String.raw`DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?${identifier}`, 'gi');
    for (const constraint of body.matchAll(dropConstraint)) {
      invariants.push({ kind: 'constraint', schema, table, name: value(constraint[1], constraint[2]), present: false });
    }
    if (/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(body)) invariants.push({ kind: 'rls', schema, table, present: true });
    if (/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(body)) invariants.push({ kind: 'rls', schema, table, present: false });
  }

  const indexPattern = new RegExp(String.raw`CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"([^"]+)"|([a-zA-Z_][\w]*))\.)?${identifier}`, 'gi');
  for (const match of source.matchAll(indexPattern)) {
    invariants.push({ kind: 'index', ...schemaAndName(value(match[1], match[2]), value(match[3], match[4])), present: true });
  }
  const dropIndexPattern = new RegExp(String.raw`DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(?:(?:"([^"]+)"|([a-zA-Z_][\w]*))\.)?${identifier}`, 'gi');
  for (const match of source.matchAll(dropIndexPattern)) {
    invariants.push({ kind: 'index', ...schemaAndName(value(match[1], match[2]), value(match[3], match[4])), present: false });
  }

  const policyPattern = new RegExp(String.raw`CREATE\s+POLICY\s+${identifier}\s+ON\s+(?:(?:"([^"]+)"|([a-zA-Z_][\w]*))\.)?${identifier}`, 'gi');
  for (const match of source.matchAll(policyPattern)) {
    invariants.push({ kind: 'policy', name: value(match[1], match[2]), schema: value(match[3], match[4]) || 'public', table: value(match[5], match[6]), present: true });
  }
  const dropPolicyPattern = new RegExp(String.raw`DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?${identifier}\s+ON\s+(?:(?:"([^"]+)"|([a-zA-Z_][\w]*))\.)?${identifier}`, 'gi');
  for (const match of source.matchAll(dropPolicyPattern)) {
    invariants.push({ kind: 'policy', name: value(match[1], match[2]), schema: value(match[3], match[4]) || 'public', table: value(match[5], match[6]), present: false });
  }

  const functionPattern = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(?:"([^"]+)"|([a-zA-Z_][\w]*))\.)?${identifier}\s*\(`, 'gi');
  for (const match of source.matchAll(functionPattern)) {
    invariants.push({ kind: 'function', schema: value(match[1], match[2]) || 'public', name: value(match[3], match[4]), present: true });
  }
  const triggerPattern = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+${identifier}`, 'gi');
  for (const match of source.matchAll(triggerPattern)) {
    invariants.push({ kind: 'trigger', schema: 'public', name: value(match[1], match[2]), present: true });
  }
  const typePattern = new RegExp(String.raw`CREATE\s+TYPE\s+(?:(?:"([^"]+)"|([a-zA-Z_][\w]*))\.)?${identifier}`, 'gi');
  for (const match of source.matchAll(typePattern)) {
    invariants.push({ kind: 'type', schema: value(match[1], match[2]) || 'public', name: value(match[3], match[4]), present: true });
  }

  const viewPattern = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:(?:"([^"]+)"|([a-zA-Z_][\w]*))\.)?${identifier}`, 'gi');
  for (const match of source.matchAll(viewPattern)) {
    invariants.push({ kind: 'view', schema: value(match[1], match[2]) || 'public', name: value(match[3], match[4]), present: true });
  }

  // Data state cannot be proven from the PostgreSQL catalog. Never resolve such a
  // migration automatically, even when all of its DDL objects happen to exist.
  if (/\b(?:INSERT\s+INTO|UPDATE\s+["a-zA-Z_]["a-zA-Z0-9_.]*\s+SET|DELETE\s+FROM|TRUNCATE\s+(?:TABLE\s+)?)\b/i.test(source)) {
    blockers.push('contains_data_mutation_requiring_manual_invariant');
  }
  if (invariants.length === 0) blockers.push('no_catalog_invariants_inferred');

  return { invariants: uniqueInvariants(invariants), blockers };
}

export function checksumMigration(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

async function invariantExists(db: Queryable, invariant: MigrationInvariant): Promise<boolean> {
  let query: string;
  let parameters: string[];
  switch (invariant.kind) {
    case 'table':
      query = `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS present`;
      parameters = [invariant.schema, invariant.name];
      break;
    case 'column':
      query = `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3) AS present`;
      parameters = [invariant.schema, invariant.table, invariant.name];
      break;
    case 'column_default':
      query = `SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
           AND (column_default = $4 OR column_default LIKE $4 || '::%')
      ) AS present`;
      parameters = [invariant.schema, invariant.table, invariant.name, invariant.expected];
      break;
    case 'index':
      query = `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2) AS present`;
      parameters = [invariant.schema, invariant.name];
      break;
    case 'constraint':
      query = `SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = $1 AND r.relname = $2 AND c.conname = $3) AS present`;
      parameters = [invariant.schema, invariant.table, invariant.name];
      break;
    case 'policy':
      query = `SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = $1 AND tablename = $2 AND policyname = $3) AS present`;
      parameters = [invariant.schema, invariant.table, invariant.name];
      break;
    case 'trigger':
      query = `SELECT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = $1 AND t.tgname = $2 AND NOT t.tgisinternal) AS present`;
      parameters = [invariant.schema, invariant.name];
      break;
    case 'function':
      query = `SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1 AND p.proname = $2) AS present`;
      parameters = [invariant.schema, invariant.name];
      break;
    case 'type':
      query = `SELECT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = $1 AND t.typname = $2) AS present`;
      parameters = [invariant.schema, invariant.name];
      break;
    case 'view':
      query = `SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = $1 AND table_name = $2) AS present`;
      parameters = [invariant.schema, invariant.name];
      break;
    case 'rls':
      query = `SELECT COALESCE((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2), false) AS present`;
      parameters = [invariant.schema, invariant.table];
      break;
  }
  const result = await db.query<{ present: boolean }>(query, parameters);
  return Boolean(result.rows[0]?.present);
}

export async function readMigrationLedger(db: Queryable): Promise<LedgerMigration[]> {
  const result = await db.query<LedgerMigration>(
    `SELECT migration_name, checksum, finished_at, rolled_back_at
       FROM public._prisma_migrations
      ORDER BY migration_name, started_at`,
  );
  return result.rows;
}

export async function auditMigrations(db: Queryable, migrations: LocalMigration[]): Promise<MigrationAuditResult[]> {
  const ledger = await readMigrationLedger(db);
  return Promise.all(migrations.map(async (migration) => {
    const rows = ledger.filter((row) => row.migration_name === migration.name);
    const applied = rows.find((row) => row.finished_at && !row.rolled_back_at);
    if (applied) {
      return {
        name: migration.name,
        status: applied.checksum === migration.checksum ? 'applied' : 'checksum_mismatch',
        checksum: migration.checksum,
        ledgerChecksum: applied.checksum,
        blockers: applied.checksum === migration.checksum ? [] : ['ledger_checksum_differs_from_local_sql'],
        invariantResults: [],
      };
    }
    const invariantResults = await Promise.all(migration.invariants.map(async (invariant) => {
      const exists = await invariantExists(db, invariant);
      return { invariant, passed: exists === invariant.present };
    }));
    if (rows.some((row) => !row.finished_at && !row.rolled_back_at)) {
      const blockers = ['unresolved_failed_migration_entry', ...migration.blockers];
      if (invariantResults.some((result) => !result.passed)) blockers.push('one_or_more_catalog_invariants_failed');
      return { name: migration.name, status: 'failed_ledger_entry', checksum: migration.checksum, blockers, invariantResults };
    }
    const blockers = [...migration.blockers];
    if (invariantResults.some((result) => !result.passed)) blockers.push('one_or_more_catalog_invariants_failed');
    return {
      name: migration.name,
      status: blockers.length === 0 ? 'missing_verified' : 'missing_blocked',
      checksum: migration.checksum,
      blockers,
      invariantResults,
    };
  }));
}

export async function reconcileVerifiedMigrations(
  pool: Pool,
  migrations: LocalMigration[],
  options: { confirmation: string; names: string[] },
): Promise<string[]> {
  if (options.confirmation !== RECONCILIATION_CONFIRMATION) throw new Error('Explicit reconciliation confirmation is required.');
  if (options.names.length === 0) throw new Error('At least one migration must be selected explicitly.');
  const selected = migrations.filter((migration) => options.names.includes(migration.name));
  if (selected.length !== options.names.length) throw new Error('One or more selected migrations do not exist locally.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('dialogy_prisma_migration_reconciliation'))`);
    const audit = await auditMigrations(client, selected);
    const unsafe = audit.filter((result) => result.status !== 'missing_verified');
    if (unsafe.length > 0) throw new Error(`Reconciliation refused: ${unsafe.map((item) => `${item.name}:${item.status}`).join(', ')}`);
    for (const migration of selected) {
      await client.query(
        `INSERT INTO public._prisma_migrations
          (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, $4, NULL, now(), 1)`,
        [randomUUID(), migration.checksum, migration.name, 'Reconciled after catalog invariant verification; migration SQL was not executed.'],
      );
    }
    await client.query('COMMIT');
    return selected.map((migration) => migration.name);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
