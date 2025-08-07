-- Adiciona a coluna 'owner_id' à tabela 'workspaces' se ela não existir.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'workspaces'
    AND column_name = 'owner_id'
  ) THEN
    ALTER TABLE public.workspaces
    ADD COLUMN owner_id uuid DEFAULT auth.uid() REFERENCES public.users(id);
  END IF;
END
$$;

-- Limpa as políticas antigas para evitar conflitos.
DROP POLICY IF EXISTS "Usuários autenticados podem criar workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários podem ver workspaces dos quais são membros" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem alterar seus próprios workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem deletar seus próprios workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can create and view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can see workspaces they are part of" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view workspaces they are members of" ON public.workspaces;

-- Limpa políticas da tabela de junção
DROP POLICY IF EXISTS "Users can be added to workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Allow workspace creator linking via trigger" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can see their own workspace memberships" ON public.user_workspaces;


-- POLÍTICAS PARA A TABELA 'workspaces'

-- 1. Permite que usuários autenticados criem um workspace.
CREATE POLICY "Authenticated users can insert workspaces"
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (true);

-- 2. Permite que um usuário veja todos os workspaces dos quais ele é membro.
CREATE POLICY "Users can select workspaces they are members of"
ON public.workspaces FOR SELECT
TO public
USING (id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));

-- 3. Permite que APENAS o proprietário do workspace o altere.
CREATE POLICY "Owners can update their own workspaces"
ON public.workspaces FOR UPDATE
TO public
USING (owner_id = auth.uid());

-- 4. Permite que APENAS o proprietário do workspace o exclua.
CREATE POLICY "Owners can delete their own workspaces"
ON public.workspaces FOR DELETE
TO public
USING (owner_id = auth.uid());


-- POLÍTICAS PARA A TABELA 'user_workspaces'

-- 1. Permite que um usuário se vincule a um workspace.
CREATE POLICY "Users can insert their own user_workspace link"
ON public.user_workspaces FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 2. Permite que um usuário veja suas próprias associações de workspace.
CREATE POLICY "Users can view their own workspace memberships"
ON public.user_workspaces FOR SELECT
TO authenticated
USING (user_id = auth.uid());
