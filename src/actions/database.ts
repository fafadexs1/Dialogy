
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
    // --- Etapa 1: Garantir que os Tipos ENUM existam ---
    // Esses comandos são executados fora da transação principal porque CREATE TYPE
    // não suporta "IF NOT EXISTS" e falharia dentro de um bloco de transação se o tipo já existisse.
    console.log('Verificando e criando tipos ENUM...');
    const enumQueries = [
      `CREATE TYPE public.chat_status_enum AS ENUM ('atendimentos', 'gerais', 'encerrados');`,
      `CREATE TYPE public.message_type_enum AS ENUM ('text', 'system');`,
      `CREATE TYPE public.message_status_enum AS ENUM ('default', 'deleted');`,
      `CREATE TYPE public.activity_type_enum AS ENUM ('ligacao', 'email', 'whatsapp', 'visita', 'viabilidade', 'contrato', 'agendamento', 'tentativa-contato', 'nota');`,
      `CREATE TYPE public.custom_field_type_enum AS ENUM ('text', 'number', 'date', 'email', 'tel', 'select');`,
    ];

    for (const query of enumQueries) {
      try {
        await client.query(query);
      } catch (error: any) {
        if (error.code !== '42710') { // 42710 is 'duplicate_object'
          throw error; // Se for um erro diferente, lança para o catch principal.
        }
        // Se o tipo já existe, ignora o erro e continua.
      }
    }
    console.log('Tipos ENUM verificados com sucesso.');

    // --- Etapa 2: Transação principal para criar tabelas e configurar o restante ---
    await client.query('BEGIN');
    console.log('Transação principal iniciada.');

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
    
    console.log('Verificando e criando schema do banco de dados...');
    
    const setupQueries = [
      `CREATE TABLE IF NOT EXISTS public.users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          full_name TEXT NOT NULL,
          avatar_url TEXT,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          last_active_workspace_id UUID,
          online BOOLEAN DEFAULT false
      );`,
      
      `CREATE TABLE IF NOT EXISTS public.workspaces (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          avatar_url TEXT,
          owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE
      );`,

      `CREATE TABLE IF NOT EXISTS public.permissions (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        category TEXT NOT NULL
      );`,

      `CREATE TABLE IF NOT EXISTS public.roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        is_default BOOLEAN DEFAULT FALSE,
        UNIQUE(workspace_id, name)
      );`,
      
      `CREATE TABLE IF NOT EXISTS public.role_permissions (
        role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
        permission_id TEXT NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      );`,

      `CREATE TABLE IF NOT EXISTS public.user_workspace_roles (
          user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (user_id, workspace_id)
      );`,

       `CREATE TABLE IF NOT EXISTS public.workspace_invites (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          code TEXT NOT NULL UNIQUE,
          created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          max_uses INT,
          is_revoked BOOLEAN DEFAULT FALSE,
          use_count INT DEFAULT 0
      );`,

      `CREATE TABLE IF NOT EXISTS public.user_invites (
          invite_id UUID NOT NULL REFERENCES public.workspace_invites(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          used_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (invite_id, user_id)
      );`,

      `CREATE TABLE IF NOT EXISTS public.teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#3b82f6',
        UNIQUE(workspace_id, name)
      );`,

      `CREATE TABLE IF NOT EXISTS public.team_members (
        team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        PRIMARY KEY (team_id, user_id)
      );`,

      `CREATE TABLE IF NOT EXISTS public.business_hours (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
          day_of_week TEXT NOT NULL, -- Ex: 'Segunda-feira', 'Terca-feira'
          is_enabled BOOLEAN DEFAULT TRUE,
          start_time TIME,
          end_time TIME,
          UNIQUE(team_id, day_of_week)
      );`,

      `CREATE TABLE IF NOT EXISTS public.contacts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          avatar_url TEXT,
          email TEXT,
          phone TEXT,
          phone_number_jid TEXT,
          address TEXT,
          owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(workspace_id, phone_number_jid)
      );`,
      
      `CREATE TABLE IF NOT EXISTS public.activities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
        user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
        type activity_type_enum NOT NULL,
        notes TEXT,
        date TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS public.tags (
        id TEXT PRIMARY KEY,
        workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        value TEXT NOT NULL,
        color TEXT NOT NULL,
        is_close_reason BOOLEAN DEFAULT FALSE,
        UNIQUE(workspace_id, label)
      );`,

      `CREATE TABLE IF NOT EXISTS public.contact_tags (
          contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
          PRIMARY KEY (contact_id, tag_id)
      );`,
      
       `CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          type custom_field_type_enum NOT NULL,
          placeholder TEXT,
          options JSONB, -- For select type
          UNIQUE(workspace_id, label)
      );`,

      `CREATE TABLE IF NOT EXISTS public.contact_custom_field_values (
          contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
          field_id UUID NOT NULL REFERENCES public.custom_field_definitions(id) ON DELETE CASCADE,
          value TEXT NOT NULL,
          PRIMARY KEY (contact_id, field_id)
      );`,

      `CREATE TABLE IF NOT EXISTS public.chats (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
          agent_id UUID REFERENCES public.users(id),
          status chat_status_enum DEFAULT 'gerais'::chat_status_enum,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          assigned_at TIMESTAMPTZ,
          closed_at TIMESTAMPTZ,
          close_reason_tag_id TEXT, -- Alterado para TEXT e sem chave estrangeira
          close_notes TEXT,
          tag TEXT,
          color TEXT
      );`,

      `CREATE TABLE IF NOT EXISTS public.messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
          sender_id UUID,
          type message_type_enum DEFAULT 'text'::message_type_enum,
          status message_status_enum DEFAULT 'default'::message_status_enum,
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
          api_message_status TEXT,
          is_read BOOLEAN DEFAULT FALSE,
          raw_payload JSONB
      );`,
      
      `CREATE TABLE IF NOT EXISTS public.evolution_api_configs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          api_url TEXT,
          api_key TEXT
      );`,
      
      `CREATE TABLE IF NOT EXISTS public.evolution_api_instances (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          config_id UUID NOT NULL REFERENCES public.evolution_api_configs(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT,
          webhook_url TEXT
      );`,

      `CREATE TABLE IF NOT EXISTS public.autopilot_configs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          gemini_api_key TEXT,
          ai_model TEXT,
          knowledge_base TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(workspace_id, user_id)
      );`,

      `CREATE TABLE IF NOT EXISTS public.autopilot_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        config_id UUID NOT NULL REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        trigger TEXT NOT NULL,
        action JSONB NOT NULL,
        enabled BOOLEAN DEFAULT TRUE
      );`,

      `CREATE TABLE IF NOT EXISTS public.autopilot_usage_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        config_id UUID NOT NULL REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
        rule_name TEXT,
        flow_name TEXT NOT NULL,
        model_name TEXT NOT NULL,
        input_tokens INT NOT NULL,
        output_tokens INT NOT NULL,
        total_tokens INT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );`,
    ];
    
    // Executa as queries de criação de tabela.
    for (const query of setupQueries) {
        await client.query(query);
    }
    console.log('Schema de tabelas verificado com sucesso.');

    const permissionQueries = [
      `GRANT ALL ON ALL TABLES IN SCHEMA public TO ${appUser};`,
      `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${appUser};`,
      `GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO ${appUser};`,
    ];

    for(const query of permissionQueries) {
      await client.query(query);
    }
    
    console.log('Permissões do usuário da aplicação concedidas.');

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
          autopilot_config_id UUID;
        BEGIN
          -- Cria o papel de Administrador para o novo workspace (não é o padrão para novos convidados)
          INSERT INTO public.roles (workspace_id, name, description, is_default)
          VALUES (NEW.id, 'Administrador', 'Acesso total a todas as funcionalidades e configurações.', FALSE)
          ON CONFLICT (workspace_id, name) DO NOTHING
          RETURNING id INTO admin_role_id;

          -- Se o papel foi criado agora (não existia), preenche as permissões
          IF admin_role_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            SELECT admin_role_id, id FROM public.permissions;
          ELSE
            -- Se o papel já existia, pega o ID dele para usar depois
            SELECT id INTO admin_role_id FROM public.roles WHERE workspace_id = NEW.id AND name = 'Administrador';
          END IF;

          -- Cria o papel de Membro para o novo workspace (este é o padrão para novos convidados)
          INSERT INTO public.roles (workspace_id, name, description, is_default)
          VALUES (NEW.id, 'Membro', 'Acesso às funcionalidades principais, mas não pode gerenciar configurações.', TRUE)
          ON CONFLICT (workspace_id, name) DO NOTHING
          RETURNING id INTO member_role_id;
          
          -- Se o papel de membro foi criado agora, preenche as permissões
          IF member_role_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            SELECT member_role_id, id FROM public.permissions
            WHERE id IN ('workspace:settings:view', 'members:view', 'teams:view', 'crm:view', 'crm:edit', 'autopilot:view', 'autopilot:edit');
          END IF;
          
          -- Atribui o papel de Administrador ao criador do workspace, se ele ainda não tiver um papel.
          INSERT INTO public.user_workspace_roles (user_id, workspace_id, role_id)
          VALUES (NEW.owner_id, NEW.id, admin_role_id)
          ON CONFLICT (user_id, workspace_id) DO NOTHING;
          
          -- Cria uma configuração padrão do Autopilot para o dono do workspace
          INSERT INTO public.autopilot_configs (workspace_id, user_id, ai_model, knowledge_base)
          VALUES(NEW.id, NEW.owner_id, 'googleai/gemini-2.0-flash', 'Nosso horário de atendimento é de segunda a sexta, das 9h às 18h.')
          ON CONFLICT (workspace_id, user_id) DO NOTHING
          RETURNING id INTO autopilot_config_id;

          -- Se a configuração do Autopilot foi criada agora, cria uma regra de exemplo.
          IF autopilot_config_id IS NOT NULL THEN
            INSERT INTO public.autopilot_rules (config_id, name, trigger, action, enabled)
            VALUES (autopilot_config_id, 
              'Saudação Inicial', 
              'O cliente envia a primeira mensagem, como "oi" ou "olá".',
              '{ "type": "reply", "value": "Olá! Bem-vindo ao nosso canal de atendimento. Como posso ajudar?" }',
              TRUE
            );
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;`,
        
        `DROP TRIGGER IF EXISTS setup_workspace_defaults_trigger ON public.workspaces;
         CREATE TRIGGER setup_workspace_defaults_trigger
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
                ) ON CONFLICT (team_id, day_of_week) DO NOTHING;
            END LOOP;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;`,

        `DROP TRIGGER IF EXISTS setup_default_business_hours_trigger ON public.teams;
         CREATE TRIGGER setup_default_business_hours_trigger
            AFTER INSERT ON public.teams
            FOR EACH ROW EXECUTE PROCEDURE public.setup_default_business_hours();`,
            
        `CREATE OR REPLACE FUNCTION public.update_invite_use_count()
        RETURNS TRIGGER AS $$
        BEGIN
          UPDATE public.workspace_invites
          SET use_count = use_count + 1
          WHERE id = NEW.invite_id;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;`,

        `DROP TRIGGER IF EXISTS update_invite_use_count_trigger ON public.user_invites;
         CREATE TRIGGER update_invite_use_count_trigger
            AFTER INSERT ON public.user_invites
            FOR EACH ROW EXECUTE PROCEDURE public.update_invite_use_count();`
    ];

    for(const query of functionsAndTriggers) {
      await client.query(query);
    }

    console.log('Funções e triggers criados/atualizados.');
    
    await client.query('COMMIT');
    console.log('Banco de dados inicializado com sucesso.');
    return { success: true, message: 'Banco de dados verificado e atualizado com sucesso! Seus dados foram preservados.' };

  } catch (error) {
    // A transação principal já foi iniciada, então damos rollback aqui.
    await client.query('ROLLBACK').catch(rollbackError => {
        console.error('Falha ao executar ROLLBACK:', rollbackError);
    });

    console.error('Erro ao inicializar o banco de dados:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Falha na inicialização do banco de dados: ${errorMessage}` };
  } finally {
    client.release();
    await adminPool.end();
    console.log('Conexão com o banco de dados liberada.');
  }
}
 
    