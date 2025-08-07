
-- Remover restrições de chave estrangeira existentes que dependem da tabela 'profiles'
alter table public.user_workspaces drop constraint if exists user_workspaces_user_id_fkey;
alter table public.chats drop constraint if exists chats_contact_id_fkey;
alter table public.chats drop constraint if exists chats_agent_id_fkey;
alter table public.messages drop constraint if exists messages_sender_id_fkey;

-- Remover a tabela 'profiles' que não é mais necessária
drop table if exists public.profiles;

-- Criar tabela de workspaces se não existir
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

-- Criar tabela de contatos (clientes) por workspace
create table if not exists public.contacts (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id) on delete cascade not null,
    name text not null,
    email text,
    phone text,
    avatar_url text,
    created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Criar tabela de chats por workspace
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  contact_id uuid references public.contacts(id) on delete set null,
  agent_id uuid references auth.users(id) on delete set null,
  status text not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Criar tabela de mensagens por workspace
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  chat_id uuid references public.chats(id) on delete cascade not null,
  sender_id uuid not null, -- Pode ser um auth.users.id ou um contacts.id
  content text not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);


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

-- Habilitar RLS para todas as tabelas
alter table public.workspaces enable row level security;
alter table public.user_workspaces enable row level security;
alter table public.contacts enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.evolution_api_configs enable row level security;
alter table public.evolution_api_instances enable row level security;

-- Limpar políticas antigas antes de criar novas
drop policy if exists "Users can see workspaces they are part of" on public.workspaces;
drop policy if exists "Users can see their own workspace memberships" on public.user_workspaces;
drop policy if exists "Users can access contacts of workspaces they are part of" on public.contacts;
drop policy if exists "Users can access chats of workspaces they are part of" on public.chats;
drop policy if exists "Users can access messages of workspaces they are part of" on public.messages;
drop policy if exists "Users can access API configs of workspaces they are part of" on public.evolution_api_configs;
drop policy if exists "Users can access API instances of workspaces they are part of" on public.evolution_api_instances;


-- Políticas de RLS
create policy "Users can see workspaces they are part of"
on public.workspaces for select
using (auth.uid() in (select user_id from public.user_workspaces where workspace_id = id));

create policy "Users can see their own workspace memberships"
on public.user_workspaces for select
using (auth.uid() = user_id);

create policy "Users can access contacts of workspaces they are part of"
on public.contacts for all
using (workspace_id in (select workspace_id from public.user_workspaces where user_id = auth.uid()));

create policy "Users can access chats of workspaces they are part of"
on public.chats for all
using (workspace_id in (select workspace_id from public.user_workspaces where user_id = auth.uid()));

create policy "Users can access messages of workspaces they are part of"
on public.messages for all
using (workspace_id in (select workspace_id from public.user_workspaces where user_id = auth.uid()));

create policy "Users can access API configs of workspaces they are part of"
on public.evolution_api_configs for all
using (workspace_id in (select workspace_id from public.user_workspaces where user_id = auth.uid()));

create policy "Users can access API instances of workspaces they are part of"
on public.evolution_api_instances for all
using (config_id in (select id from public.evolution_api_configs where workspace_id in (
    select workspace_id from public.user_workspaces where user_id = auth.uid()
)));
