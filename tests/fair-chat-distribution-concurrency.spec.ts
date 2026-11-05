import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { selectFairAgentForTeam } from '@/services/chat-distribution/fair-distribution';
import {lockWorkspaceAssignments,readTransferOperation,saveTransferOperation} from '@/services/chat-distribution/transfer-operation';

// Opt in with a disposable local PostgreSQL database. Separate connections are
// necessary: an embedded single-connection engine cannot verify lock contention.
const url = process.env.CHAT_DISTRIBUTION_TEST_DATABASE_URL;
if (url && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Chat distribution concurrency tests require a local test database.');
}
const schema = `chat_distribution_${process.pid}_${Date.now()}`;
const workspace = '11111111-1111-1111-1111-111111111111';
const agent = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const teamA = '33333333-3333-3333-3333-333333333333';
const teamB = '44444444-4444-4444-4444-444444444444';
const incomingA = '55555555-5555-5555-5555-555555555555';
const incomingB = '66666666-6666-6666-6666-666666666666';
const bootstrap = url ? new Client({ connectionString: url, connectionTimeoutMillis: 1500 }) : null;
let pool: Pool | undefined;

beforeAll(async () => {
  if (!bootstrap) return;
  await bootstrap.connect();
  await bootstrap.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: url, max: 3, options: `-c search_path=${schema}` });
  const client = await pool.connect();
  try {
    await client.query(readFileSync(resolve('tests/fixtures/chat-distribution-schema.sql'), 'utf8'));
    await client.query(readFileSync(resolve('prisma/migrations/20260713100000_fair_chat_distribution/migration.sql'), 'utf8')
      .replaceAll('public.', ''));
    await client.query(readFileSync(resolve('prisma/migrations/20261028141517_protected_opportunity_distribution/migration.sql'),'utf8').replaceAll('public.',''));
  } finally { client.release(); }
});

afterAll(async () => {
  await pool?.end();
  if (bootstrap) {
    await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await bootstrap.end();
  }
});

beforeEach(async () => {
  if (!pool) return;
  await pool.query(`TRUNCATE messages, chat_assignment_events, opportunity_distribution_state, chat_transfer_operations, team_agent_distribution_state,
    chats, user_workspace_presence, team_members, teams, users, workspaces CASCADE;
    INSERT INTO workspaces VALUES ('${workspace}', 'America/Sao_Paulo');
    INSERT INTO users VALUES ('${agent}', 'Shared agent');
    INSERT INTO teams VALUES ('${teamA}', '${workspace}', 'A'), ('${teamB}', '${workspace}', 'B');
    INSERT INTO team_members VALUES ('${teamA}', '${agent}'), ('${teamB}', '${agent}');
    INSERT INTO user_workspace_presence VALUES ('${agent}', '${workspace}', true, NOW(), NOW(), NOW() - interval '1 hour');
    INSERT INTO chats(id,workspace_id,agent_id,status) SELECT gen_random_uuid(), '${workspace}', '${agent}', 'atendimentos' FROM generate_series(1,24);
    INSERT INTO chats(id,workspace_id,agent_id,status) VALUES ('${incomingA}', '${workspace}', NULL, 'gerais'), ('${incomingB}', '${workspace}', NULL, 'gerais');`);
});

afterEach(()=>vi.unstubAllEnvs());

describe.skipIf(!url)('shared agent contention on PostgreSQL', () => {
  it.each(['same','changed'])('serializes an in-flight repeated operation with %s intent',async(intent)=>{
    vi.stubEnv('CHAT_DISTRIBUTION_MODE','active');
    const first=await pool!.connect(),second=await pool!.connect();
    let repeated:Promise<Awaited<ReturnType<typeof readTransferOperation>>> | undefined;
    try {
      await first.query('BEGIN');await second.query('BEGIN');
      await second.query("SET LOCAL statement_timeout='5s'");
      await lockWorkspaceAssignments(first,workspace);
      const chosen=await selectFairAgentForTeam(first,{workspaceId:workspace,teamId:teamA,chatId:incomingA,source:'test'});
      expect(chosen.selection?.agentId).toBe(agent);
      await first.query("UPDATE chats SET agent_id=$1,status='atendimentos' WHERE id=$2",[agent,incomingA]);
      await saveTransferOperation(first,{workspaceId:workspace,actorId:agent,operationId:'in-flight',requestHash:'same',
        chatId:incomingA,outcome:'assigned',agentId:agent,agentName:'Shared agent',teamId:teamA});
      const pid=(await second.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      repeated=(async()=>{await lockWorkspaceAssignments(second,workspace);return readTransferOperation(second,workspace,agent,'in-flight',intent);})();
      void repeated.catch(()=>undefined);
      await expect.poll(async()=> (await pool!.query<{blockers:number[]}>('SELECT pg_blocking_pids($1) AS blockers',[pid])).rows[0].blockers.length).toBeGreaterThan(0);
      await first.query('COMMIT');
      expect(await repeated).toMatchObject(intent==='same'?{conflict:false,assignedAgent:{id:agent}}:{conflict:true});
      await second.query('COMMIT');
      expect((await pool!.query('SELECT * FROM chat_assignment_events')).rows).toHaveLength(1);
      expect((await pool!.query('SELECT * FROM chat_transfer_operations')).rows).toHaveLength(1);
      expect((await pool!.query('SELECT * FROM opportunity_distribution_state')).rows).toHaveLength(1);
    } finally {
      await first.query('ROLLBACK').catch(()=>undefined);await repeated?.catch(()=>undefined);
      await second.query('ROLLBACK').catch(()=>undefined);first.release();second.release();
    }
  });
  it.each(['legacy','active','shadow'].flatMap(mode=>['COMMIT','ROLLBACK'].map(finish=>[mode,finish])))('rechecks shared work without a portfolio ceiling in %s after another team finishes with %s', async (mode,finish) => {
    vi.stubEnv('CHAT_DISTRIBUTION_MODE',mode);
    const first = await pool!.connect();
    const second = await pool!.connect();
    let pending: ReturnType<typeof selectFairAgentForTeam> | undefined;
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await second.query("SET LOCAL statement_timeout = '5s'");
      const firstPid = (await first.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const secondPid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const chosen = await selectFairAgentForTeam(first, {
        workspaceId: workspace, teamId: teamA, chatId: incomingA, source: 'test',
      });
      expect(chosen.selection?.agentId).toBe(agent);
      await first.query("UPDATE chats SET agent_id = $1, status = 'atendimentos' WHERE id = $2", [agent, incomingA]);

      pending = selectFairAgentForTeam(second, {
        workspaceId: workspace, teamId: teamB, chatId: incomingB, source: 'test',
      });
      // Attach a handler immediately so a test failure cannot leave an unhandled rejection.
      void pending.catch(() => undefined);
      await expect.poll(async () => {
        const result = await pool!.query<{ blockers: number[] }>('SELECT pg_blocking_pids($1) AS blockers', [secondPid]);
        return result.rows[0].blockers;
      }, { timeout: 2000 }).toContain(firstPid);

      await first.query(finish);
      const next = await pending;
      expect(next.selection).toMatchObject({agentId:agent,portfolioCount:finish==='COMMIT'?25:24,maxPortfolio:null});
      await second.query("UPDATE chats SET agent_id = $1, status = 'atendimentos' WHERE id = $2", [agent, incomingB]);
      await second.query('COMMIT');
      const count = await pool!.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM chats WHERE agent_id = $1 AND status = 'atendimentos'", [agent]);
      expect(count.rows[0].count).toBe(finish==='COMMIT'?26:25);
      expect((await pool!.query('SELECT * FROM chat_assignment_events')).rows).toHaveLength(finish==='COMMIT'?2:1);
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await pending?.catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      first.release();
      second.release();
    }
  });
});
