

'use server';

import { db } from '@/lib/db';
import { PERMISSIONS } from '@/lib/permissions-catalog';



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

DO $$ BEGIN
    CREATE TYPE public.meta_channel_type_enum AS ENUM ('instagram', 'messenger');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.message_direction_enum AS ENUM ('incoming', 'outgoing');
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

-- Garantir colunas opcionais de configuração do workspace (bases já criadas)
alter table if exists public.workspaces add column if not exists close_message_template text not null default '';
alter table if exists public.workspaces add column if not exists transfer_team_message_template text not null default '';
alter table if exists public.workspaces add column if not exists marketing_auto_close_seconds integer not null default 300;
alter table if exists public.workspaces add column if not exists queue_auto_close_seconds integer not null default 0;
alter table if exists public.workspaces add column if not exists conversion_counter_mode text not null default 'won_deals';
alter table if exists public.workspaces add column if not exists conversion_custom_field_id uuid;
alter table if exists public.workspaces add column if not exists conversion_custom_field_value text;
create index if not exists idx_workspaces_conversion_custom_field_id on public.workspaces(conversion_custom_field_id);

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
  meta_contact_id uuid,
  converted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint contacts_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint contacts_owner_id_fkey
    foreign key (owner_id) references public.users(id) on delete set null
);
alter table if exists public.contacts add column if not exists converted_at timestamptz;
create index if not exists idx_contacts_workspace on public.contacts(workspace_id);
create index if not exists idx_contacts_workspace_converted_at on public.contacts(workspace_id, converted_at);
create unique index if not exists uq_contacts_workspace_phone_jid on public.contacts(workspace_id, phone_number_jid);
create index if not exists idx_contacts_meta_contact on public.contacts(meta_contact_id);


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
-- Ensure webhook_url can be null (marketing agents)
alter table if exists public.system_agents alter column webhook_url drop not null;
alter table if exists public.system_agents alter column avatar_url drop not null;
alter table if exists public.system_agents add column if not exists type text default 'default';
alter table if exists public.system_agents add column if not exists handoff_system_agent_id uuid;
alter table if exists public.system_agents add column if not exists hide_from_chatlist boolean not null default false;
alter table if exists public.system_agents add column if not exists autopilot_config_id uuid;
alter table if exists public.system_agents add column if not exists team_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'system_agents_handoff_system_agent_id_fkey'
  ) then
    alter table public.system_agents
      add constraint system_agents_handoff_system_agent_id_fkey
      foreign key (handoff_system_agent_id) references public.system_agents(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'system_agents_autopilot_config_id_fkey'
  ) then
    alter table public.system_agents
      add constraint system_agents_autopilot_config_id_fkey
      foreign key (autopilot_config_id) references public.autopilot_configs(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'system_agents_team_id_fkey'
  ) then
    alter table public.system_agents
      add constraint system_agents_team_id_fkey
      foreign key (team_id) references public.teams(id) on delete set null;
  end if;
end$$;

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
  webhook_key text,
  display_name text,
  type text,
  webhook_url text,
  business_name text,
  waba_name text,
  display_phone_number text,
  verified_name text,
  waba_id text,
  phone_number_id text,
  telegram_bot_id text,
  telegram_bot_username text,
  telegram_bot_name text,
  telegram_bot_token text,
  telegram_webhook_url text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint evolution_api_instances_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint evolution_api_instances_cluster_id_fkey
    foreign key (cluster_id) references public.whatsapp_clusters(id) on delete set null
);
alter table if exists public.evolution_api_instances add column if not exists webhook_key text;
alter table if exists public.evolution_api_instances add column if not exists business_name text;
alter table if exists public.evolution_api_instances add column if not exists waba_name text;
alter table if exists public.evolution_api_instances add column if not exists display_phone_number text;
alter table if exists public.evolution_api_instances add column if not exists verified_name text;
alter table if exists public.evolution_api_instances add column if not exists waba_id text;
alter table if exists public.evolution_api_instances add column if not exists phone_number_id text;
alter table if exists public.evolution_api_instances add column if not exists telegram_bot_id text;
alter table if exists public.evolution_api_instances add column if not exists telegram_bot_username text;
alter table if exists public.evolution_api_instances add column if not exists telegram_bot_name text;
alter table if exists public.evolution_api_instances add column if not exists telegram_bot_token text;
alter table if exists public.evolution_api_instances add column if not exists telegram_webhook_url text;
create unique index if not exists uq_evo_instances_workspace_name on public.evolution_api_instances(workspace_id, instance_name);
create index if not exists idx_evo_instances_cluster on public.evolution_api_instances(cluster_id);
create index if not exists idx_evo_instances_webhook_key on public.evolution_api_instances(webhook_key);

-- Bots Telegram
create table if not exists public.telegram_bot_instances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  instance_name text not null,
  webhook_key text not null,
  display_name text,
  webhook_url text,
  bot_token text not null,
  bot_id text,
  bot_username text,
  bot_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint telegram_bot_instances_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade
);
create unique index if not exists uq_telegram_instances_workspace_name on public.telegram_bot_instances(workspace_id, instance_name);
create unique index if not exists uq_telegram_instances_instance_name on public.telegram_bot_instances(instance_name);
create unique index if not exists uq_telegram_instances_webhook_key on public.telegram_bot_instances(webhook_key);

-- Eventos de webhook do Telegram
create table if not exists public.telegram_webhook_events (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null,
  workspace_id uuid not null,
  update_id bigint not null,
  event_type text,
  telegram_message_id bigint,
  telegram_chat_id text,
  telegram_from_id text,
  payload jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint telegram_webhook_events_instance_id_fkey
    foreign key (instance_id) references public.telegram_bot_instances(id) on delete cascade,
  constraint telegram_webhook_events_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade
);
create unique index if not exists uq_telegram_webhook_events_instance_update on public.telegram_webhook_events(instance_id, update_id);
create index if not exists idx_telegram_webhook_events_workspace on public.telegram_webhook_events(workspace_id, created_at desc);

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
  protocol text,
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
create index if not exists idx_chats_workspace_status on public.chats(workspace_id, status);
create index if not exists idx_chats_workspace_contact_id on public.chats(workspace_id, contact_id, id);
create index if not exists idx_chats_workspace_status_agent on public.chats(workspace_id, status, agent_id);
-- Garantir coluna de protocolo em chats (para bases já criadas)
alter table if exists public.chats add column if not exists protocol text;
alter table if exists public.chats add column if not exists assigned_system_agent_id uuid;
create unique index if not exists idx_chats_protocol on public.chats(protocol);
create index if not exists idx_chats_assigned_system_agent on public.chats(assigned_system_agent_id)
  where assigned_system_agent_id is not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chats_assigned_system_agent_id_fkey'
  ) then
    alter table public.chats
      add constraint chats_assigned_system_agent_id_fkey
      foreign key (assigned_system_agent_id) references public.system_agents(id) on delete set null;
  end if;
end$$;
update public.chats
   set protocol = COALESCE(protocol, 'PRT-' || upper(replace(id::text, '-', '')))
 where protocol is null;

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
  platform public.meta_channel_type_enum,
  external_message_id text,
  external_sender_id text,
  external_channel_id text,
  direction public.message_direction_enum,
  media_url text,
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
create index if not exists idx_messages_chat_created on public.messages(chat_id, created_at desc);
create index if not exists idx_messages_chat_created_id_desc on public.messages(chat_id, created_at desc, id desc);
create index if not exists idx_messages_workspace_created on public.messages(workspace_id, created_at desc);
create index if not exists idx_messages_unread on public.messages(chat_id)
  where from_me = false and coalesce(is_read, false) = false;

-- Garantir colunas opcionais novas em messages
alter table if exists public.messages add column if not exists platform public.meta_channel_type_enum;
alter table if exists public.messages add column if not exists external_message_id text;
alter table if exists public.messages add column if not exists external_sender_id text;
alter table if exists public.messages add column if not exists external_channel_id text;
alter table if exists public.messages add column if not exists direction public.message_direction_enum;
alter table if exists public.messages add column if not exists media_url text;

-- Meta Channels (Instagram/Messenger)
create table if not exists public.meta_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  type public.meta_channel_type_enum not null,
  external_page_id text,
  ig_business_id text,
  access_token text not null,
  app_secret text,
  verify_token text not null,
  name text,
  status text not null default 'active',
  settings jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint meta_channels_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade
);
create unique index if not exists uq_meta_channels_type_page on public.meta_channels(type, external_page_id);
create unique index if not exists uq_meta_channels_type_igbiz on public.meta_channels(type, ig_business_id);
create unique index if not exists uq_meta_channels_workspace_verify_token on public.meta_channels(workspace_id, verify_token);
create index if not exists idx_meta_channels_workspace on public.meta_channels(workspace_id);

create table if not exists public.meta_contacts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null,
  contact_id uuid not null,
  external_id text not null,
  username text,
  name text,
  profile_pic text,
  last_seen_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint meta_contacts_channel_id_fkey
    foreign key (channel_id) references public.meta_channels(id) on delete cascade,
  constraint meta_contacts_contact_id_fkey
    foreign key (contact_id) references public.contacts(id) on delete cascade
);
create unique index if not exists uq_meta_contacts_channel_external on public.meta_contacts(channel_id, external_id);
create index if not exists idx_meta_contacts_contact on public.meta_contacts(contact_id);
create index if not exists idx_meta_contacts_contact_created_desc on public.meta_contacts(contact_id, created_at desc);

-- Add FK constraint and migration for contacts.meta_contact_id
alter table if exists public.contacts add column if not exists meta_contact_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contacts_meta_contact_id_fkey'
  ) then
    alter table public.contacts
      add constraint contacts_meta_contact_id_fkey
      foreign key (meta_contact_id) references public.meta_contacts(id) on delete set null;
  end if;
end$$;

-- Migrate existing data: set meta_contact_id on contacts that have a meta_contact
update public.contacts c
set meta_contact_id = mc.id
from public.meta_contacts mc
where mc.contact_id = c.id
  and c.meta_contact_id is null;

create table if not exists public.meta_conversations (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null,
  meta_contact_id uuid not null,
  chat_id uuid not null,
  external_thread_id text not null,
  platform public.meta_channel_type_enum not null,
  last_message_at timestamptz not null default timezone('utc', now()),
  status text not null default 'open',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint meta_conversations_channel_id_fkey
    foreign key (channel_id) references public.meta_channels(id) on delete cascade,
  constraint meta_conversations_meta_contact_id_fkey
    foreign key (meta_contact_id) references public.meta_contacts(id) on delete cascade,
  constraint meta_conversations_chat_id_fkey
    foreign key (chat_id) references public.chats(id) on delete cascade
);
create unique index if not exists uq_meta_conversations_channel_thread on public.meta_conversations(channel_id, external_thread_id);
create index if not exists idx_meta_conversations_channel on public.meta_conversations(channel_id);
create index if not exists idx_meta_conversations_chat on public.meta_conversations(chat_id);

create table if not exists public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid,
  source text not null,
  direction text not null default 'incoming',
  event text,
  status_code int,
  payload jsonb,
  headers jsonb,
  response_body jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint webhook_logs_channel_id_fkey
    foreign key (channel_id) references public.meta_channels(id) on delete set null
);
create index if not exists idx_webhook_logs_channel on public.webhook_logs(channel_id);
create index if not exists idx_webhook_logs_source on public.webhook_logs(source);

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
drop index if exists uq_autopilot_configs_workspace_user;
create table if not exists public.autopilot_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  name text not null default 'Agente de IA',
  gemini_api_key text,
  ai_model text,
  knowledge_base text,
  knowledge_base_documents jsonb,
  is_primary boolean not null default false,
  is_active boolean not null default false,
  default_fallback_reply text,
  escalation_policy text,
  closing_policy text,
  enabled_tool_names jsonb,
  flow_graph jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint autopilot_configs_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint autopilot_configs_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade
);
create index if not exists idx_autopilot_configs_workspace_user on public.autopilot_configs(workspace_id, user_id);
create index if not exists idx_autopilot_configs_workspace on public.autopilot_configs(workspace_id);
alter table if exists public.autopilot_configs add column if not exists escalation_policy text;
alter table if exists public.autopilot_configs add column if not exists closing_policy text;
alter table if exists public.autopilot_configs add column if not exists enabled_tool_names jsonb;
alter table if exists public.autopilot_configs add column if not exists transcription_model text;
alter table if exists public.autopilot_configs add column if not exists flow_graph jsonb;

-- Autopilot: rascunhos e versoes
create table if not exists public.autopilot_config_drafts (
  config_id uuid primary key,
  workspace_id uuid not null,
  user_id uuid not null,
  snapshot jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint autopilot_config_drafts_config_id_fkey
    foreign key (config_id) references public.autopilot_configs(id) on delete cascade,
  constraint autopilot_config_drafts_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint autopilot_config_drafts_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade
);
create index if not exists idx_autopilot_config_drafts_workspace on public.autopilot_config_drafts(workspace_id);

create table if not exists public.autopilot_config_versions (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null,
  workspace_id uuid not null,
  user_id uuid,
  version_number int not null,
  label text,
  snapshot jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint autopilot_config_versions_config_id_fkey
    foreign key (config_id) references public.autopilot_configs(id) on delete cascade,
  constraint autopilot_config_versions_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint autopilot_config_versions_user_id_fkey
    foreign key (user_id) references public.users(id) on delete set null,
  constraint autopilot_config_versions_config_number_key unique (config_id, version_number)
);
create index if not exists idx_autopilot_config_versions_config_created on public.autopilot_config_versions(config_id, version_number desc);

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
  chat_id uuid,
  system_agent_id uuid,
  input_message text,
  output_message text,
  status text,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint autopilot_usage_logs_config_id_fkey
    foreign key (config_id) references public.autopilot_configs(id) on delete cascade
);
create index if not exists idx_autopilot_usage_config on public.autopilot_usage_logs(config_id);
create index if not exists idx_autopilot_usage_chat on public.autopilot_usage_logs(chat_id) where chat_id is not null;
create index if not exists idx_autopilot_usage_system_agent on public.autopilot_usage_logs(system_agent_id) where system_agent_id is not null;

create table if not exists public.agent_tool_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  chat_id uuid,
  system_agent_id uuid,
  autopilot_config_id uuid,
  tool_name text not null,
  status text not null,
  input jsonb,
  output jsonb,
  error text,
  requires_human_approval boolean not null default false,
  approved_by_user_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  constraint agent_tool_executions_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint agent_tool_executions_chat_id_fkey
    foreign key (chat_id) references public.chats(id) on delete set null,
  constraint agent_tool_executions_system_agent_id_fkey
    foreign key (system_agent_id) references public.system_agents(id) on delete set null,
  constraint agent_tool_executions_autopilot_config_id_fkey
    foreign key (autopilot_config_id) references public.autopilot_configs(id) on delete set null,
  constraint agent_tool_executions_approved_by_user_id_fkey
    foreign key (approved_by_user_id) references public.users(id) on delete set null
);
create index if not exists idx_agent_tool_executions_workspace_created on public.agent_tool_executions(workspace_id, created_at desc);
create index if not exists idx_agent_tool_executions_chat on public.agent_tool_executions(chat_id) where chat_id is not null;
create index if not exists idx_agent_tool_executions_system_agent on public.agent_tool_executions(system_agent_id) where system_agent_id is not null;

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

-- Tabela de integrações editáveis
CREATE TABLE IF NOT EXISTS public.app_integrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon_url TEXT,
    tag TEXT,
    tag_type TEXT,
    href TEXT,
    status TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_integrations_id on public.app_integrations(id);


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

-- System Settings (Key-Value pairs for configs)
create table if not exists public.system_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Async Queue Jobs
create table if not exists public.queue_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  status text not null default 'queued',
  payload jsonb not null,
  attempts int not null default 0,
  max_attempts int not null default 5,
  priority int not null default 0,
  run_at timestamptz not null default timezone('utc', now()),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists idx_queue_jobs_status_run_at on public.queue_jobs(status, run_at);
create index if not exists idx_queue_jobs_type on public.queue_jobs(type);
create index if not exists idx_queue_jobs_locked_at on public.queue_jobs(locked_at);


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
select public._create_updated_at_trigger('public.meta_channels'); -- NEW
select public._create_updated_at_trigger('public.meta_contacts'); -- NEW
select public._create_updated_at_trigger('public.meta_contacts'); -- NEW
select public._create_updated_at_trigger('public.meta_conversations'); -- NEW
select public._create_updated_at_trigger('public.system_settings'); -- NEW
select public._create_updated_at_trigger('public.queue_jobs'); -- NEW

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

    // --- 4. Popular integrações padrão ---
    console.log('[DB_SETUP] Verificando e populando a tabela de integrações...');
    await client.query(`
        INSERT INTO app_integrations (id, name, description, icon_url, tag, tag_type, href, status) VALUES
        ('evolution-api', 'Evolution API', 'Gerencie instancias de WhatsApp com QR Code ou Cloud API.', '/icons/whatsapp.svg', 'WhatsApp', 'primary', '/integrations/evolution-api', 'active'),
        ('telegram', 'Telegram Bot', 'Gerencie bots do Telegram com webhook proprio e eventos separados.', '/icons/telegram.svg', 'Telegram', 'primary', '/integrations/telegram', 'active'),
        ('dialogflow', 'Google Dialogflow', 'Conecte agentes de IA avan?ados do Dialogflow para automatizar conversas.', 'https://www.gstatic.com/dialogflow-console/common/assets/img/logo-mobile.png', 'IA', 'secondary', '#', 'coming_soon'),
        ('stripe', 'Stripe', 'Integre pagamentos e cobran?as diretamente nas suas conversas.', 'https://stripe.com/img/v3/home/twitter.png', 'Pagamentos', 'beta', '#', 'coming_soon'),
        ('meta-instagram', 'Instagram Direct (Oficial)', 'Receba e envie mensagens do Instagram Direct com a API oficial do Meta.', 'https://static-00.iconduck.com/assets.00/instagram-icon-256x256-gxth2yqu.png', 'Instagram', 'primary', '/integrations/meta-instagram', 'active'),
        ('meta-messenger', 'Facebook Messenger (Oficial)', 'Integra??o direta ao Messenger com Webhooks e Graph API.', 'https://static-00.iconduck.com/assets.00/messenger-icon-256x256-fjxn4yz0.png', 'Messenger', 'primary', '/integrations/meta-messenger', 'active')
        ON CONFLICT (id) DO NOTHING;
    `);
    console.log('[DB_SETUP] Integrações padrão garantidas.');


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
