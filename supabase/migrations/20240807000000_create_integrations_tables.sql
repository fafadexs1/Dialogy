-- Arquivo de migração para configurar a arquitetura multi-workspace

-- Remover tabelas existentes na ordem correta para evitar erros de dependência
drop table if exists public.evolution_api_instances;
drop table if exists public.evolution_api_configs;
drop table if exists public.messages;
drop table if exists public.chats;
drop table if exists public.user_workspaces;
drop table if exists public.profiles;
drop table if exists public.workspaces;

-- Criar tabela de workspaces
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  avatar_url text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);
comment on table public.workspaces is 'Stores workspace information.';

-- Criar tabela de perfis de usuário, que podem ser contatos ou agentes
create table if not exists public.profiles (
  id uuid primary key not null references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text
);
comment on table public.profiles is 'Profile information for users and contacts.';

-- Criar tabela de junção para usuários e workspaces (muitos-para-muitos)
create table if not exists public.user_workspaces (
  user_id uuid references public.profiles(id) on delete cascade not null,
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  primary key (user_id, workspace_id)
);
comment on table public.user_workspaces is 'Maps users to their workspaces.';

-- Tabela de Chats, agora vinculada a um workspace
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.profiles(id),
  agent_id uuid references public.profiles(id),
  status text not null,
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);
comment on table public.chats is 'Stores chat conversations within a workspace.';

-- Tabela de Mensagens, agora vinculada a um workspace
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references public.chats(id) on delete cascade,
  sender_id uuid references public.profiles(id),
  content text not null,
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);
comment on table public.messages is 'Stores individual messages within a chat.';

-- Tabela para configurações da Evolution API (por workspace)
create table if not exists public.evolution_api_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  api_url text,
  api_key text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  unique(workspace_id)
);
comment on table public.evolution_api_configs is 'Global Evolution API settings per workspace.';

-- Tabela para instâncias da Evolution API
create table if not exists public.evolution_api_instances (
  id uuid primary key default gen_random_uuid(),
  config_id uuid references public.evolution_api_configs(id) on delete cascade not null,
  name text not null,
  type text not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);
comment on table public.evolution_api_instances is 'Specific Evolution API instances for a configuration.';

-- Habilitar RLS (Row-Level Security)
alter table public.workspaces enable row level security;
alter table public.user_workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.evolution_api_configs enable row level security;
alter table public.evolution_api_instances enable row level security;

-- Políticas de RLS para WORKSPACES
create policy "Users can see workspaces they are part of"
on public.workspaces for select
using (
  id in (
    select workspace_id from public.user_workspaces where user_id = auth.uid()
  )
);
create policy "Users can create workspaces"
on public.workspaces for insert
with check (true);

-- Políticas de RLS para USER_WORKSPACES
create policy "Users can see their own workspace memberships"
on public.user_workspaces for select
using ( auth.uid() = user_id );

-- Políticas de RLS para PROFILES
create policy "Users can see profiles of workspaces they are part of"
on public.profiles for select
using (
  id in (
    select user_id from public.user_workspaces where workspace_id in (
      select workspace_id from public.user_workspaces where user_id = auth.uid()
    )
  )
);

-- Políticas de RLS para CHATS
create policy "Users can access chats of workspaces they are part of"
on public.chats for all
using (
  workspace_id in (
    select workspace_id from public.user_workspaces where user_id = auth.uid()
  )
);

-- Políticas de RLS para MESSAGES
create policy "Users can access messages of workspaces they are part of"
on public.messages for all
using (
  workspace_id in (
    select workspace_id from public.user_workspaces where user_id = auth.uid()
  )
);

-- Políticas de RLS para EVOLUTION_API_CONFIGS
create policy "Users can access API configs of workspaces they are part of"
on public.evolution_api_configs for all
using (
  workspace_id in (
    select workspace_id from public.user_workspaces where user_id = auth.uid()
  )
);

-- Políticas de RLS para EVOLUTION_API_INSTANCES
create policy "Users can access API instances of workspaces they are part of"
on public.evolution_api_instances for all
using (
  config_id in (
    select id from public.evolution_api_configs where workspace_id in (
      select workspace_id from public.user_workspaces where user_id = auth.uid()
    )
  )
);