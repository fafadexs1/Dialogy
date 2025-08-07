-- Remover a política antiga e a tabela 'profiles' se existirem.
drop policy if exists "Users can access profiles of workspaces they are part of" on public.profiles;
drop table if exists public.profiles;

-- Remover a tabela 'user_workspaces' se existir, para recriá-la com a referência correta.
drop table if exists public.user_workspaces;

-- Criar tabela de workspaces
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  avatar_url text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Criar tabela de junção para usuários (de auth.users) e workspaces
create table if not exists public.user_workspaces (
  user_id uuid references auth.users(id) on delete cascade not null,
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  primary key (user_id, workspace_id)
);

-- Criar a nova tabela de contatos (clientes não autenticados)
create table if not exists public.contacts (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id) on delete cascade not null,
    name text not null,
    email text,
    phone text,
    avatar_url text,
    created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Remover tabelas antigas de chat e mensagens para recriar com as colunas e chaves corretas.
drop table if exists public.messages;
drop table if exists public.chats;

-- Alterar a tabela de chats para referenciar 'contacts' e 'auth.users'
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  contact_id uuid references public.contacts(id) on delete cascade,
  agent_id uuid references auth.users(id) on delete cascade,
  status text not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Alterar a tabela de mensagens para referenciar 'auth.users' ou 'contacts' (requer lógica na aplicação)
-- Para simplificar a RLS, vamos assumir que o sender_id é sempre um auth.users(id) por enquanto.
-- A lógica da aplicação pode diferenciar entre agente e contato.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  chat_id uuid references public.chats(id) on delete cascade not null,
  sender_id uuid references auth.users(id), -- Pode ser o agente. A lógica para o contato será via app.
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

-- Habilitar RLS (Row-Level Security)
alter table public.workspaces enable row level security;
alter table public.user_workspaces enable row level security;
alter table public.contacts enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.evolution_api_configs enable row level security;
alter table public.evolution_api_instances enable row level security;

-- Função auxiliar para checar pertencimento ao workspace
create or replace function public.is_member_of_workspace(p_workspace_id uuid)
returns boolean as $$
begin
  return exists (
    select 1
    from public.user_workspaces
    where user_id = auth.uid() and workspace_id = p_workspace_id
  );
end;
$$ language plpgsql security definer;


-- Políticas de RLS
drop policy if exists "Users can see workspaces they are part of" on public.workspaces;
create policy "Users can see workspaces they are part of"
on public.workspaces for select
using ( public.is_member_of_workspace(id) );

drop policy if exists "Users can see their own workspace memberships" on public.user_workspaces;
create policy "Users can see their own workspace memberships"
on public.user_workspaces for select
using ( auth.uid() = user_id );

drop policy if exists "Users can access contacts of workspaces they are part of" on public.contacts;
create policy "Users can access contacts of workspaces they are part of"
on public.contacts for all
using ( public.is_member_of_workspace(workspace_id) );

drop policy if exists "Users can access chats of workspaces they are part of" on public.chats;
create policy "Users can access chats of workspaces they are part of"
on public.chats for all
using ( public.is_member_of_workspace(workspace_id) );

drop policy if exists "Users can access messages of workspaces they are part of" on public.messages;
create policy "Users can access messages of workspaces they are part of"
on public.messages for all
using ( public.is_member_of_workspace(workspace_id) );

drop policy if exists "Users can access API configs of workspaces they are part of" on public.evolution_api_configs;
create policy "Users can access API configs of workspaces they are part of"
on public.evolution_api_configs for all
using ( public.is_member_of_workspace(workspace_id) );

drop policy if exists "Users can access API instances of workspaces they are part of" on public.evolution_api_instances;
create policy "Users can access API instances of workspaces they are part of"
on public.evolution_api_instances for all
using (
  config_id in (
    select id from public.evolution_api_configs where public.is_member_of_workspace(workspace_id)
  )
);
