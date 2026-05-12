import 'server-only';

import { db } from '@/lib/db';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export type WorkspaceConfig = {
  id: string;
  name: string;
  timezone: string;
  closeMessageTemplate: string;
  transferTeamMessageTemplate: string;
};

async function fetchWorkspaceConfig(workspaceId: string): Promise<WorkspaceConfig> {
  const res = await db.query(
    `SELECT id, name, timezone, close_message_template, transfer_team_message_template
     FROM workspaces
     WHERE id = $1`,
    [workspaceId]
  );

  if (res.rowCount === 0) {
    return {
      id: workspaceId,
      name: '',
      timezone: DEFAULT_TIMEZONE,
      closeMessageTemplate: '',
      transferTeamMessageTemplate: '',
    };
  }

  const row = res.rows[0];
  return {
    id: row.id,
    name: row.name || '',
    timezone: row.timezone || DEFAULT_TIMEZONE,
    closeMessageTemplate: (row.close_message_template || '').trim(),
    transferTeamMessageTemplate: (row.transfer_team_message_template || '').trim(),
  };
}

export async function getWorkspaceConfig(workspaceId: string): Promise<WorkspaceConfig> {
  if (!workspaceId) {
    return {
      id: '',
      name: '',
      timezone: DEFAULT_TIMEZONE,
      closeMessageTemplate: '',
      transferTeamMessageTemplate: '',
    };
  }
  return fetchWorkspaceConfig(workspaceId);
}

export async function getWorkspaceTemplates(workspaceId: string): Promise<{
  closeMessageTemplate: string;
  transferTeamMessageTemplate: string;
}> {
  const config = await getWorkspaceConfig(workspaceId);
  return {
    closeMessageTemplate: config.closeMessageTemplate,
    transferTeamMessageTemplate: config.transferTeamMessageTemplate,
  };
}

export async function getWorkspaceTimezone(workspaceId: string): Promise<string> {
  const config = await getWorkspaceConfig(workspaceId);
  return config.timezone || DEFAULT_TIMEZONE;
}
