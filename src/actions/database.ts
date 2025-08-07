
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
        // Remover políticas de segurança
        'DROP POLICY IF EXISTS "Allow individual read access" ON public.users;',
        'DROP POLICY IF EXISTS "Allow individual update access" ON public.users;',
        'DROP POLICY IF EXISTS "Allow workspace access for members" ON public.workspaces;',
        'DROP POLICY IF EXISTS "Allow member access for user_workspaces" ON public.user_workspaces;',
        'DROP POLICY IF EXISTS "Allow member access for contacts" ON public.contacts;',
        'DROP POLICY IF EXISTS "Allow member access for chats" ON public.chats;',
        'DROP POLICY IF EXISTS "Allow member access for messages" ON public.messages;',
        'DROP POLICY IF EXISTS "Allow member access for evolution_api_configs" ON public.evolution_api_configs;',
        'DROP POLICY IF EXISTS "Allow member access for evolution_api_instances" ON public.evolution_api_instances;',
        // Remover triggers
        'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;',
        'DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;',
        // Remover funções
        'DROP FUNCTION IF EXISTS public.create_user_profile();',
        'DROP FUNCTION IF EXISTS public.add_creator_to_workspace();',
        'DROP FUNCTION IF EXISTS public.set_workspace_owner();',
        // Remover tabelas
        'DROP TABLE IF EXISTS public.evolution_api_instances CASCADE;',
        'DROP TABLE IF EXISTS public.evolution_api_configs CASCADE;',
        'DROP TABLE IF EXISTS public.messages CASCADE;',
        'DROP TABLE IF EXISTS public.chats CASCADE;',
        'DROP TABLE IF EXISTS public.contacts CASCADE;',
        'DROP TABLE IF EXISTS public.user_workspaces CASCADE;',
        'DROP TABLE IF EXISTS public.workspaces CASCADE;',
        'DROP TABLE IF EXISTS public.users CASCADE;',
        // Remover ENUMs
        'DROP TYPE IF EXISTS public.chat_status_enum;'
    ];
    
    for (const query of teardownQueries) {
        try {
            await client.query(query);
        } catch (err: any) {
            // Ignorar erros se o objeto não existir, mas logar outros erros
            if (err.code !== '42704' && err.code !== '42P01') { // undefined_object e undefined_table
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
          auth_id UUID UNIQUE,
          full_name TEXT NOT NULL,
          avatar_url TEXT,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT,
          last_active_workspace_id UUID,
          online BOOLEAN DEFAULT false
      );`,
      
      `CREATE TABLE public.workspaces (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          avatar_url TEXT,
          owner_id UUID REFERENCES public.users(id)
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
          created_at TIMESTAMPRANGE DEFAULT NOW()
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
    console.log('Configurando segurança e automações...');
    
    // Funções e Triggers
    const functionsAndTriggers = [
        `CREATE OR REPLACE FUNCTION public.create_user_profile()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO public.users (auth_id, full_name, email, avatar_url)
            VALUES (
                NEW.id,
                NEW.raw_user_meta_data->>'full_name',
                NEW.email,
                NEW.raw_user_meta_data->>'avatar_url'
            );
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;`,

        `CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW EXECUTE PROCEDURE public.create_user_profile();`,

        `CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
        RETURNS TRIGGER AS $$
        BEGIN
          INSERT INTO public.user_workspaces (user_id, workspace_id)
          VALUES (NEW.owner_id, NEW.id);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;`,
        
        `CREATE TRIGGER add_creator_to_workspace_trigger
            AFTER INSERT ON public.workspaces
            FOR EACH ROW EXECUTE PROCEDURE public.add_creator_to_workspace();`,
            
        `ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;`,
        `ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;`,
        `ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;`,
        `ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;`,
        `ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;`,
        `ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;`,
        `ALTER TABLE public.evolution_api_configs ENABLE ROW LEVEL SECURITY;`,
        `ALTER TABLE public.evolution_api_instances ENABLE ROW LEVEL SECURITY;`,
    ];

    for(const query of functionsAndTriggers) {
      await client.query(query);
    }

    console.log('Funções e triggers criados. Configurando políticas de RLS...');

    // Políticas de Segurança (RLS)
    const rlsPolicies = [
        `CREATE POLICY "Allow individual read access" ON public.users FOR SELECT USING (auth.uid() = auth_id);`,
        `CREATE POLICY "Allow individual update access" ON public.users FOR UPDATE USING (auth.uid() = auth_id);`,
        `CREATE POLICY "Allow workspace access for members" ON public.workspaces FOR ALL
            USING (
                id IN (
                    SELECT workspace_id FROM public.user_workspaces WHERE user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
                )
            );`,
        `CREATE POLICY "Allow member access for user_workspaces" ON public.user_workspaces FOR ALL
            USING (
                workspace_id IN (
                    SELECT workspace_id FROM public.user_workspaces WHERE user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
                )
            );`,
        `CREATE POLICY "Allow member access for contacts" ON public.contacts FOR ALL
            USING (
                workspace_id IN (
                    SELECT workspace_id FROM public.user_workspaces WHERE user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
                )
            );`,
         `CREATE POLICY "Allow member access for chats" ON public.chats FOR ALL
            USING (
                workspace_id IN (
                    SELECT workspace_id FROM public.user_workspaces WHERE user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
                )
            );`,
        `CREATE POLICY "Allow member access for messages" ON public.messages FOR ALL
            USING (
                workspace_id IN (
                    SELECT workspace_id FROM public.user_workspaces WHERE user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
                )
            );`,
        `CREATE POLICY "Allow member access for evolution_api_configs" ON public.evolution_api_configs FOR ALL
            USING (
                workspace_id IN (
                    SELECT workspace_id FROM public.user_workspaces WHERE user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
                )
            );`,
        `CREATE POLICY "Allow member access for evolution_api_instances" ON public.evolution_api_instances FOR ALL
            USING (
                config_id IN (
                    SELECT id FROM public.evolution_api_configs WHERE workspace_id IN (
                         SELECT workspace_id FROM public.user_workspaces WHERE user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
                    )
                )
            );`
    ];

    for(const query of rlsPolicies) {
      await client.query(query);
    }
    
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
