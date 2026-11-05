import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { transferIntentHash, saveTransferOperation, readTransferOperation } from '@/services/chat-distribution/transfer-operation';
import {distributionRolloutMetrics} from '@/services/chat-distribution/rollout-metrics';
import { selectFairAgentForTeam } from '@/services/chat-distribution/fair-distribution';

const workspace = '11111111-1111-1111-1111-111111111111';
const foreignWorkspace = '22222222-2222-2222-2222-222222222222';
const team = '33333333-3333-3333-3333-333333333333';
const secondTeam = '44444444-4444-4444-4444-444444444444';
const agentA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const agentB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const chatA = '55555555-5555-5555-5555-555555555555';
const chatB = '66666666-6666-6666-6666-666666666666';
const incoming = '77777777-7777-7777-7777-777777777777';
let sql: PGlite;
let client: PoolClient;

beforeAll(async () => {
  sql = new PGlite();
  // PGlite executes the production statements, including row locks; it does
  // not simulate contention between independent PostgreSQL connections.
  client = { query: (query: string, params?: unknown[]) => sql.query(query, params) } as PoolClient;
  await sql.exec(readFileSync(resolve('tests/fixtures/chat-distribution-schema.sql'), 'utf8'));
  await sql.exec(readFileSync(resolve('prisma/migrations/20260713100000_fair_chat_distribution/migration.sql'), 'utf8'));
  await sql.exec(readFileSync(resolve('prisma/migrations/20261028141517_protected_opportunity_distribution/migration.sql'), 'utf8'));
});

afterAll(async () => { await sql.close(); });

beforeEach(async () => {
  await sql.exec(`TRUNCATE messages, chat_assignment_events, opportunity_distribution_state, chat_transfer_operations, team_agent_distribution_state,
    chats, user_workspace_presence, team_members, teams, users, workspaces CASCADE;
    INSERT INTO workspaces VALUES ('${workspace}', 'America/Sao_Paulo'), ('${foreignWorkspace}', 'America/Sao_Paulo');
    INSERT INTO teams VALUES ('${team}', '${workspace}', 'Suporte'), ('${secondTeam}', '${workspace}', 'Outro setor');
    INSERT INTO users VALUES ('${agentA}', 'A'), ('${agentB}', 'B');
    INSERT INTO team_members VALUES ('${team}', '${agentA}'), ('${team}', '${agentB}');
    INSERT INTO user_workspace_presence VALUES
      ('${agentA}', '${workspace}', true, NOW(), NOW(), NOW() - interval '1 hour'),
      ('${agentB}', '${workspace}', true, NOW(), NOW(), NOW() - interval '1 hour');
    INSERT INTO chats(id,workspace_id,agent_id,status) VALUES ('${chatA}', '${workspace}', '${agentA}', 'atendimentos'),
      ('${chatB}', '${workspace}', '${agentB}', 'atendimentos'), ('${incoming}', '${workspace}', NULL, 'gerais');
    INSERT INTO messages(chat_id, workspace_id, from_me, type, created_at) VALUES
      ('${chatA}', '${workspace}', false, 'text', NOW() - interval '2 minutes'),
      ('${chatB}', '${workspace}', true, 'text', NOW() - interval '2 minutes');`);
});

async function select(teamId = team) {
  return selectFairAgentForTeam(client, { workspaceId: workspace, teamId, chatId: incoming, source: 'test' });
}

async function latestCandidates() {
  const { rows } = await sql.query<{ candidate_snapshot: { agentId: string; effectiveLoad: number; lastAssignedAt: string | null }[] }>(
    'SELECT candidate_snapshot FROM chat_assignment_events ORDER BY created_at DESC, id DESC LIMIT 1'
  );
  return rows[0].candidate_snapshot;
}

afterEach(()=>vi.unstubAllEnvs());

describe('fair distribution with PostgreSQL queries', () => {
  it.each([
    { metadata: { isInternalNote: true }, status: 'sent' },
    { metadata: {}, status: 'internal' },
    { metadata: {}, status: 'INTERNAL' },
  ])('keeps a customer pending after an internal note: %j', async ({ metadata, status }) => {
    expect((await select()).selection?.agentId).toBe(agentB);
    await sql.query(`INSERT INTO messages(chat_id, workspace_id, from_me, type, api_message_status, metadata)
      VALUES ($1, $2, true, 'text', $3, $4)`, [chatA, workspace, status, JSON.stringify(metadata)]);
    expect((await select()).selection?.agentId).toBe(agentB);
    expect((await latestCandidates()).find((agent) => agent.agentId === agentA)?.effectiveLoad).toBe(1.25);
  });

  it('reduces load after a real customer-facing reply and ignores system and foreign messages', async () => {
    await sql.query(`INSERT INTO messages(chat_id, workspace_id, from_me, type, created_at) VALUES
      ($1, $2, true, 'system', NOW()), ($1, $3, true, 'text', NOW())`, [chatA, workspace, foreignWorkspace]);
    expect((await select()).selection?.agentId).toBe(agentB);
    await sql.query(`INSERT INTO messages(chat_id, workspace_id, from_me, type) VALUES ($1, $2, true, 'text')`, [chatA, workspace]);
    await select();
    expect((await latestCandidates()).find((agent) => agent.agentId === agentA)?.effectiveLoad).toBe(0.25);
  });

  it('paces a new arrival using their most recent assignment in another team', async () => {
    await sql.query('UPDATE user_workspace_presence SET online_since = NOW() WHERE user_id = $1', [agentA]);
    await sql.query('DELETE FROM messages WHERE chat_id = $1', [chatA]);
    await sql.query(`INSERT INTO team_agent_distribution_state(workspace_id, team_id, user_id, last_assigned_at)
      VALUES ($1, $2, $3, clock_timestamp())`, [workspace, secondTeam, agentA]);
    expect((await select()).selection?.agentId).toBe(agentB);
    expect((await latestCandidates()).find((agent) => agent.agentId === agentA)?.lastAssignedAt).not.toBeNull();
  });

  it('never considers online people outside the requested team', async () => {
    await sql.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [team, agentB]);
    await sql.query('INSERT INTO team_members VALUES ($1, $2)', [secondTeam, agentB]);
    expect((await select()).selection?.agentId).toBe(agentA);
    expect((await latestCandidates()).map((agent) => agent.agentId)).toEqual([agentA]);
  });

  it('rereads a shared portfolio for the next team without enforcing the saved ceiling', async () => {
    await sql.exec(`INSERT INTO team_members VALUES ('${secondTeam}', '${agentA}');
      DELETE FROM team_members WHERE user_id = '${agentB}';
      INSERT INTO chats(id, workspace_id, agent_id, status)
        SELECT gen_random_uuid(), '${workspace}', '${agentA}', 'atendimentos' FROM generate_series(1, 23);`);
    expect((await select()).selection?.agentId).toBe(agentA);
    await sql.query(`UPDATE chats SET agent_id = $1, status = 'atendimentos' WHERE id = $2`, [agentA, incoming]);
    expect(await select(secondTeam)).toMatchObject({selection:{agentId:agentA,portfolioCount:25,maxPortfolio:null},reason:'available'});
  });

  it('rolls back distribution history and audit records with a failed assignment', async () => {
    await sql.exec('BEGIN');
    expect((await select()).selection?.agentId).toBe(agentB);
    await sql.exec('ROLLBACK');
    expect((await sql.query('SELECT * FROM chat_assignment_events')).rows).toHaveLength(0);
    expect((await sql.query('SELECT * FROM team_agent_distribution_state')).rows).toHaveLength(0);
    expect((await select()).selection?.agentId).toBe(agentB);
  });
  it.each([
    {metadata:{event:'transfer_notice'},status:'DELIVERED'},
    {metadata:{},status:'FAILED'}, {metadata:{},status:'PENDING'},
    {metadata:{isMarketing:true},status:'SENT'}, {metadata:{campaignId:'campaign'},status:'READ'},
  ])('keeps incoming work pending after a non-response: %j',async ({metadata,status})=>{
    await sql.query(`INSERT INTO messages(chat_id,workspace_id,from_me,type,api_message_status,metadata)
      VALUES($1,$2,true,'text',$3,$4)`,[chatA,workspace,status,JSON.stringify(metadata)]);
    await select();
    expect((await latestCandidates()).find(c=>c.agentId===agentA)?.effectiveLoad).toBe(1.25);
  });

  it('reserves a transferred conversation until this owner sends a confirmed reply',async()=>{
    await sql.query('UPDATE chats SET assigned_at=clock_timestamp() WHERE id=$1',[chatB]);
    await select();
    expect((await latestCandidates()).find(c=>c.agentId===agentB)?.effectiveLoad).toBe(1);
    await sql.query(`INSERT INTO messages(chat_id,workspace_id,from_me,type,api_message_status,sender_user_id)
      VALUES($1,$2,true,'text','DELIVERED',$3)`,[chatB,workspace,agentB]);
    await select();
    expect((await latestCandidates()).find(c=>c.agentId===agentB)?.effectiveLoad).toBe(0.25);
  });

  it('persists credit for every eligible candidate and reverses it with the assignment',async()=>{
    vi.stubEnv('CHAT_DISTRIBUTION_MODE','active');
    await sql.query('DELETE FROM messages');
    await sql.exec('BEGIN');
    await select();
    const state=await sql.query<{balance:number}>('SELECT balance FROM opportunity_distribution_state ORDER BY user_id');
    expect(state.rows.map(r=>r.balance)).toEqual([-0.5,0.5]);
    const audit=await sql.query<{policy_version:string}>('SELECT policy_version FROM chat_assignment_events');
    expect(audit.rows[0].policy_version).toBe('opportunity-v3');
    await sql.exec('ROLLBACK');
    expect((await sql.query('SELECT * FROM opportunity_distribution_state')).rows).toHaveLength(0);
  });

  it('resets the opportunity window without importing the legacy score or a previous phase',async()=>{
    vi.stubEnv('CHAT_DISTRIBUTION_MODE','active');
    await sql.query('DELETE FROM messages');
    await sql.query(`INSERT INTO opportunity_distribution_state(workspace_id,team_id,user_id,phase,turn_date,balance)
      VALUES($1,$2,$3,'active',current_date-2,1),($1,$2,$4,'shadow',current_date,1)`,[workspace,team,agentA,agentB]);
    expect((await select()).selection?.agentId).toBe(agentA);
    expect((await sql.query<{balance:number}>("SELECT balance FROM opportunity_distribution_state WHERE phase='active' ORDER BY user_id")).rows.map(r=>r.balance)).toEqual([-0.5,0.5]);
  });

  it('does not change credit, audit, or last assignment when keeping the same owner and team',async()=>{
    vi.stubEnv('CHAT_DISTRIBUTION_MODE','active');
    await sql.query('DELETE FROM team_members WHERE user_id=$1',[agentA]);
    const result=await selectFairAgentForTeam(client,{workspaceId:workspace,teamId:team,chatId:chatB,
      source:'test',currentAgentId:agentB,currentTeamId:team});
    expect(result.noOp).toBe(true);
    expect((await sql.query('SELECT * FROM chat_assignment_events')).rows).toHaveLength(0);
    expect((await sql.query('SELECT * FROM opportunity_distribution_state')).rows).toHaveLength(0);
  });

  it('returns the committed operation once even after ownership changes and rejects changed intent',async()=>{
    const intent={chatId:incoming,teamId:team,expectedAgentId:null,expectedTeamId:null};
    const requestHash=transferIntentHash(intent);
    await saveTransferOperation(client,{workspaceId:workspace,actorId:agentA,operationId:'same-intent',requestHash,
      chatId:incoming,outcome:'assigned',agentId:agentB,agentName:'B',teamId:team});
    await sql.query('UPDATE chats SET agent_id=$1 WHERE id=$2',[agentA,incoming]);
    for(let retry=0;retry<5;retry++) expect(await readTransferOperation(client,workspace,agentA,'same-intent',requestHash))
      .toMatchObject({conflict:false,assignedAgent:{id:agentB}});
    expect(await readTransferOperation(client,workspace,agentA,'same-intent',transferIntentHash({...intent,teamId:secondTeam})))
      .toEqual({conflict:true});
    expect(await readTransferOperation(client,foreignWorkspace,agentA,'same-intent',requestHash)).toBeNull();
    expect((await sql.query<{replay_count:number}>('SELECT replay_count FROM chat_transfer_operations')).rows[0].replay_count).toBe(5);
  });

  it('holds expansion on low volume and stops it when comparable p90 rises more than ten percent',async()=>{
    const since=new Date('2026-10-28T08:00:00Z'),until=new Date('2026-10-28T14:00:00Z');
    expect((await distributionRolloutMetrics(client,workspace,since,until)).gate).toBe('insufficient_volume');
    for(const [date,delay] of [['2026-10-21T08:00:00Z',100],['2026-10-28T08:00:00Z',120]] as const) {
      await sql.query(`INSERT INTO chat_assignment_events(workspace_id,chat_id,team_id,selected_agent_id,source,
        effective_load_before,portfolio_count_before,capacity,fairness_score_before,fairness_score_after,decision_reason,created_at)
        SELECT $1,$2,$3,$4,'test',0,0,6,0,0,'test',$5::timestamptz+i*interval '10 minutes' FROM generate_series(0,29) i`,
        [workspace,chatB,team,agentB,date]);
      await sql.query(`INSERT INTO messages(chat_id,workspace_id,from_me,type,sender_user_id,api_message_status,created_at)
        SELECT $1,$2,true,'text',$3,'DELIVERED',$4::timestamptz+i*interval '10 minutes'+$5*interval '1 second'
        FROM generate_series(0,29) i`,[chatB,workspace,agentB,date,delay]);
    }
    const report=await distributionRolloutMetrics(client,workspace,since,until);
    expect(report.gate).toBe('stop');
    expect(report.periods.find(row=>row.period==='current')).toMatchObject({responded:30,p90_seconds:120});
  });

  it('does not block the unlimited policy on a historical capped-policy count',async()=>{
    const since=new Date(Date.now()-60_000),until=new Date(Date.now()+60_000);
    await sql.query(`INSERT INTO chat_assignment_events(workspace_id,chat_id,team_id,selected_agent_id,source,
      effective_load_before,portfolio_count_before,capacity,fairness_score_before,fairness_score_after,
      decision_reason,policy_version,candidate_snapshot)
      VALUES($1,$2,$3,$4,'test',0,25,6,0,0,'test','opportunity-v2',$5::jsonb)`,
      [workspace,chatA,team,agentA,JSON.stringify([{agentId:agentA,portfolioCount:25,maxPortfolio:25,incomingAlreadyOwned:false}])]);
    const report=await distributionRolloutMetrics(client,workspace,since,until);
    expect(report.portfolioLimit).toBeNull();
    expect(report.periods.find(row=>row.period==='current')?.portfolio_violations).toBe(1);
    expect(report.gate).toBe('insufficient_volume');
  });

  it('keeps the operation journal and opportunity state behind RLS with no public policies',async()=>{
    const {rows}=await sql.query<{relname:string;relrowsecurity:boolean}>(`SELECT relname,relrowsecurity FROM pg_class
      WHERE relname IN ('chat_transfer_operations','opportunity_distribution_state')`);
    expect(rows).toHaveLength(2);
    expect(rows.every(row=>row.relrowsecurity)).toBe(true);
    expect((await sql.query(`SELECT * FROM pg_policies WHERE tablename IN ('chat_transfer_operations','opportunity_distribution_state')`)).rows).toHaveLength(0);
  });

});
