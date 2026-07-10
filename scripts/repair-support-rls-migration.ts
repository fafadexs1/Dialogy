import 'dotenv/config';

import { Pool } from 'pg';

const MIGRATION = '20251210144500_fix_support_rls';
const EXPECTED_POLICIES = [
  { table: 'support_tickets', name: 'Users can create tickets' },
  { table: 'support_tickets', name: 'Users can view own tickets' },
  { table: 'support_tickets', name: 'Superadmins can view all tickets' },
  { table: 'support_messages', name: 'Users can reply to tickets' },
  { table: 'support_messages', name: 'Users can view messages of their tickets' },
] as const;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const [tables, adminFunction, policies, ledger] = await Promise.all([
      pool.query(
        `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
                c.relforcerowsecurity AS rls_forced
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = ANY($1::text[])
          ORDER BY c.relname`,
        [['support_tickets', 'support_messages']],
      ),
      pool.query(
        `SELECT p.proname, p.prosecdef AS security_definer,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'check_is_superadmin'`,
      ),
      pool.query(
        `SELECT tablename AS table_name, policyname AS policy_name, roles, cmd, qual, with_check
           FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = ANY($1::text[])
          ORDER BY tablename, policyname`,
        [['support_tickets', 'support_messages']],
      ),
      pool.query(
        `SELECT id, checksum, started_at, finished_at, rolled_back_at,
                applied_steps_count, logs
           FROM public._prisma_migrations
          WHERE migration_name = $1
          ORDER BY started_at`,
        [MIGRATION],
      ),
    ]);

    const expected = EXPECTED_POLICIES.map((policy) => ({
      ...policy,
      present: policies.rows.some((row) => row.table_name === policy.table && row.policy_name === policy.name),
    }));
    const ticketReadPolicy = policies.rows.find((row) => (
      row.table_name === 'support_tickets' && row.policy_name === 'Users can view own tickets'
    ));
    const replyPolicy = policies.rows.find((row) => (
      row.table_name === 'support_messages' && row.policy_name === 'Users can reply to tickets'
    ));
    const messageReadPolicy = policies.rows.find((row) => (
      row.table_name === 'support_messages' && row.policy_name === 'Users can view messages of their tickets'
    ));
    const functionIsSafe = adminFunction.rows.some((row) => row.security_definer && row.authenticated_can_execute);
    const supersededAdminPolicyIsSafe = Boolean(
      functionIsSafe
      && ticketReadPolicy?.cmd === 'SELECT'
      && String(ticketReadPolicy.qual).includes('auth.uid() = user_id')
      && String(ticketReadPolicy.qual).includes('check_is_superadmin()')
      && replyPolicy?.cmd === 'INSERT'
      && String(replyPolicy.with_check).includes('auth.uid() = user_id')
      && String(replyPolicy.with_check).includes('check_is_superadmin()')
      && messageReadPolicy?.cmd === 'SELECT'
      && String(messageReadPolicy.qual).includes('support_tickets.user_id = auth.uid()')
      && String(messageReadPolicy.qual).includes('check_is_superadmin()')
    );
    const historicalOrSupersededPoliciesSafe = expected.every((policy) => (
      policy.present || (policy.name === 'Superadmins can view all tickets' && supersededAdminPolicyIsSafe)
    ));
    const report = {
      migration: MIGRATION,
      rls: tables.rows,
      expectedPolicies: expected,
      allExpectedPoliciesPresent: expected.every((policy) => policy.present),
      adminFunction: adminFunction.rows,
      supersededAdminPolicyIsSafe,
      historicalOrSupersededPoliciesSafe,
      policies: policies.rows,
      ledger: ledger.rows,
    };
    console.log(JSON.stringify(report, null, 2));
    if (tables.rows.length !== 2 || tables.rows.some((row) => !row.rls_enabled) || !historicalOrSupersededPoliciesSafe) {
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[SUPPORT_RLS_REPAIR]', error);
  process.exitCode = 1;
});
