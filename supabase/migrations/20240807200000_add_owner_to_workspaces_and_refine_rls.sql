-- Use a DO block to conditionally add the column only if it doesn't exist.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'workspaces'
        AND column_name = 'owner_id'
    ) THEN
        -- Adiciona a coluna 'owner_id' à tabela 'workspaces'
        -- Ela terá como valor padrão o ID do usuário que a criou e fará referência à sua tabela de usuários.
        ALTER TABLE public.workspaces
        ADD COLUMN owner_id uuid DEFAULT auth.uid() REFERENCES public.users(id);
    END IF;
END $$;

-- Primeiro, removemos as políticas antigas para evitar conflitos.
DROP POLICY IF EXISTS "Usuários autenticados podem criar workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários podem ver workspaces dos quais são membros" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem alterar seus próprios workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem deletar seus próprios workspaces" ON public.workspaces;


-- POLÍTICA DE CRIAÇÃO (INSERT)
-- Permite que usuários autenticados criem um workspace. A coluna 'owner_id' será preenchida pelo DEFAULT.
CREATE POLICY "Usuários autenticados podem criar workspaces"
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (true);


-- POLÍTICA DE VISUALIZAÇÃO (SELECT)
-- Permite que um usuário veja todos os workspaces dos quais ele é membro.
CREATE POLICY "Usuários podem ver workspaces dos quais são membros"
ON public.workspaces FOR SELECT
TO public
USING (id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));


-- POLÍTICA DE ALTERAÇÃO (UPDATE)
-- Permite que APENAS o proprietário do workspace altere seus dados.
CREATE POLICY "Proprietários podem alterar seus próprios workspaces"
ON public.workspaces FOR UPDATE
TO public
USING (owner_id = auth.uid());


-- POLÍTICA DE EXCLUSÃO (DELETE)
-- Permite que APENAS o proprietário do workspace o exclua.
CREATE POLICY "Proprietários podem deletar seus próprios workspaces"
ON public.workspaces FOR DELETE
TO public
USING (owner_id = auth.uid());


-- POLÍTICAS PARA a tabela user_workspaces

-- Primeiro, removemos as políticas antigas para evitar conflitos.
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can be added to workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can see their own workspace memberships" ON public.user_workspaces;

-- Permite que um usuário veja suas próprias associações de workspace.
CREATE POLICY "Users can view their own workspace memberships"
ON public.user_workspaces FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Permite que um usuário se insira na tabela (se associe a um workspace).
CREATE POLICY "Users can be added to workspaces"
ON public.user_workspaces FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);
