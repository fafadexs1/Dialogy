
'use server';

import { db } from '@/lib/db';
import { Pool } from 'pg';

export async function initializeDatabase(): Promise<{ success: boolean; message: string }> {
  console.log('Iniciando a inicialização do banco de dados...');
  const adminPool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const client = await adminPool.connect();

  try {
    await client.query('BEGIN');
    console.log('Transação iniciada.');

    const appUser = 'evolutionapi';
    const appPassword = 'default_password';
    const res = await client.query(`SELECT 1 FROM pg_roles WHERE rolname=$1`, [appUser]);
    if (res.rowCount === 0) {
      console.log(`Usuário '${appUser}' não encontrado. Criando...`);
      await client.query(`CREATE ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';`);
      console.log(`Usuário '${appUser}' criado com sucesso.`);
    } else {
      console.log(`Usuário '${appUser}' já existe.`);
    }

    await client.query(`GRANT ALL PRIVILEGES ON DATABASE postgres TO ${appUser};`);
    console.log(`Privilégios concedidos ao usuário '${appUser}'.`);

    console.log('Limpando objetos de banco de dados existentes...');
    const teardownQueries = [
        'DROP TABLE IF EXISTS public.contact_tags CASCADE;',
        'DROP TABLE IF EXISTS public.tags CASCADE;',
        'DROP TABLE IF EXISTS public.business_hours CASCADE;',
        'DROP TABLE IF EXISTS public.team_members CASCADE;',
        'DROP TABLE IF EXISTS public.teams CASCADE;',
        'DROP TABLE IF EXISTS public.role_permissions CASCADE;',
        'DROP TABLE IF EXISTS public.permissions CASCADE;',
        'DROP TABLE IF EXISTS public.user_invites CASCADE;',
        'DROP TABLE IF EXISTS public.workspace_invites CASCADE;',
        'DROP TABLE IF EXISTS public.user_workspace_roles CASCADE;',
        'DROP TABLE IF EXISTS public.roles CASCADE;',
        'DROP TABLE IF EXISTS public.evolution_api_instances CASCADE;',
        'DROP TABLE IF EXISTS public.evolution_api_configs CASCADE;',
        'DROP TABLE IF EXISTS public.messages CASCADE;',
        'DROP TABLE IF EXISTS public.chats CASCADE;',
        'DROP TABLE IF EXISTS public.contacts CASCADE;',
        'DROP TABLE IF EXISTS public.user_workspaces CASCADE;', // Tabela antiga, removida para limpeza.
        'DROP TABLE IF EXISTS public.workspaces CASCADE;',
        'DROP TABLE IF EXISTS public.users CASCADE;',
        'DROP TYPE IF EXISTS public.chat_status_enum;',
        'DROP TYPE IF EXISTS public.message_type_enum;',
    ];
    
    for (const query of teardownQueries) {
        await client.query(query);
    }
    console.log('Limpeza concluída. Iniciando a criação do schema...');

    const setupQueries = [
      `CREATE TYPE public.chat_status_enum AS ENUM ('atendimentos', 'gerais', 'encerrados');`,
      `CREATE TYPE public.message_type_enum AS ENUM ('text', 'system');`,
      
      `CREATE TABLE public.users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          full_name TEXT NOT NULL,
          avatar_url TEXT,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          last_active_workspace_id UUID,
          online BOOLEAN DEFAULT false
      );`,
      
      `CREATE TABLE public.workspaces (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          avatar_url TEXT,
          owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE
      );`,

      `CREATE TABLE public.permissions (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        category TEXT NOT NULL
      );`,

      `CREATE TABLE public.roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        is_default BOOLEAN DEFAULT FALSE,
        UNIQUE(workspace_id, name)
      );`,
      
      `CREATE TABLE public.role_permissions (
        role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
        permission_id TEXT NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      );`,

      `CREATE TABLE public.user_workspace_roles (
          user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (user_id, workspace_id)
      );`,

       `CREATE TABLE public.workspace_invites (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          code TEXT NOT NULL UNIQUE,
          created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          max_uses INT,
          is_revoked BOOLEAN DEFAULT FALSE
      );`,

      `CREATE TABLE public.user_invites (
          invite_id UUID NOT NULL REFERENCES public.workspace_invites(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          used_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (invite_id, user_id)
      );`,

      `CREATE TABLE public.teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#3b82f6',
        UNIQUE(workspace_id, name)
      );`,

      `CREATE TABLE public.team_members (
        team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        PRIMARY KEY (team_id, user_id)
      );`,

      `CREATE TABLE public.business_hours (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
          day_of_week TEXT NOT NULL, -- Ex: 'Segunda-feira', 'Terca-feira'
          is_enabled BOOLEAN DEFAULT TRUE,
          start_time TIME,
          end_time TIME,
          UNIQUE(team_id, day_of_week)
      );`,

      `CREATE TABLE public.contacts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          avatar_url TEXT,
          email TEXT,
          phone TEXT,
          phone_number_jid TEXT UNIQUE
      );`,
      
      `CREATE TABLE public.tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        value TEXT NOT NULL,
        color TEXT NOT NULL,
        is_close_reason BOOLEAN DEFAULT FALSE,
        UNIQUE(workspace_id, label)
      );`,

      `CREATE TABLE public.contact_tags (
          contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
          tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
          PRIMARY KEY (contact_id, tag_id)
      );`,

      `CREATE TABLE public.chats (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
          agent_id UUID REFERENCES public.users(id),
          status chat_status_enum DEFAULT 'gerais'::chat_status_enum,
          assigned_at TIMESTAMPTZ,
          closed_at TIMESTAMPTZ,
          close_reason_tag_id UUID REFERENCES public.tags(id),
          close_notes TEXT
      );`,

      `CREATE TABLE public.messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
          sender_id UUID,
          type message_type_enum DEFAULT 'text',
          content TEXT,
          metadata JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          message_id_from_api TEXT,
          sender_from_api TEXT,
          instance_name TEXT,
          status_from_api TEXT,
          source_from_api TEXT,
          server_url TEXT,
          from_me BOOLEAN,
          raw_payload JSONB
      );`,
      
      `CREATE TABLE public.evolution_api_configs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          api_url TEXT,
          api_key TEXT
      );`,
      
      `CREATE TABLE public.evolution_api_instances (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          config_id UUID NOT NULL REFERENCES public.evolution_api_configs(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT,
          webhook_url TEXT
      );`,

      `GRANT ALL ON ALL TABLES IN SCHEMA public TO ${appUser};`,
      `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${appUser};`,
      `GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO ${appUser};`,
    ];

    for(const query of setupQueries) {
      await client.query(query);
    }
    
    console.log('Tabelas e permissões criadas com sucesso.');

    console.log('Populando a tabela de permissões...');
    const permissions = [
        // Workspace
        { id: 'workspace:settings:view', description: 'Visualizar as configurações do workspace', category: 'Workspace' },
        { id: 'workspace:settings:edit', description: 'Editar as configurações do workspace', category: 'Workspace' },
        { id: 'workspace:invites:manage', description: 'Gerenciar convites para o workspace', category: 'Workspace' },
        // Members
        { id: 'members:view', description: 'Visualizar membros do workspace', category: 'Membros' },
        { id: 'members:invite', description: 'Convidar novos membros', category: 'Membros' },
        { id: 'members:remove', description: 'Remover membros do workspace', category: 'Membros' },
        // Roles & Permissions
        { id: 'permissions:view', description: 'Visualizar papéis e permissões', category: 'Permissões' },
        { id: 'permissions:edit', description: 'Criar, editar e atribuir papéis e permissões', category: 'Permissões' },
        // Teams
        { id: 'teams:view', description: 'Visualizar equipes', category: 'Equipes' },
        { id: 'teams:edit', description: 'Criar, editar e gerenciar equipes e seus membros', category: 'Equipes' },
        // Analytics
        { id: 'analytics:view', description: 'Visualizar a página de Analytics', category: 'Analytics' },
        // Integrations
        { id: 'integrations:view', description: 'Visualizar integrações', category: 'Integrações' },
        { id: 'integrations:edit', description: 'Configurar integrações', category: 'Integrações' },
        // Autopilot
        { id: 'autopilot:view', description: 'Visualizar configurações do Piloto Automático', category: 'Piloto Automático' },
        { id: 'autopilot:edit', description: 'Editar configurações e regras do Piloto Automático', category: 'Piloto Automático' },
        // CRM
        { id: 'crm:view', description: 'Visualizar contatos e empresas no CRM', category: 'CRM' },
        { id: 'crm:edit', description: 'Criar e editar contatos e empresas no CRM', category: 'CRM' },
        { id: 'crm:delete', description: 'Deletar contatos e empresas no CRM', category: 'CRM' },
    ];
    for (const p of permissions) {
        await client.query('INSERT INTO public.permissions (id, description, category) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [p.id, p.description, p.category]);
    }
    console.log('Permissões populadas.');

    console.log('Configurando automações (funções e triggers)...');
    
    const functionsAndTriggers = [
        `CREATE OR REPLACE FUNCTION public.setup_workspace_defaults()
        RETURNS TRIGGER AS $$
        DECLARE
          admin_role_id UUID;
          member_role_id UUID;
        BEGIN
          -- Cria o papel de Administrador para o novo workspace
          INSERT INTO public.roles (workspace_id, name, description, is_default)
          VALUES (NEW.id, 'Administrador', 'Acesso total a todas as funcionalidades e configurações.', FALSE)
          RETURNING id INTO admin_role_id;

          -- Atribui todas as permissões existentes ao papel de Administrador
          INSERT INTO public.role_permissions (role_id, permission_id)
          SELECT admin_role_id, id FROM public.permissions;

          -- Cria o papel de Membro para o novo workspace
          INSERT INTO public.roles (workspace_id, name, description, is_default)
          VALUES (NEW.id, 'Membro', 'Acesso às funcionalidades principais, mas não pode gerenciar configurações.', TRUE)
          RETURNING id INTO member_role_id;

          -- Atribui permissões básicas ao papel de Membro
          INSERT INTO public.role_permissions (role_id, permission_id)
          SELECT member_role_id, id FROM public.permissions
          WHERE id IN ('workspace:settings:view', 'members:view', 'teams:view', 'crm:view', 'crm:edit');
          
          -- Atribui o papel de Administrador ao criador do workspace
          INSERT INTO public.user_workspace_roles (user_id, workspace_id, role_id)
          VALUES (NEW.owner_id, NEW.id, admin_role_id);
          
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;`,
        
        `CREATE TRIGGER setup_workspace_defaults_trigger
            AFTER INSERT ON public.workspaces
            FOR EACH ROW EXECUTE PROCEDURE public.setup_workspace_defaults();`,

        `CREATE OR REPLACE FUNCTION public.setup_default_business_hours()
        RETURNS TRIGGER AS $$
        DECLARE
            days_of_week TEXT[] := ARRAY['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
            day_name TEXT;
        BEGIN
            FOREACH day_name IN ARRAY days_of_week
            LOOP
                INSERT INTO public.business_hours (team_id, day_of_week, is_enabled, start_time, end_time)
                VALUES (
                    NEW.id,
                    day_name,
                    -- Desabilita Sábado e Domingo por padrão
                    (day_name <> 'Sábado' AND day_name <> 'Domingo'), 
                    '09:00:00',
                    '18:00:00'
                );
            END LOOP;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;`,

        `CREATE TRIGGER setup_default_business_hours_trigger
            AFTER INSERT ON public.teams
            FOR EACH ROW EXECUTE PROCEDURE public.setup_default_business_hours();`
    ];

    for(const query of functionsAndTriggers) {
      await client.query(query);
    }

    console.log('Funções e triggers criados.');
    
    await client.query('COMMIT');
    console.log('Banco de dados inicializado com sucesso.');
    return { success: true, message: 'Banco de dados inicializado com sucesso! O usuário "evolutionapi" foi criado ou verificado.' };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao inicializar o banco de dados:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Falha na inicialização do banco de dados: ${errorMessage}` };
  } finally {
    client.release();
    await adminPool.end();
    console.log('Conexão com o banco de dados liberada.');
  }
}

    

    
