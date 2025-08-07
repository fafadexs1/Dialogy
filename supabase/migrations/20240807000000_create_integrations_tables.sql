-- Criar tabela de workspaces
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  avatar_url text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Criar tabela de junção para usuários e workspaces (muitos-para-muitos)
create table if not exists public.user_workspaces (
  user_id uuid references auth.users(id) on delete cascade not null,
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  primary key (user_id, workspace_id)
);

-- Adicionar colunas de workspace_id às tabelas existentes
alter table public.profiles add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.chats add column if not exists workspace_id uuid references public.workspaces(id) not null;
alter table public.messages add column if not exists workspace_id uuid references public.workspaces(id) not null;

-- Tabela para configurações da Evolution API (por workspace)
create table if not exists public.evolution_api_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  api_url text,
  api_key text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  unique(workspace_id)
);

-- Tabela para instâncias da Evolution API
create table if not exists public.evolution_api_instances (
  id uuid primary key default gen_random_uuid(),
  config_id uuid references public.evolution_api_configs(id) on delete cascade not null,
  name text not null,
  type text not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Habilitar RLS (Row-Level Security)
alter table public.workspaces enable row level security;
alter table public.user_workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.evolution_api_configs enable row level security;
alter table public.evolution_api_instances enable row level security;

-- Políticas de RLS para WORKSPACES
drop policy if exists "Users can see workspaces they are part of" on public.workspaces;
create policy "Users can see workspaces they are part of"
on public.workspaces for select
using (
  auth.uid() in (
    select user_id from public.user_workspaces where workspace_id = id
  )
);

-- Políticas de RLS para USER_WORKSPACES
drop policy if exists "Users can see their own workspace memberships" on public.user_workspaces;
create policy "Users can see their own workspace memberships"
on public.user_workspaces for select
using ( auth.uid() = user_id );

-- Políticas de RLS para PROFILES (contatos/agentes dentro do workspace)
drop policy if exists "Users can access profiles of workspaces they are part of" on public.profiles;
create policy "Users can access profiles of workspaces they are part of"
on public.profiles for select
using (
  workspace_id in (
    select workspace_id from public.user_workspaces where user_id = auth.uid()
  )
);

-- Políticas de RLS para CHATS
drop policy if exists "Users can access chats of workspaces they are part of" on public.chats;
create policy "Users can access chats of workspaces they are part of"
on public.chats for all
using (
  workspace_id in (
    select workspace_id from public.user_workspaces where user_id = auth.uid()
  )
);

-- Políticas de RLS para MESSAGES
drop policy if exists "Users can access messages of workspaces they are part of" on public.messages;
create policy "Users can access messages of workspaces they are part of"
on public.messages for all
using (
  workspace_id in (
    select workspace_id from public.user_workspaces where user_id = auth.uid()
  )
);

-- Políticas de RLS para EVOLUTION_API_CONFIGS
drop policy if exists "Users can access API configs of workspaces they are part of" on public.evolution_api_configs;
create policy "Users can access API configs of workspaces they are part of"
on public.evolution_api_configs for all
using (
  workspace_id in (
    select workspace_id from public.user_workspaces where user_id = auth.uid()
  )
);

-- Políticas de RLS para EVOLUTION_API_INSTANCES
drop policy if exists "Users can access API instances of workspaces they are part of" on public.evolution_api_instances;
create policy "Users can access API instances of workspaces they are part of"
on public.evolution_api_instances for all
using (
  config_id in (
    select id from public.evolution_api_configs where workspace_id in (
      select workspace_id from public.user_workspaces where user_id = auth.uid()
    )
  )
);

-- Inserts Iniciais para Mock Data (Opcional, mas útil para desenvolvimento)

-- Inserir workspaces se não existirem
insert into public.workspaces (id, name, avatar_url)
values
  ('a1b2c3d4-e5f6-7890-1234-567890abcdef', 'Dialogy Inc.', 'https://placehold.co/40x40.png'),
  ('b2c3d4e5-f6a7-8901-2345-67890abcdef0', 'InnovateTech', 'https://placehold.co/40x40.png')
on conflict (id) do nothing;

-- Vincular o usuário de teste (se existir) aos workspaces
-- Substitua 'uuid-do-usuario-de-teste' pelo ID do seu usuário de teste no Supabase Auth
-- insert into public.user_workspaces (user_id, workspace_id)
-- values
--   ('uuid-do-usuario-de-teste', 'a1b2c3d4-e5f6-7890-1234-567890abcdef'),
--   ('uuid-do-usuario-de-teste', 'b2c3d4e5-f6a7-8901-2345-67890abcdef0')
-- on conflict (user_id, workspace_id) do nothing;
