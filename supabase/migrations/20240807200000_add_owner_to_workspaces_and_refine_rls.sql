-- Adiciona a coluna 'owner_id' à tabela 'workspaces'
-- Ela terá como valor padrão o ID do usuário que a criou e fará referência à sua tabela de usuários.
ALTER TABLE public.workspaces
ADD COLUMN IF NOT EXISTS owner_id uuid DEFAULT auth.uid() REFERENCES public.users(id);

-- Primeiro, removemos as políticas antigas para evitar conflitos.
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários autenticados podem criar workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários podem ver workspaces dos quais são membros" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem alterar seus próprios workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem deletar seus próprios workspaces" ON public.workspaces;


-- POLÍTICA DE CRIAÇÃO (INSERT)
-- Permite que usuários autenticados criem um workspace, garantindo que eles sejam os donos.
CREATE POLICY "Usuários autenticados podem criar workspaces"
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (owner_id = auth.uid());


-- POLÍTICA DE VISUALIZAÇÃO (SELECT)
-- Permite que um usuário veja todos os workspaces dos quais ele é membro.
CREATE POLICY "Usuários podem ver workspaces dos quais são membros"
ON public.workspaces FOR SELECT
USING (id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));


-- POLÍTICA DE ALTERAÇÃO (UPDATE)
-- Permite que APENAS o proprietário do workspace altere seus dados.
CREATE POLICY "Proprietários podem alterar seus próprios workspaces"
ON public.workspaces FOR UPDATE
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());


-- POLÍTICA DE EXCLUSÃO (DELETE)
-- Permite que APENAS o proprietário do workspace o exclua.
CREATE POLICY "Proprietários podem deletar seus próprios workspaces"
ON public.workspaces FOR DELETE
USING (owner_id = auth.uid());
