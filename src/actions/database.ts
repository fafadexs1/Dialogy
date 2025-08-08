
'use server';

import { db } from '@/lib/db';
import { Pool } from 'pg';

export async function initializeDatabase(): Promise<{ success: boolean; message: string }> {
  console.log('Iniciando a inicialização do banco de dados...');
  // Usar uma conexão de superusuário para criar roles e o banco de dados, se necessário.
  // ATENÇÃO: A DATABASE_URL principal deve ser de um usuário com privilégios de criação.
  const adminPool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const client = await adminPool.connect();

  try {
    await client.query('BEGIN');
    console.log('Transação iniciada.');

    // 1. Criar o usuário (role) da aplicação se ele não existir.
    const appUser = 'evolutionapi';
    const appPassword = 'default_password'; // Use uma senha mais segura em produção!
    const res = await client.query(`SELECT 1 FROM pg_roles WHERE rolname=$1`, [appUser]);
    if (res.rowCount === 0) {
      console.log(`Usuário '${appUser}' não encontrado. Criando...`);
      await client.query(`CREATE ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';`);
      console.log(`Usuário '${appUser}' criado com sucesso.`);
    } else {
      console.log(`Usuário '${appUser}' já existe.`);
    }

    // 2. Conceder permissões ao novo usuário.
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE postgres TO ${appUser};`); // Conceder privilégios no DB
    console.log(`Privilégios concedidos ao usuário '${appUser}'.`);

    // 3. Limpeza de objetos existentes (tabelas, tipos)
    console.log('Limpando objetos de banco de dados existentes...');
    const teardownQueries = [
        'DROP TABLE IF EXISTS public.evolution_api_instances CASCADE;',
        'DROP TABLE IF EXISTS public.evolution_api_configs CASCADE;',
        'DROP TABLE IF EXISTS public.messages CASCADE;',
        'DROP TABLE IF EXISTS public.chats CASCADE;',
        'DROP TABLE IF EXISTS public.contacts CASCADE;',
        'DROP TABLE IF EXISTS public.user_workspaces CASCADE;',
        'DROP TABLE IF EXISTS public.workspaces CASCADE;',
        'DROP TABLE IF EXISTS public.users CASCADE;',
        'DROP TYPE IF EXISTS public.chat_status_enum;'
    ];
    
    for (const query of teardownQueries) {
        await client.query(query);
    }
    console.log('Limpeza concluída. Iniciando a criação do schema...');

    // 4. Setup - Criação das tabelas e objetos
    const setupQueries = [
      `CREATE TYPE public.chat_status_enum AS ENUM ('atendimentos', 'gerais', 'encerrados');`,
      
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
          owner_id UUID REFERENCES public.users(id) ON DELETE CASCADE
      );`,
      
      `CREATE TABLE public.user_workspaces (
          user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
          workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
          PRIMARY KEY (user_id, workspace_id)
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

      `CREATE TABLE public.chats (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
          agent_id UUID REFERENCES public.users(id),
          status chat_status_enum DEFAULT 'atendimentos'::chat_status_enum
      );`,

      `CREATE TABLE public.messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
          chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
          sender_id UUID NOT NULL,
          content TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          message_id_from_api TEXT,
          sender_from_api TEXT,
          instance_name TEXT,
          status_from_api TEXT,
          source_from_api TEXT,
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
          status TEXT,
          type TEXT,
          webhook_url TEXT
      );`,

      // Grant permissions on new tables to the app user
      `GRANT ALL ON ALL TABLES IN SCHEMA public TO ${appUser};`,
      `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${appUser};`,
      `GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO ${appUser};`,
    ];

    for(const query of setupQueries) {
      await client.query(query);
    }
    
    console.log('Tabelas e permissões criadas com sucesso.');
    console.log('Configurando automações (funções e triggers)...');
    
    const functionsAndTriggers = [
        `CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
        RETURNS TRIGGER AS $$
        BEGIN
          INSERT INTO public.user_workspaces (user_id, workspace_id)
          VALUES (NEW.owner_id, NEW.id);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;`,
        
        `CREATE TRIGGER add_creator_to_workspace_trigger
            AFTER INSERT ON public.workspaces
            FOR EACH ROW EXECUTE PROCEDURE public.add_creator_to_workspace();`,
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
