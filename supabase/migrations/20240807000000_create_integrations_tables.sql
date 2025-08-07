
-- Create Workspaces table
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  avatar_url text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  owner_id uuid references auth.users(id)
);

-- Create User_Workspaces table for many-to-many relationship
create table user_workspaces (
  user_id uuid references auth.users(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete cascade,
  role text not null default 'member', -- e.g., 'admin', 'member'
  primary key (user_id, workspace_id)
);

-- Add workspace_id to profiles and other tables
-- Note: This assumes you want to associate existing entities with workspaces.
-- You might need a more sophisticated data migration strategy for existing data.
alter table profiles add column workspace_id uuid references workspaces(id);
alter table chats add column workspace_id uuid references workspaces(id);
alter table messages add column workspace_id uuid references workspaces(id);


-- Create Evolution API Configs table
create table evolution_api_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade not null,
  api_url text,
  api_key text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null,
  unique(workspace_id)
);

-- Create Evolution API Instances table
create table evolution_api_instances (
  id uuid primary key default gen_random_uuid(),
  config_id uuid references evolution_api_configs(id) on delete cascade not null,
  name text not null,
  type text not null default 'baileys', -- 'baileys' or 'wa_cloud'
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Policies for workspaces
alter table workspaces enable row level security;
create policy "Users can see workspaces they are members of" on workspaces for select using (
  id in (select workspace_id from user_workspaces where user_id = auth.uid())
);
create policy "Workspace owners can update their workspaces" on workspaces for update using (
    auth.uid() = owner_id
);
create policy "Users can create workspaces" on workspaces for insert with check (
    auth.uid() = owner_id
);

-- Policies for user_workspaces
alter table user_workspaces enable row level security;
create policy "Users can view their own workspace memberships" on user_workspaces for select using (
  auth.uid() = user_id
);
-- Add policies for insert/update/delete as needed, likely restricted to admins

-- Policies for profiles
alter table profiles enable row level security;
create policy "Users can view profiles in their workspaces" on profiles for select using (
    workspace_id in (select workspace_id from user_workspaces where user_id = auth.uid())
);
create policy "Users can update their own profile" on profiles for update using (
    auth.uid() = id
);
create policy "Users can insert their own profile" on profiles for insert with check (
    auth.uid() = id
);


-- Policies for evolution_api_configs
alter table evolution_api_configs enable row level security;
create policy "Users can manage configs for workspaces they are members of" on evolution_api_configs for all using (
  workspace_id in (select workspace_id from user_workspaces where user_id = auth.uid())
);

-- Policies for evolution_api_instances
alter table evolution_api_instances enable row level security;
create policy "Users can manage instances for configs in their workspaces" on evolution_api_instances for all using (
  config_id in (
    select id from evolution_api_configs where workspace_id in (
      select workspace_id from user_workspaces where user_id = auth.uid()
    )
  )
);

-- Policies for chats
alter table chats enable row level security;
create policy "Users can view chats in their workspaces" on chats for select using (
  workspace_id in (select workspace_id from user_workspaces where user_id = auth.uid())
);
create policy "Users can insert chats in their workspaces" on chats for insert with check (
  workspace_id in (select workspace_id from user_workspaces where user_id = auth.uid())
);
create policy "Users can update chats in their workspaces" on chats for update using (
  workspace_id in (select workspace_id from user_workspaces where user_id = auth.uid())
);


-- Policies for messages
alter table messages enable row level security;
create policy "Users can view messages in their workspaces" on messages for select using (
  workspace_id in (select workspace_id from user_worke_workspaces where user_id = auth.uid())
);
create policy "Users can insert messages in their workspaces" on messages for insert with check (
  workspace_id in (select workspace_id from user_workspaces where user_id = auth.uid())
);
