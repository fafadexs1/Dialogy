-- Adiciona a coluna 'owner_id' à tabela 'workspaces'
-- Ela terá como valor padrão o ID do usuário que a criou e fará referência à sua tabela de usuários.
ALTER TABLE public.workspaces
ADD COLUMN IF NOT EXISTS owner_id uuid DEFAULT auth.uid();

-- Adiciona a chave estrangeira separadamente para evitar erro se a coluna já existir.
ALTER TABLE public.workspaces
ADD CONSTRAINT workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Remove as políticas antigas da tabela 'workspaces' para evitar conflitos.
DROP POLICY IF EXISTS "Usuários autenticados podem criar workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários podem ver workspaces dos quais são membros" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem alterar seus próprios workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem deletar seus próprios workspaces" ON public.workspaces;


-- POLÍTICA DE CRIAÇÃO (INSERT)
-- Permite que usuários autenticados criem um workspace.
CREATE POLICY "Usuários autenticados podem criar workspaces"
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (true);


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
USING (owner_id = auth.uid());


-- POLÍTICA DE EXCLUSÃO (DELETE)
-- Permite que APENAS o proprietário do workspace o exclua.
CREATE POLICY "Proprietários podem deletar seus próprios workspaces"
ON public.workspaces FOR DELETE
USING (owner_id = auth.uid());


-- Remove políticas conflitantes da tabela 'user_workspaces'
DROP POLICY IF EXISTS "Allow workspace creator linking via trigger" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can be added to workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can see their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;

-- POLÍTICAS PARA A TABELA DE JUNÇÃO (user_workspaces)
-- Permite que um usuário se insira na tabela, desde que o user_id seja o seu próprio.
CREATE POLICY "Usuários podem se vincular a um workspace"
ON public.user_workspaces FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Permite que um usuário veja suas próprias associações de workspace.
CREATE POLICY "Usuários podem ver suas próprias associações"
ON public.user_workspaces FOR SELECT
TO authenticated
USING (user_id = auth.uid());
