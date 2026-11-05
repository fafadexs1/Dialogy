import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
import { getWorkspaceTeamAvailability } from '@/services/chat-distribution/team-availability-server';
import { selectFairAgentForTeam } from '@/services/chat-distribution/fair-distribution';
import { distributionDiagnostics } from '@/services/chat-distribution/diagnostics';
import type { PoolClient } from 'pg';

const workspace = '11111111-1111-1111-1111-111111111111';
const team = '33333333-3333-3333-3333-333333333333';
const agent = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const incoming = '55555555-5555-5555-5555-555555555555';
let sql: PGlite;
beforeAll(async () => {
  sql = new PGlite();
  await sql.exec(readFileSync('tests/fixtures/chat-distribution-schema.sql', 'utf8'));
  await sql.exec(readFileSync('prisma/migrations/20260713100000_fair_chat_distribution/migration.sql', 'utf8'));
  await sql.exec(readFileSync('prisma/migrations/20261028141517_protected_opportunity_distribution/migration.sql', 'utf8'));
  await sql.exec(`ALTER TABLE teams ADD color text, ADD role_id uuid, ADD tag_id uuid;
    CREATE TABLE business_hours(team_id uuid,day_of_week text,is_enabled boolean,start_time text,end_time text);
    CREATE TABLE schedule_exceptions(team_id uuid,date date,is_closed boolean,start_time text,end_time text);`);
  mocks.query.mockImplementation((query: string, params?: unknown[]) => sql.query(query, params));
});
beforeEach(async () => {
  await sql.exec(`TRUNCATE messages,chats,chat_assignment_events,opportunity_distribution_state,team_agent_distribution_state,
      team_members,user_workspace_presence,teams,users,workspaces CASCADE;
    INSERT INTO workspaces VALUES('${workspace}','America/Sao_Paulo');
    INSERT INTO teams(id,workspace_id,name) VALUES('${team}','${workspace}','Financeiro');
    INSERT INTO users VALUES('${agent}','Atendente');
    INSERT INTO team_members VALUES('${team}','${agent}');
    INSERT INTO user_workspace_presence VALUES('${agent}','${workspace}',true,NOW(),NOW(),NOW()-interval '1 hour');
    INSERT INTO team_agent_distribution_state(workspace_id,team_id,user_id,max_portfolio) VALUES('${workspace}','${team}','${agent}',1);
    INSERT INTO chats(id,workspace_id,agent_id,status) SELECT gen_random_uuid(),'${workspace}','${agent}','atendimentos' FROM generate_series(1,50);
    INSERT INTO chats(id,workspace_id,status) VALUES('${incoming}','${workspace}','gerais');`);
});
afterAll(async () => { await sql.close(); });
afterEach(() => vi.unstubAllEnvs());

describe('unlimited portfolios in displayed availability and selection', () => {
  it('keeps 50 conversations eligible despite a saved limit of one', async () => {
    const [availability] = await getWorkspaceTeamAvailability(workspace);
    expect(availability).toMatchObject({ availability: 'available', onlineMembers: 1, acceptingMembers: 1,
      assignableMembers: 1, activeChats: 50, protectedMembers: 1 });
    const result = await selectFairAgentForTeam({ query: mocks.query } as unknown as PoolClient, {
      workspaceId: workspace, teamId: team, chatId: incoming, source: 'test_unlimited',
    });
    expect(result).toMatchObject({ reason: 'available', selection: { agentId: agent, maxPortfolio: null, portfolioCount: 50 } });
    const { rows } = await sql.query<{ candidate_snapshot: Array<{ maxPortfolio: number | null }> }>('SELECT candidate_snapshot FROM chat_assignment_events');
    expect(rows[0].candidate_snapshot[0].maxPortfolio).toBeNull();
  });

  it('still respects paused distribution regardless of portfolio size', async () => {
    await sql.exec('UPDATE team_agent_distribution_state SET accepting_assignments=false');
    const [availability] = await getWorkspaceTeamAvailability(workspace);
    expect(availability).toMatchObject({ availability: 'not_accepting', acceptingMembers: 0, assignableMembers: 0 });
  });

  it('still respects presence regardless of portfolio size', async () => {
    await sql.exec("UPDATE user_workspace_presence SET is_online=false,recent_activity_at=NULL,last_seen=NOW()-interval '5 hours'");
    const [availability] = await getWorkspaceTeamAvailability(workspace);
    expect(availability).toMatchObject({ availability: 'all_offline', onlineMembers: 0, assignableMembers: 0 });
  });

  it('counts opportunities from both policy versions in the diagnostic alerts', async () => {
    vi.stubEnv('CHAT_DISTRIBUTION_MODE', 'active');
    const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    await sql.query('INSERT INTO users VALUES($1,$2)', [other, 'Outro atendente']);
    await sql.query(`INSERT INTO chat_assignment_events(workspace_id,chat_id,team_id,selected_agent_id,source,
      effective_load_before,portfolio_count_before,capacity,fairness_score_before,fairness_score_after,
      decision_reason,policy_version,decision_snapshot)
      SELECT $1,$2,$3,$4,'test',0,0,6,0,0,'test',CASE WHEN i<3 THEN 'opportunity-v2' ELSE 'opportunity-v3' END,
        $5::jsonb FROM generate_series(1,5) i`, [workspace, incoming, team, other,
      JSON.stringify({ candidates: [{ agentId: agent, reason: 'eligible' }] })]);
    const diagnostic = await distributionDiagnostics({ query: mocks.query } as unknown as PoolClient, workspace, team);
    expect(diagnostic.members[0]).toMatchObject({ maxPortfolio: null, eligibleOpportunities: 5, missedConsecutive: 5, alert: true });
  });
});
