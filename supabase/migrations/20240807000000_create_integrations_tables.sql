-- supabase/migrations/YYYYMMDDHHMMSS_create_integrations_tables.sql

-- Tabela para armazenar Workspaces (empresas/times)
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz with time zone default timezone('utc'::text, now()) not null,
  name text not null,
  owner_id uuid references auth.users(id) not null
);

-- Tabela de junção para associar usuários a workspaces (muitos-para-muitos)
create table if not exists user_workspaces (
  user_id uuid references auth.users(id) not null,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  primary key (user_id, workspace_id)
);

-- Tabela para configurações da Evolution API, agora vinculada ao workspace
create table if not exists evolution_api_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade not null,
  api_url text,
  api_key text,
  created_at timestamptz with time zone default timezone('utc'::text, now()) not null,
  unique(workspace_id)
);

-- Tabela para instâncias da Evolution API, indiretamente vinculada ao workspace através do config
create table if not exists evolution_api_instances (
  id uuid primary key default gen_random_uuid(),
  config_id uuid references evolution_api_configs(id) on delete cascade not null,
  name text not null,
  type text not null default 'baileys', -- 'baileys' ou 'wa_cloud'
  created_at timestamptz with time zone default timezone('utc'::text, now()) not null
);

-- Função auxiliar para verificar a associação do usuário a um workspace
create or replace function is_workspace_member(ws_id uuid, u_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from user_workspaces where workspace_id = ws_id and user_id = u_id
  );
$$;


-- Ativar RLS para todas as tabelas
alter table workspaces enable row level security;
alter table user_workspaces enable row level security;
alter table evolution_api_configs enable row level security;
alter table evolution_api_instances enable row level security;


-- Políticas para WORKSPACES
-- Usuários podem ver workspaces dos quais são membros
create policy "Allow members to read own workspaces" on workspaces for select
  using (is_workspace_member(id, auth.uid()));

-- Usuários podem criar novos workspaces
create policy "Allow users to create workspaces" on workspaces for insert
  with check (auth.uid() = owner_id);

-- Somente o dono pode atualizar ou deletar o workspace
create policy "Allow owner to update workspace" on workspaces for update
  using (auth.uid() = owner_id);

create policy "Allow owner to delete workspace" on workspaces for delete
  using (auth.uid() = owner_id);


-- Políticas para USER_WORKSPACES
-- Membros do workspace podem ver quem mais está no workspace
create policy "Allow members to read user_workspaces" on user_workspaces for select
  using (is_workspace_member(workspace_id, auth.uid()));

-- Donos de workspace podem adicionar/remover membros
create policy "Allow owner to manage members" on user_workspaces for all
  using (
    exists (
      select 1 from workspaces where id = user_workspaces.workspace_id and owner_id = auth.uid()
    )
  );


-- Políticas para EVOLUTION_API_CONFIGS
-- Usuários só podem ver/modificar configurações do workspace do qual são membros
create policy "Allow members to manage evolution_api_configs" on evolution_api_configs for all
  using (is_workspace_member(workspace_id, auth.uid()));


-- Políticas para EVOLUTION_API_INSTANCES
-- Usuários só podem ver/modificar instâncias pertencentes a um workspace do qual são membros
create policy "Allow members to manage evolution_api_instances" on evolution_api_instances for all
  using (
    is_workspace_member((select workspace_id from evolution_api_configs where id = evolution_api_instances.config_id), auth.uid())
  );
