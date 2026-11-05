import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), getUser: vi.fn(), permission: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/workspace-permissions', () => ({ hasWorkspacePermission: mocks.permission }));
vi.mock('@/services/chat-distribution/team-availability-server', () => ({ getWorkspaceTeamAvailability: vi.fn() }));
import { getTeams } from '@/actions/teams';

let sql: PGlite;
beforeAll(async () => {
  sql = new PGlite();
  await sql.exec(`
    CREATE TABLE teams (id text, name text, color text, role_id text, tag_id text, workspace_id text, agent_routing_config jsonb);
    CREATE TABLE tags (id text, workspace_id text, label text);
    CREATE TABLE users (id text, full_name text, avatar_url text);
    CREATE TABLE team_members (team_id text, user_id text);
    CREATE TABLE business_hours (id text, team_id text, day_of_week text, is_enabled boolean, start_time text, end_time text);
    CREATE TABLE schedule_exceptions (id text, team_id text, date date, description text, is_closed boolean, start_time text, end_time text);
    INSERT INTO teams VALUES ('team', 'Suporte', '#549078', 'role', null, 'workspace', '{}'), ('foreign', 'Outra empresa', '#549078', 'role', null, 'foreign-workspace', '{}');
    INSERT INTO schedule_exceptions VALUES
      ('past', 'team', CURRENT_DATE - 10, 'Feriado passado', true, null, null),
      ('today', 'team', CURRENT_DATE, 'Hoje', true, null, null),
      ('future', 'team', CURRENT_DATE + 10, 'Próximo evento', false, '09:00', '12:00'),
      ('foreign', 'foreign', CURRENT_DATE - 20, 'Outro workspace', true, null, null);
  `);
});
afterAll(async () => { await sql.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user' } } });
  mocks.permission.mockResolvedValue(true);
  mocks.query.mockImplementation((query: string, params: unknown[]) => sql.query(query, params));
});

describe('team calendar SQL regression', () => {
  it('returns persisted historical, current and future records, limited to the workspace', async () => {
    const result = await getTeams('workspace');
    expect(result.error).toBeUndefined();
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].scheduleExceptions.map(item => item.id)).toEqual(['past', 'today', 'future']);
    expect(mocks.permission).toHaveBeenCalledWith('user', 'workspace', 'teams:view');
  });

  it('never queries team data when authentication or permission is missing', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await getTeams('workspace')).teams).toEqual([]);
    mocks.permission.mockResolvedValueOnce(false);
    expect((await getTeams('workspace')).teams).toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
