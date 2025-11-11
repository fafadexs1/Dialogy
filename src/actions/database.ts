

'use server';

import { db } from '@/lib/db';

const PERMISSIONS = [
    // Workspace & Settings
    { id: 'workspace:settings:view', category: 'Workspace', description: 'Visualizar configurações do workspace' },
    { id: 'workspace:settings:edit', category: 'Workspace', description: 'Editar configurações do workspace' },
    { id: 'workspace:invites:manage', category: 'Workspace', description: 'Criar e revogar convites para o workspace' },
    // Members & Permissions
    { id: 'members:view', category: 'Membros', description: 'Visualizar membros do workspace' },
    { id: 'members:remove', category: 'Membros', description: 'Remover membros do workspace' },
    { id: 'permissions:view', category: 'Membros', description: 'Visualizar papéis e permissões' },
    { id: 'permissions:edit', category: 'Membros', description: 'Criar, editar e atribuir papéis e permissões' },
    // Teams
    { id: 'teams:view', category: 'Equipes', description: 'Visualizar equipes' },
    { id: 'teams:edit', category: 'Equipes', description: 'Criar, editar e remover equipes e seus membros' },
    // CRM
    { id: 'crm:view', category: 'CRM', description: 'Visualizar contatos e suas informações' },
    { id: 'crm:edit', category: 'CRM', description: 'Criar e editar contatos e suas informações' },
    { id: 'crm:delete', category: 'CRM', description: 'Excluir contatos' },
    // Campaigns
    { id: 'campaigns:manage', category: 'Campanhas', description: 'Criar, visualizar e gerenciar campanhas' },
    { id: 'campaigns:delete', category: 'Campanhas', description: 'Excluir campanhas' },
    // Automations
    { id: 'automations:manage', category: 'Automações', description: 'Gerenciar o Piloto Automático e Agentes do Sistema' },
    // Analytics
    { id: 'analytics:view', category: 'Analytics', description: 'Visualizar a página de Analytics' },
    // Billing
    { id: 'billing:view', category: 'Faturamento', description: 'Visualizar a página de faturamento e histórico' },
];

const TABLE_CREATION_QUERIES = `
-- ============================================
-- Extensões e função utilitária
-- ============================================
create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

-- ============================================
-- ENUMS para chats e messages
-- ============================================
DO $$ BEGIN
    CREATE TYPE public.chat_status_enum AS ENUM ('gerais', 'atendimentos', 'encerrados');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.message_type_enum AS ENUM ('text', 'system', 'audio', 'image', 'video', 'document');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;


-- ============================================
-- Tabelas independentes / catálogos
-- ============================================

-- Artefato do Prisma (mantido)
create table if not exists public._prisma_migrations (
  id               varchar primary key,
  checksum         varchar not null,
  finished_at      timestamptz,
  migration_name   varchar not null,
  logs             text,
  rolled_back_at   timestamptz,
  started_at       timestamptz not null default now(),
  applied_steps_count int not null default 0
);

-- Catálogo de permissões
create table if not exists public.permissions (
  id text primary key,
  description text not null,
  category text not null
);

-- ============================================
-- Núcleo: users e workspaces (quebra de ciclo)
-- ============================================

-- 1) USERS (ainda sem FK para workspaces)
create table if not exists public.users (
  id uuid primary key,
  full_name text,
  email text unique,
  avatar_url text,
  last_active_workspace_id uuid, -- FK adicionada depois
  created_at timestamptz default timezone('utc'::text, now()),
  updated_at timestamptz default timezone('utc'::text, now()),
  is_superadmin boolean not null default false,
  phone text
);

-- 2) WORKSPACES (já referenciando users.owner_id)
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  avatar_url text,
  owner_id uuid not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  timezone text default 'America/Sao_Paulo',
  constraint workspaces_owner_id_fkey
    foreign key (owner_id) references public.users(id) on delete cascade
);

create index if not exists idx_workspaces_owner on public.workspaces(owner_id);

-- 3) Agora adiciona a FK users.last_active_workspace_id -> workspaces.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'users_last_active_workspace_id_fkey'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_last_active_workspace_id_fkey
      FOREIGN KEY (last_active_workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;
  END IF;
END;
$$;


-- ============================================
-- Estruturas por workspace
-- ============================================

-- Roles
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  workspace_id uuid not null,
  is_default boolean not null default false,
  constraint roles_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade
);
create unique index if not exists uq_roles_workspace_name on public.roles(workspace_id, name);

-- Tags
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  label text not null,
  value text not null,
  color text not null,
  is_close_reason boolean not null default false,
  created_by_id uuid,
  constraint tags_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint tags_created_by_id_fkey
    foreign key (created_by_id) references public.users(id) on delete set null
);
create unique index if not exists uq_tags_workspace_value on public.tags(workspace_id, value);
create index if not exists idx_tags_workspace on public.tags(workspace_id);

-- Teams
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  color text not null default '#cccccc',
  role_id uuid not null,
  tag_id uuid,
  owner_id uuid not null,
  constraint teams_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint teams_role_id_fkey
    foreign key (role_id) references public.roles(id) on delete restrict,
  constraint teams_tag_id_fkey
    foreign key (tag_id) references public.tags(id) on delete set null,
  constraint teams_owner_id_fkey
    foreign key (owner_id) references public.users(id) on delete cascade
);
create unique index if not exists uq_teams_workspace_name on public.teams(workspace_id, name);
create index if not exists idx_teams_workspace on public.teams(workspace_id);

-- Business hours
create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  day_of_week text not null,
  is_enabled boolean not null default false,
  start_time text,
  end_time text,
  constraint business_hours_team_id_fkey
    foreign key (team_id) references public.teams(id) on delete cascade
);
create index if not exists idx_business_hours_team on public.business_hours(team_id);

-- Exceções de agenda
create table if not exists public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  date date not null,
  description varchar not null,
  is_closed boolean not null default false,
  start_time time,
  end_time time,
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now()),
  constraint schedule_exceptions_team_id_fkey
    foreign key (team_id) references public.teams(id) on delete cascade
);
create index if not exists idx_schedule_exceptions_team on public.schedule_exceptions(team_id);

-- Users em workspaces (papéis)
create table if not exists public.user_workspace_roles (
  user_id uuid not null,
  workspace_id uuid not null,
  role_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint user_workspace_roles_pkey primary key (user_id, workspace_id),
  constraint user_workspace_roles_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade,
  constraint user_workspace_roles_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint user_workspace_roles_role_id_fkey
    foreign key (role_id) references public.roles(id) on delete restrict
);
create index if not exists idx_uwr_role on public.user_workspace_roles(role_id);

-- Convites de workspace
create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  code text not null,
  created_by uuid not null,
  expires_at timestamptz not null,
  max_uses int,
  is_revoked boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  constraint workspace_invites_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint workspace_invites_created_by_fkey
    foreign key (created_by) references public.users(id) on delete cascade
);
create unique index if not exists uq_workspace_invites_workspace_code on public.workspace_invites(workspace_id, code);

create table if not exists public.user_invites (
  invite_id uuid not null,
  user_id uuid not null,
  used_at timestamptz not null default timezone('utc', now()),
  constraint user_invites_pkey primary key (invite_id, user_id),
  constraint user_invites_invite_id_fkey
    foreign key (invite_id) references public.workspace_invites(id) on delete cascade,
  constraint user_invites_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade
);

-- Campos customizados (definições)
create table if not exists public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  label text not null,
  type text not null,
  placeholder text,
  options jsonb,
  constraint custom_field_definitions_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade
);
create index if not exists idx_cfd_workspace on public.custom_field_definitions(workspace_id);

-- Contatos
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  email text,
  phone text,
  phone_number_jid text,
  address text,
  avatar_url text,
  owner_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint contacts_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint contacts_owner_id_fkey
    foreign key (owner_id) references public.users(id) on delete set null
);
create index if not exists idx_contacts_workspace on public.contacts(workspace_id);
create unique index if not exists uq_contacts_workspace_phone_jid on public.contacts(workspace_id, phone_number_jid);


-- Valores de campos customizados
create table if not exists public.contact_custom_field_values (
  contact_id uuid not null,
  field_id uuid not null,
  value text not null,
  constraint contact_custom_field_values_pkey primary key (contact_id, field_id),
  constraint contact_custom_field_values_contact_id_fkey
    foreign key (contact_id) references public.contacts(id) on delete cascade,
  constraint contact_custom_field_values_field_id_fkey
    foreign key (field_id) references public.custom_field_definitions(id) on delete cascade
);

-- Tags do contato
create table if not exists public.contact_tags (
  contact_id uuid not null,
  tag_id uuid not null,
  constraint contact_tags_pkey primary key (contact_id, tag_id),
  constraint contact_tags_contact_id_fkey
    foreign key (contact_id) references public.contacts(id) on delete cascade,
  constraint contact_tags_tag_id_fkey
    foreign key (tag_id) references public.tags(id) on delete cascade
);

-- Atividades
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null,
  user_id uuid,
  type text not null,
  notes text not null,
  date timestamptz not null,
  constraint activities_contact_id_fkey
    foreign key (contact_id) references public.contacts(id) on delete cascade,
  constraint activities_user_id_fkey
    foreign key (user_id) references public.users(id) on delete set null
);
create index if not exists idx_activities_contact on public.activities(contact_id);

-- Shortcuts
create table if not exists public.shortcuts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  name text not null,
  message text not null,
  type text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint shortcuts_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint shortcuts_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade
);
create index if not exists idx_shortcuts_workspace on public.shortcuts(workspace_id);
create unique index if not exists uq_shortcuts_workspace_name on public.shortcuts(workspace_id, name);

-- System Agents
create table if not exists public.system_agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  avatar_url text,
  token text not null,
  webhook_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  created_by_id uuid,
  constraint system_agents_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint system_agents_created_by_id_fkey
    foreign key (created_by_id) references public.users(id) on delete set null,
  constraint uq_system_agents_token unique(token)
);
create index if not exists idx_system_agents_workspace on public.system_agents(workspace_id);

-- Clusters WhatsApp
create table if not exists public.whatsapp_clusters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  api_url text not null,
  api_key text not null,
  is_active boolean not null default true,
  metrics jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create unique index if not exists uq_whatsapp_clusters_name on public.whatsapp_clusters(name);


-- Instâncias Evolution
create table if not exists public.evolution_api_instances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cluster_id uuid,
  instance_name text not null,
  display_name text,
  type text,
  webhook_url text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint evolution_api_instances_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint evolution_api_instances_cluster_id_fkey
    foreign key (cluster_id) references public.whatsapp_clusters(id) on delete set null
);
create unique index if not exists uq_evo_instances_workspace_name on public.evolution_api_instances(workspace_id, instance_name);
create index if not exists idx_evo_instances_cluster on public.evolution_api_instances(cluster_id);

-- Campanhas
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  created_by_id uuid,
  name text not null,
  message text not null,
  instance_name text not null,
  status text not null,
  created_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  completed_at timestamptz,
  constraint campaigns_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint campaigns_created_by_id_fkey
    foreign key (created_by_id) references public.users(id) on delete set null
);
create index if not exists idx_campaigns_workspace on public.campaigns(workspace_id);

-- Destinatários da campanha
create table if not exists public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  contact_id uuid not null,
  status text not null default 'pending',
  sent_at timestamptz,
  error_message text,
  constraint campaign_recipients_campaign_id_fkey
    foreign key (campaign_id) references public.campaigns(id) on delete cascade,
  constraint campaign_recipients_contact_id_fkey
    foreign key (contact_id) references public.contacts(id) on delete cascade
);
create index if not exists idx_campaign_recipients_campaign on public.campaign_recipients(campaign_id);
create index if not exists idx_campaign_recipients_contact on public.campaign_recipients(contact_id);

-- Chats
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  contact_id uuid not null,
  agent_id uuid,
  status public.chat_status_enum not null default 'gerais',
  tag text,
  color text,
  assigned_at timestamptz,
  closed_at timestamptz,
  close_reason_tag_id uuid,
  closeNotes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint chats_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint chats_contact_id_fkey
    foreign key (contact_id) references public.contacts(id) on delete cascade,
  constraint chats_agent_id_fkey
    foreign key (agent_id) references public.users(id) on delete set null,
  constraint chats_close_reason_tag_id_fkey
    foreign key (close_reason_tag_id) references public.tags(id) on delete set null
);
create index if not exists idx_chats_workspace on public.chats(workspace_id);
create index if not exists idx_chats_contact on public.chats(contact_id);
create index if not exists idx_chats_agent on public.chats(agent_id);

-- Mensagens
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  chat_id uuid not null,
  sender_user_id uuid,
  sender_system_agent_id uuid,
  type public.message_type_enum not null,
  content text,
  from_me boolean not null default false,
  is_read boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  message_id_from_api text,
  api_message_status text,
  instance_name text,
  sender_from_api text,
  source_from_api text,
  raw_payload jsonb,
  metadata jsonb,
  transcription text,
  sent_by_tab text,
  constraint messages_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint messages_chat_id_fkey
    foreign key (chat_id) references public.chats(id) on delete cascade,
  constraint messages_sender_user_id_fkey
    foreign key (sender_user_id) references public.users(id) on delete set null,
  constraint messages_sender_system_agent_id_fkey
    foreign key (sender_system_agent_id) references public.system_agents(id) on delete set null
);
create index if not exists idx_messages_workspace on public.messages(workspace_id);
create index if not exists idx_messages_chat on public.messages(chat_id);
create index if not exists idx_messages_created_at on public.messages(created_at);

-- Role <-> Permission
create table if not exists public.role_permissions (
  role_id uuid not null,
  permission_id text not null,
  constraint role_permissions_pkey primary key (role_id, permission_id),
  constraint role_permissions_role_id_fkey
    foreign key (role_id) references public.roles(id) on delete cascade,
  constraint role_permissions_permission_id_fkey
    foreign key (permission_id) references public.permissions(id) on delete cascade
);

-- Membros do time
create table if not exists public.team_members (
  team_id uuid not null,
  user_id uuid not null,
  constraint team_members_pkey primary key (team_id, user_id),
  constraint team_members_team_id_fkey
    foreign key (team_id) references public.teams(id) on delete cascade,
  constraint team_members_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade
);
create index if not exists idx_team_members_user on public.team_members(user_id);

-- Autopilot: configs
create table if not exists public.autopilot_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  gemini_api_key text,
  ai_model text,
  knowledge_base text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint autopilot_configs_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint autopilot_configs_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade
);
create unique index if not exists uq_autopilot_configs_workspace_user on public.autopilot_configs(workspace_id, user_id);
create index if not exists idx_autopilot_configs_workspace on public.autopilot_configs(workspace_id);


-- Autopilot: regras
create table if not exists public.autopilot_rules (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null,
  name text not null,
  trigger text not null,
  action jsonb not null,
  enabled boolean not null default true,
  constraint autopilot_rules_config_id_fkey
    foreign key (config_id) references public.autopilot_configs(id) on delete cascade
);
create index if not exists idx_autopilot_rules_config on public.autopilot_rules(config_id);

-- Autopilot: logs de uso
create table if not exists public.autopilot_usage_logs (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null,
  flow_name text not null,
  rule_name text,
  model_name text not null,
  input_tokens int,
  output_tokens int,
  total_tokens int,
  created_at timestamptz not null default timezone('utc', now()),
  constraint autopilot_usage_logs_config_id_fkey
    foreign key (config_id) references public.autopilot_configs(id) on delete cascade
);
create index if not exists idx_autopilot_usage_config on public.autopilot_usage_logs(config_id);

-- Billing (1:1 workspace)
create table if not exists public.billing_info (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique,
  plan text,
  status text,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint billing_info_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade
);

-- NEW: Instance Costs
create table if not exists public.instance_costs (
  type text primary key,
  cost numeric(10, 2) not null,
  updated_at timestamptz not null default timezone('utc', now())
);

-- ============================================
-- Novas Tabelas: Planos e Integrações
-- ============================================

-- Tabela para os planos de assinatura
CREATE TABLE IF NOT EXISTS public.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Tabela de junção para configurar integrações por plano
CREATE TABLE IF NOT EXISTS public.plan_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL,
    integration_id TEXT NOT NULL,
    included_quantity INT NOT NULL DEFAULT 0,
    additional_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT plan_integrations_plan_id_fkey
        FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_integration on public.plan_integrations(plan_id, integration_id);


-- ============================================
-- Gatilho para sincronização de novos usuários (Supabase Auth)
-- ============================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, full_name, avatar_url, email, phone)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    new.email,
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

-- drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================
-- Gatilho para apagar usuário da public.users
-- ============================================
create or replace function public.handle_deleted_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.users where id = old.id;
  return old;
end;
$$;

create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute procedure public.handle_deleted_user();


-- ============================================
-- Triggers de updated_at (somente onde há coluna)
-- ============================================
create or replace function public._create_updated_at_trigger(tbl regclass) returns void
language plpgsql as $$
begin
  execute format('
    do $inner$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_schema = ''public'' and table_name = %L and column_name = ''updated_at''
      ) and not exists (
        select 1 from pg_trigger where tgname = ''trg_'' || %L || ''_set_updated_at''
      ) then
        execute ''create trigger trg_'' || %L || ''_set_updated_at''
                 before update on public.'' || %I ||
                 '' for each row execute procedure public.set_updated_at();'';
      end if;
    end
    $inner$;', split_part(tbl::text, '.', 2), split_part(tbl::text, '.', 2), split_part(tbl::text, '.', 2), tbl);
end;
$$;

select public._create_updated_at_trigger('public.users');
select public._create_updated_at_trigger('public.workspaces');
select public._create_updated_at_trigger('public.contacts');
select public._create_updated_at_trigger('public.chats');
select public._create_updated_at_trigger('public.shortcuts');
select public._create_updated_at_trigger('public.whatsapp_clusters');
select public._create_updated_at_trigger('public.schedule_exceptions');
select public._create_updated_at_trigger('public.billing_info');
select public._create_updated_at_trigger('public.autopilot_configs');
select public._create_updated_at_trigger('public.instance_costs'); -- NEW
select public._create_updated_at_trigger('public.plans'); -- NEW

drop function if exists public._create_updated_at_trigger(regclass);
`;


export async function initializeDatabase(): Promise<{ success: boolean; message: string }> {
  console.log('[DB_SETUP] Iniciando a configuração completa do banco de dados...');
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    console.log('[DB_SETUP] Transação iniciada.');

    // --- 1. Executar script de criação de tabelas e tipos ---
    console.log('[DB_SETUP] Criando tabelas, tipos, e funções se não existirem...');
    await client.query(TABLE_CREATION_QUERIES);
    console.log('[DB_SETUP] Verificação/criação de estrutura do DB concluída.');
    
    // --- 2. Popular permissões padrão ---
    console.log('[DB_SETUP] Verificando e populando a tabela de permissões...');
    const existingPermissions = await client.query('SELECT id FROM permissions');
    const existingIds = new Set(existingPermissions.rows.map(p => p.id));
    
    const permissionsToInsert = PERMISSIONS.filter(p => !existingIds.has(p.id));

    if (permissionsToInsert.length > 0) {
        const permValues = permissionsToInsert.map(p => `('${p.id}', '${p.category}', '${p.description.replace(/'/g, "''")}')`).join(',');
        await client.query(`INSERT INTO permissions (id, category, description) VALUES ${permValues}`);
        console.log(`[DB_SETUP] ${permissionsToInsert.length} novas permissões foram inseridas.`);
    } else {
        console.log('[DB_SETUP] Todas as permissões padrão já existem. Nenhuma inserção necessária.');
    }

    // --- 3. Popular custos iniciais ---
    console.log('[DB_SETUP] Verificando e populando a tabela de custos de instância...');
    await client.query(`
        INSERT INTO instance_costs (type, cost) VALUES ('baileys', 35.00) ON CONFLICT (type) DO NOTHING;
    `);
     await client.query(`
        INSERT INTO instance_costs (type, cost) VALUES ('wa_cloud', 50.00) ON CONFLICT (type) DO NOTHING;
    `);
    console.log('[DB_SETUP] Custos iniciais das instâncias garantidos.');


    await client.query('COMMIT');
    console.log('[DB_SETUP] Transação concluída com sucesso.');

    return {
      success: true,
      message: "Banco de dados inicializado e verificado com sucesso! As tabelas e permissões necessárias foram criadas.",
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[DB_SETUP] Erro durante a inicialização do banco de dados:', error);
    return {
      success: false,
      message: `Falha na inicialização: ${error.message}`,
    };
  } finally {
    client.release();
    console.log('[DB_SETUP] Conexão com o banco de dados liberada.');
  }
}
