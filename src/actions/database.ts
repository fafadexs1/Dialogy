
'use server';

import { db } from '@/lib/db';

export async function initializeDatabase(): Promise<{ success: boolean; message: string }> {
  console.log('Iniciando a inicialização do banco de dados...');
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    console.log('Transação iniciada. Limpando objetos existentes...');

    // Teardown em ordem reversa de dependência
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
        try {
            await client.query(query);
        } catch (err: any) {
            // Ignorar erros se o objeto não existir, mas logar outros erros
            if (err.code !== '42P01' && err.code !== '42704') { // undefined_table, undefined_object
                 console.warn(`Aviso durante a limpeza: ${err.message}`);
            }
        }
    }
    
    console.log('Limpeza concluída. Iniciando a criação do schema...');

    // Setup - Criação das tabelas e objetos
    const setupQueries = [
      // ENUMs
      `CREATE TYPE public.chat_status_enum AS ENUM ('atendimentos', 'gerais', 'encerrados');`,
      
      // Tabelas
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
          phone TEXT
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
          created_at TIMESTAMPTZ DEFAULT NOW()
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
          type TEXT
      );`
    ];

    for(const query of setupQueries) {
      await client.query(query);
    }
    
    console.log('Tabelas criadas com sucesso.');
    console.log('Configurando automações...');
    
    // Funções e Triggers
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
    return { success: true, message: 'Banco de dados inicializado com sucesso!' };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao inicializar o banco de dados:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Falha na inicialização do banco de dados: ${errorMessage}` };
  } finally {
    client.release();
    console.log('Conexão com o banco de dados liberada.');
  }
}
