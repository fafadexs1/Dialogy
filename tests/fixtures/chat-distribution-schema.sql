CREATE TABLE workspaces (id uuid PRIMARY KEY, timezone text);
CREATE TABLE users (id uuid PRIMARY KEY, full_name text);
CREATE TABLE teams (id uuid PRIMARY KEY, workspace_id uuid REFERENCES workspaces(id), name text);
CREATE TABLE team_members (
  team_id uuid REFERENCES teams(id), user_id uuid REFERENCES users(id),
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE user_workspace_presence (
  user_id uuid REFERENCES users(id), workspace_id uuid REFERENCES workspaces(id),
  is_online boolean, last_seen timestamptz, recent_activity_at timestamptz, online_since timestamptz,
  PRIMARY KEY (user_id, workspace_id)
);
CREATE TABLE chats (
  id uuid PRIMARY KEY, workspace_id uuid REFERENCES workspaces(id),
  agent_id uuid REFERENCES users(id), status text, assigned_at timestamptz
);
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid REFERENCES chats(id),
  workspace_id uuid REFERENCES workspaces(id), from_me boolean,
  created_at timestamptz DEFAULT clock_timestamp(), type text,
  api_message_status text, metadata jsonb, sender_user_id uuid
);
