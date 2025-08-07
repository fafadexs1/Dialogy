-- Create Workspaces table
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- Create a join table for users and workspaces (many-to-many)
create table user_workspaces (
  user_id uuid references auth.users(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete cascade,
  role text check (role in ('owner', 'member')),
  primary key (user_id, workspace_id)
);

-- Add workspace_id to profiles and other tables
-- Profiles are now contacts within a workspace
alter table profiles
add column workspace_id uuid references workspaces(id) on delete cascade;

create table chats (
    id uuid primary key default gen_random_uuid(),
    contact_id uuid references profiles(id) on delete cascade not null,
    agent_id uuid references profiles(id) on delete cascade,
    workspace_id uuid references workspaces(id) on delete cascade not null,
    status text check (status in ('atendimentos', 'gerais', 'encerrados')) not null,
    created_at timestamptz default now()
);

create table messages (
    id uuid primary key default gen_random_uuid(),
    chat_id uuid references chats(id) on delete cascade not null,
    sender_id uuid references profiles(id) on delete cascade not null,
    workspace_id uuid references workspaces(id) on delete cascade not null,
    content text not null,
    created_at timestamptz default now()
);


-- Create Evolution API Config table (belongs to a workspace)
create table evolution_api_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade not null,
  api_url text,
  api_key text,
  unique(workspace_id)
);

-- Create Evolution API Instances table (belongs to a config)
create table evolution_api_instances (
  id uuid primary key default gen_random_uuid(),
  config_id uuid references evolution_api_configs(id) on delete cascade not null,
  name text not null,
  type text check (type in ('baileys', 'wa_cloud')) not null
);


-- Helper function to check user's role in a workspace
create or replace function is_member_of(p_workspace_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
as $$
begin
  return exists (
    select 1
    from user_workspaces
    where user_workspaces.workspace_id = p_workspace_id
      and user_workspaces.user_id = p_user_id
  );
end;
$$;


-- RLS Policies
-- Users can see workspaces they are members of.
alter table workspaces enable row level security;
create policy "Users can see their own workspaces" on workspaces
  for select using (is_member_of(id, auth.uid()));

-- Profiles RLS
alter table profiles enable row level security;
create policy "Users can view profiles in their workspaces" on profiles
  for select using (is_member_of(workspace_id, auth.uid()));
create policy "Users can insert profiles into their workspaces" on profiles
  for insert with check (is_member_of(workspace_id, auth.uid()));

-- Chats RLS
alter table chats enable row level security;
create policy "Users can view chats in their workspaces" on chats
  for select using (is_member_of(workspace_id, auth.uid()));
create policy "Users can insert chats into their workspaces" on chats
  for insert with check (is_member_of(workspace_id, auth.uid()));
create policy "Users can update chats in their workspaces" on chats
  for update using (is_member_of(workspace_id, auth.uid()));

-- Messages RLS
alter table messages enable row level security;
create policy "Users can view messages in their workspaces" on messages
  for select using (is_member_of(workspace_id, auth.uid()));
create policy "Users can insert messages into their workspaces" on messages
  for insert with check (is_member_of(workspace_id, auth.uid()));


-- Evolution Configs RLS
alter table evolution_api_configs enable row level security;
create policy "Workspace members can manage their config" on evolution_api_configs
  for all using (is_member_of(workspace_id, auth.uid()));

-- Evolution Instances RLS
alter table evolution_api_instances enable row level security;
create policy "Workspace members can manage their instances" on evolution_api_instances
  for all using (
    exists (
      select 1 from evolution_api_configs
      where evolution_api_configs.id = evolution_api_instances.config_id
      and is_member_of(evolution_api_configs.workspace_id, auth.uid())
    )
  );

