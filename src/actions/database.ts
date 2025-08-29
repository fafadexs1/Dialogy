
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
];

const TABLE_CREATION_QUERIES = `
    -- Enable pgcrypto for gen_random_uuid()
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    -- Base tables with no dependencies
    CREATE TABLE IF NOT EXISTS public.users (
        id uuid NOT NULL PRIMARY KEY,
        full_name text,
        avatar_url text,
        email text,
        online boolean DEFAULT false,
        online_since timestamptz,
        last_active_workspace_id uuid,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.workspaces (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        owner_id uuid NOT NULL REFERENCES public.users(id),
        name text NOT NULL,
        avatar_url text,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        timezone TEXT DEFAULT 'America/Sao_Paulo'
    );
    
    -- Add foreign key constraint to users table after workspaces is created
    ALTER TABLE public.users 
    ADD CONSTRAINT users_last_active_workspace_id_fkey 
    FOREIGN KEY (last_active_workspace_id) 
    REFERENCES public.workspaces(id) ON DELETE SET NULL;


    CREATE TABLE IF NOT EXISTS public.permissions (
        id text NOT NULL PRIMARY KEY,
        category text,
        description text
    );

    -- Tables with dependencies
    CREATE TABLE IF NOT EXISTS public.roles (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        name text NOT NULL,
        description text,
        is_default boolean DEFAULT false NOT NULL,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        UNIQUE(workspace_id, name)
    );

    CREATE TABLE IF NOT EXISTS public.role_permissions (
        role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
        permission_id text NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS public.user_workspace_roles (
        user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        PRIMARY KEY (user_id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS public.tags (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        label text NOT NULL,
        value text NOT NULL,
        color text NOT NULL DEFAULT '#cccccc',
        is_close_reason boolean DEFAULT false NOT NULL,
        UNIQUE(workspace_id, label)
    );
    
    CREATE TABLE IF NOT EXISTS public.teams (
        id text NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        name text NOT NULL,
        color text NOT NULL DEFAULT '#cccccc',
        role_id uuid NOT NULL REFERENCES public.roles(id),
        tag_id uuid REFERENCES public.tags(id) ON DELETE SET NULL,
        owner_id uuid NOT NULL REFERENCES public.users(id),
        UNIQUE(workspace_id, name)
    );

    CREATE TABLE IF NOT EXISTS public.team_members (
        team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        PRIMARY KEY (team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS public.schedule_exceptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id TEXT NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        description VARCHAR(255) NOT NULL,
        is_closed BOOLEAN NOT NULL DEFAULT FALSE,
        start_time TIME,
        end_time TIME,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
        UNIQUE(team_id, date)
    );

    CREATE TABLE IF NOT EXISTS public.business_hours (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
        day_of_week text NOT NULL,
        is_enabled boolean DEFAULT false,
        start_time time,
        end_time time,
        UNIQUE(team_id, day_of_week)
    );
    
    CREATE TABLE IF NOT EXISTS public.contacts (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        owner_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
        name text NOT NULL,
        email text,
        phone text,
        phone_number_jid text,
        address text,
        avatar_url text,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        UNIQUE(workspace_id, phone_number_jid)
    );

    CREATE TABLE IF NOT EXISTS public.contact_tags (
        contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
        tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
        PRIMARY KEY (contact_id, tag_id)
    );
    
    CREATE TABLE IF NOT EXISTS public.activities (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES public.users(id),
        type text NOT NULL,
        notes text,
        date timestamptz NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        label text NOT NULL,
        type text NOT NULL,
        placeholder text,
        options jsonb,
        UNIQUE(workspace_id, label)
    );

    CREATE TABLE IF NOT EXISTS public.contact_custom_field_values (
        contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
        field_id uuid NOT NULL REFERENCES public.custom_field_definitions(id) ON DELETE CASCADE,
        value text,
        PRIMARY KEY (contact_id, field_id)
    );

    CREATE TABLE IF NOT EXISTS public.chats (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
        agent_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
        team_id uuid, -- Reference to be added if needed
        status public.chat_status_enum,
        tag text,
        color text,
        assigned_at timestamptz,
        closed_at timestamptz,
        close_reason_tag_id uuid REFERENCES public.tags(id) ON DELETE SET NULL,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.messages (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        sender_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
        sender_system_agent_id uuid, -- To be referenced later
        content text,
        type public.message_type_enum,
        status text,
        metadata jsonb,
        from_me boolean DEFAULT false,
        is_read boolean DEFAULT false,
        message_id_from_api text,
        api_message_status text,
        instance_name text,
        sender_from_api text,
        source_from_api text,
        server_url text,
        raw_payload jsonb,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS public.workspace_invites (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        code text NOT NULL UNIQUE,
        created_by uuid NOT NULL REFERENCES public.users(id),
        expires_at timestamptz NOT NULL,
        max_uses integer,
        is_revoked boolean DEFAULT false NOT NULL,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.user_invites (
        invite_id uuid NOT NULL REFERENCES public.workspace_invites(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        PRIMARY KEY (invite_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS public.system_agents (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        created_by_id uuid NOT NULL REFERENCES public.users(id),
        name text NOT NULL,
        avatar_url text,
        webhook_url text,
        token text NOT NULL UNIQUE,
        is_active boolean DEFAULT true NOT NULL,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        UNIQUE(workspace_id, name)
    );

    CREATE TABLE IF NOT EXISTS public.autopilot_configs (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        gemini_api_key text,
        ai_model text,
        knowledge_base text,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        UNIQUE(workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS public.autopilot_rules (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        config_id uuid NOT NULL REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
        name text NOT NULL,
        trigger text NOT NULL,
        action jsonb,
        enabled boolean DEFAULT true NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS public.autopilot_usage_logs (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        config_id uuid NOT NULL REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
        flow_name text,
        rule_name text,
        model_name text,
        input_tokens integer,
        output_tokens integer,
        total_tokens integer,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.evolution_api_configs (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        api_url text,
        api_key text,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.evolution_api_instances (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        config_id uuid NOT NULL REFERENCES public.evolution_api_configs(id) ON DELETE CASCADE,
        name text NOT NULL,
        type text, -- e.g., 'baileys', 'wa_cloud'
        webhook_url text,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        UNIQUE(config_id, name)
    );

    CREATE TABLE IF NOT EXISTS public.shortcuts (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        name text NOT NULL,
        message text NOT NULL,
        type text NOT NULL, -- 'global' or 'private'
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
        UNIQUE(workspace_id, name)
    );

    CREATE TABLE IF NOT EXISTS public.campaigns (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        created_by_id uuid NOT NULL REFERENCES public.users(id),
        name text NOT NULL,
        message text NOT NULL,
        instance_name text NOT NULL,
        status text NOT NULL,
        started_at timestamptz,
        completed_at timestamptz,
        created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.campaign_recipients (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
        contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'pending',
        sent_at timestamptz,
        error_message text,
        UNIQUE(campaign_id, contact_id)
    );
`;


export async function initializeDatabase(): Promise<{ success: boolean; message: string }> {
  console.log('[DB_SETUP] Iniciando a configuração completa do banco de dados...');
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    console.log('[DB_SETUP] Transação iniciada.');

    // --- 1. Criar todos os tipos ENUM necessários ---
    console.log('[DB_SETUP] Garantindo tipos ENUM...');
    await client.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_status_enum') THEN CREATE TYPE public.chat_status_enum AS ENUM ('gerais', 'atendimentos', 'encerrados'); END IF; END $$;");
    await client.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_type_enum') THEN CREATE TYPE public.message_type_enum AS ENUM ('text', 'system', 'audio', 'image', 'video', 'document'); END IF; END $$;");
    console.log('[DB_SETUP] Tipos ENUM garantidos.');
    
    // --- 2. Executar script de criação de tabelas ---
    console.log('[DB_SETUP] Criando tabelas se não existirem...');
    await client.query(TABLE_CREATION_QUERIES);
    console.log('[DB_SETUP] Verificação/criação de tabelas concluída.');
    
    // --- 3. Popular permissões padrão ---
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

    