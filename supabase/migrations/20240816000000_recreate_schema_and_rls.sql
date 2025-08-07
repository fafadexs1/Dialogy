-- Passo 1: Remover as tabelas antigas na ordem correta para evitar erros de dependência.
-- Tabelas com dependências primeiro.
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.evolution_api_instances CASCADE;
DROP TABLE IF EXISTS public.chats CASCADE;

-- Tabelas das quais outras dependem.
DROP TABLE IF EXISTS public.contacts CASCADE;
DROP TABLE IF EXISTS public.evolution_api_configs CASCADE;
DROP TABLE IF EXISTS public.user_workspaces CASCADE;
DROP TABLE IF EXISTS public.workspaces CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- Passo 2: Recriar a tabela de usuários (perfis públicos).
CREATE TABLE public.users (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text,
    avatar_url text,
    email text UNIQUE,
    last_active_workspace_id uuid
);

-- Passo 3: Recriar a tabela de workspaces.
CREATE TABLE public.workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    name text NOT NULL,
    avatar_url text,
    owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE
);
-- Adicionar a referência de last_active_workspace_id da tabela users para workspaces
ALTER TABLE public.users
ADD CONSTRAINT fk_last_active_workspace
FOREIGN KEY (last_active_workspace_id)
REFERENCES public.workspaces(id) ON DELETE SET NULL;


-- Passo 4: Recriar a tabela de associação de usuários a workspaces.
CREATE TABLE public.user_workspaces (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, workspace_id)
);

-- Passo 5: Recriar as tabelas restantes com suas dependências.
CREATE TABLE public.contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    name text NOT NULL,
    email text,
    phone text,
    avatar_url text
);
CREATE TABLE public.chats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    agent_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'atendimentos', -- 'atendimentos', 'gerais', 'encerrados'
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL, -- Pode ser um user_id ou um contact_id (não há FK aqui de propósito)
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.evolution_api_configs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
    api_url text,
    api_key text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.evolution_api_instances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id uuid NOT NULL REFERENCES public.evolution_api_configs(id) ON DELETE CASCADE,
    name text NOT NULL,
    type text NOT NULL DEFAULT 'baileys', -- 'baileys' ou 'wa_cloud'
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Passo 6: Recriar funções e triggers.

-- Trigger para criar um perfil de usuário público quando um novo usuário se registra no Auth.
CREATE OR REPLACE FUNCTION public.handle_new_user_public()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  insert into public.users (id, full_name, email, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.email,
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

-- Criar o trigger que chama a função handle_new_user_public
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_public();

-- Trigger para definir o proprietário de um novo workspace.
CREATE OR REPLACE FUNCTION public.set_workspace_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  new.owner_id := auth.uid();
  return new;
end;
$$;

DROP TRIGGER IF EXISTS set_workspace_owner_trigger ON public.workspaces;
CREATE TRIGGER set_workspace_owner_trigger
  BEFORE INSERT ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.set_workspace_owner();

-- Trigger para adicionar o criador como membro do workspace.
CREATE OR REPLACE FUNCTION public.add_creator_to_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  insert into public.user_workspaces (user_id, workspace_id)
  values (new.owner_id, new.id);
  -- Define o workspace recém-criado como o ativo para o usuário
  UPDATE public.users SET last_active_workspace_id = new.id WHERE id = new.owner_id;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS add_creator_to_workspace_trigger ON public.workspaces;
CREATE TRIGGER add_creator_to_workspace_trigger
  AFTER INSERT ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.add_creator_to_workspace();


-- Passo 7: Habilitar RLS e criar políticas de segurança.

-- Habilitar RLS em todas as tabelas
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_api_instances ENABLE ROW LEVEL SECURITY;

-- Limpar políticas antigas (redundância para garantir um estado limpo)
DROP POLICY IF EXISTS "Allow all users to read users" ON public.users;
DROP POLICY IF EXISTS "Users can read their own data" ON public.users;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
DROP POLICY IF EXISTS "Users can view workspaces they are a member of" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can insert their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can be added by owner" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can leave or be removed by owner" ON public.user_workspaces;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.contacts;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.chats;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.messages;
DROP POLICY IF EXISTS "Allow full access to workspace data" ON public.evolution_api_configs;
DROP POLICY IF EXISTS "Allow full access based on parent config" ON public.evolution_api_instances;

-- Políticas para `users`
CREATE POLICY "Allow authenticated users to read users" ON public.users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can read their own data" ON public.users FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update their own data" ON public.users FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Políticas para `workspaces`
CREATE POLICY "Users can view workspaces they are a member of" ON public.workspaces FOR SELECT TO authenticated USING (id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));
CREATE POLICY "Authenticated users can create workspaces" ON public.workspaces FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Owners can update their own workspaces" ON public.workspaces FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners can delete their own workspaces" ON public.workspaces FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- Políticas para `user_workspaces`
CREATE POLICY "Users can view their own workspace memberships" ON public.user_workspaces FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can be added by owner" ON public.user_workspaces FOR INSERT TO authenticated WITH CHECK (
    -- O proprietário do workspace pode adicionar qualquer pessoa
    (SELECT owner_id FROM public.workspaces WHERE id = workspace_id) = auth.uid()
);
CREATE POLICY "Users can leave or be removed by owner" ON public.user_workspaces FOR DELETE TO authenticated USING (
    -- O próprio usuário pode sair
    user_id = auth.uid() OR
    -- O proprietário do workspace pode remover qualquer um
    (SELECT owner_id FROM public.workspaces WHERE id = workspace_id) = auth.uid()
);

-- Políticas genéricas para dados dentro de um workspace
CREATE POLICY "Allow full access to workspace data" ON public.contacts FOR ALL TO authenticated USING (workspace_id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
)) WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));

CREATE POLICY "Allow full access to workspace data" ON public.chats FOR ALL TO authenticated USING (workspace_id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
)) WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));

CREATE POLICY "Allow full access to workspace data" ON public.messages FOR ALL TO authenticated USING (workspace_id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
)) WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));

CREATE POLICY "Allow full access to workspace data" ON public.evolution_api_configs FOR ALL TO authenticated USING (workspace_id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
)) WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));

CREATE POLICY "Allow full access based on parent config" ON public.evolution_api_instances FOR ALL TO authenticated USING (config_id IN (
    SELECT id FROM public.evolution_api_configs WHERE workspace_id IN (
        SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
    )
)) WITH CHECK (config_id IN (
    SELECT id FROM public.evolution_api_configs WHERE workspace_id IN (
        SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
    )
));
