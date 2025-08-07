-- Create Workspaces table
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  avatar_url text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Create User_Workspaces join table
create table if not exists user_workspaces (
  user_id uuid references auth.users(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete cascade,
  primary key (user_id, workspace_id)
);

-- Add workspace_id to profiles, chats, and messages if they exist
DO $$
BEGIN
   IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'profiles') THEN
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS workspace_id uuid references workspaces(id);
   END IF;
   IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'chats') THEN
      ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS workspace_id uuid references workspaces(id);
   END IF;
   IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'messages') THEN
      ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS workspace_id uuid references workspaces(id);
   END IF;
END
$$;

-- Create Evolution API Configs table
create table if not exists evolution_api_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade not null,
  api_url text,
  api_key text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  unique(workspace_id)
);

-- Create Evolution API Instances table
create table if not exists evolution_api_instances (
  id uuid primary key default gen_random_uuid(),
  config_id uuid references evolution_api_configs(id) on delete cascade not null,
  name text not null,
  type text not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Function to check if a user is a member of a workspace
create or replace function is_member_of_workspace(p_workspace_id uuid, p_user_id uuid)
returns boolean as $$
  select exists (
    select 1
    from user_workspaces
    where workspace_id = p_workspace_id and user_id = p_user_id
  );
$$ language sql security definer;


-- RLS policies for workspaces
alter table workspaces enable row level security;
drop policy if exists "Users can see workspaces they are members of" on workspaces;
create policy "Users can see workspaces they are members of" on workspaces
  for select using (is_member_of_workspace(id, auth.uid()));

-- RLS policies for evolution_api_configs
alter table evolution_api_configs enable row level security;
drop policy if exists "Workspace members can manage their own API configs" on evolution_api_configs;
create policy "Workspace members can manage their own API configs" on evolution_api_configs
  for all using (is_member_of_workspace(workspace_id, auth.uid()));

-- RLS policies for evolution_api_instances
alter table evolution_api_instances enable row level security;
drop policy if exists "Workspace members can manage their own API instances" on evolution_api_instances;
create policy "Workspace members can manage their own API instances" on evolution_api_instances
  for all using (
    exists (
      select 1 from evolution_api_configs
      where id = evolution_api_instances.config_id and is_member_of_workspace(evolution_api_configs.workspace_id, auth.uid())
    )
  );

-- RLS for profiles, chats, messages
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'profiles') THEN
        ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Users can manage profiles in their workspaces" ON public.profiles;
        CREATE POLICY "Users can manage profiles in their workspaces" ON public.profiles
        FOR ALL USING (is_member_of_workspace(workspace_id, auth.uid()));
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'chats') THEN
        ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Users can manage chats in their workspaces" ON public.chats;
        CREATE POLICY "Users can manage chats in their workspaces" ON public.chats
        FOR ALL USING (is_member_of_workspace(workspace_id, auth.uid()));
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'messages') THEN
        ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Users can manage messages in their workspaces" ON public.messages;
        CREATE POLICY "Users can manage messages in their workspaces" ON public.messages
        FOR ALL USING (is_member_of_workspace(workspace_id, auth.uid()));
    END IF;
END
$$;

