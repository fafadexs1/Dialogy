-- supabase/migrations/YYYYMMDDHHMMSS_create_integrations_tables.sql

-- Habilitar a extensão pgcrypto se ainda não estiver habilitada
create extension if not exists pgcrypto with schema extensions;

-- Tabela de Workspaces
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  avatar_url text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);
comment on table public.workspaces is 'Stores workspace information.';

-- Tabela de junção para usuários e workspaces (muitos-para-muitos)
create table if not exists public.user_workspaces (
  user_id uuid references public.users(id) on delete cascade not null,
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  role text default 'member' not null, -- Ex: 'admin', 'member'
  primary key (user_id, workspace_id)
);
comment on table public.user_workspaces is 'Links users to workspaces with specific roles.';

-- Tabela de Perfis/Contatos (já deve existir, mas vamos adicionar RLS e workspace_id)
-- Esta é uma alteração conceitual. A tabela `profiles` deve ser adaptada.
-- Supondo que a tabela `profiles` já existe.
alter table public.profiles add column if not exists workspace_id uuid references public.workspaces(id);
-- Limpar políticas antigas se existirem
drop policy if exists "Users can manage their own profiles." on public.profiles;
-- RLS para perfis
-- alter table public.profiles enable row level security;
-- create policy "Users can view profiles in their workspace." on public.profiles
--   for select using (
--     auth.uid() in (
--       select user_id from user_workspaces where workspace_id = profiles.workspace_id
--     )
--   );


-- Tabela de Configurações da Evolution API (ligada ao workspace)
create table if not exists public.evolution_api_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null unique,
  api_url text,
  api_key text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);
comment on table public.evolution_api_configs is 'Stores global Evolution API settings for each workspace.';

-- Tabela de Instâncias da Evolution API (ligada à configuração global)
create table if not exists public.evolution_api_instances (
  id uuid primary key default gen_random_uuid(),
  config_id uuid references public.evolution_api_configs(id) on delete cascade not null,
  name text not null,
  type text not null, -- 'baileys' or 'wa_cloud'
  created_at timestamptz default timezone('utc'::text, now()) not null
);
comment on table public.evolution_api_instances is 'Stores individual Evolution API instances for a workspace.';

-- Adicionar workspace_id às tabelas de comunicação
alter table public.chats add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.messages add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;


-- POLÍTICAS DE SEGURANÇA (RLS) --

-- Workspaces
alter table public.workspaces enable row level security;
drop policy if exists "Authenticated users can view workspaces they belong to." on public.workspaces;
create policy "Authenticated users can view workspaces they belong to." on public.workspaces
  for select using (
    auth.uid() in (
      select user_id from user_workspaces where workspace_id = id
    )
  );

-- User Workspaces
alter table public.user_workspaces enable row level security;
drop policy if exists "Users can view their own workspace associations." on public.user_workspaces;
create policy "Users can view their own workspace associations." on public.user_workspaces
  for select using (auth.uid() = user_id);

-- Evolution API Configs
alter table public.evolution_api_configs enable row level security;
drop policy if exists "Users can manage configs of their workspaces." on public.evolution_api_configs;
create policy "Users can manage configs of their workspaces." on public.evolution_api_configs
  for all using (
    auth.uid() in (
      select user_id from user_workspaces where workspace_id = evolution_api_configs.workspace_id
    )
  );

-- Evolution API Instances
alter table public.evolution_api_instances enable row level security;
drop policy if exists "Users can manage instances in their workspaces." on public.evolution_api_instances;
create policy "Users can manage instances in their workspaces." on public.evolution_api_instances
  for all using (
    auth.uid() in (
      select uw.user_id from user_workspaces uw
      join evolution_api_configs eac on eac.workspace_id = uw.workspace_id
      where eac.id = evolution_api_instances.config_id
    )
  );
  
-- Chats
alter table public.chats enable row level security;
drop policy if exists "Users can access chats in their workspaces." on public.chats;
create policy "Users can access chats in their workspaces." on public.chats
  for all using (
    auth.uid() in (
      select user_id from user_workspaces where workspace_id = chats.workspace_id
    )
  );

-- Messages
alter table public.messages enable row level security;
drop policy if exists "Users can access messages in their workspaces." on public.messages;
create policy "Users can access messages in their workspaces." on public.messages
  for all using (
    auth.uid() in (
      select user_id from user_workspaces where workspace_id = messages.workspace_id
    )
  );
