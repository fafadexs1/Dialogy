-- Apaga todas as políticas de segurança possivelmente conflitantes de tentativas anteriores.
-- Usamos 'IF EXISTS' para que o script não falhe se uma política já tiver sido removida.
DROP POLICY IF EXISTS "Authenticated users can insert workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can create and view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can see workspaces they are part of" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view workspaces they are members of" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários autenticados podem criar workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários podem ver workspaces dos quais são membros" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem alterar seus próprios workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem deletar seus próprios workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;


DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Allow workspace creator linking via trigger" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can be added to workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can see their own workspace memberships" ON public.user_workspaces;


-- Recria o conjunto correto e limpo de políticas de segurança.

-- Tabela: workspaces
-- 1. Permite que qualquer usuário autenticado crie um novo workspace.
CREATE POLICY "Authenticated users can create workspaces"
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (true);

-- 2. Permite que um usuário visualize um workspace se ele for membro.
CREATE POLICY "Users can view workspaces they belong to"
ON public.workspaces FOR SELECT
TO authenticated
USING (id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));

-- 3. Permite que o dono do workspace o atualize.
CREATE POLICY "Owners can update their own workspaces"
ON public.workspaces FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- 4. Permite que o dono do workspace o delete.
CREATE POLICY "Owners can delete their own workspaces"
ON public.workspaces FOR DELETE
TO authenticated
USING (owner_id = auth.uid());


-- Tabela: user_workspaces
-- 1. Permite que um usuário se insira na tabela de membros (vincule-se a um workspace).
CREATE POLICY "Users can insert their own membership"
ON public.user_workspaces FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 2. Permite que um usuário veja suas próprias associações de workspace.
CREATE POLICY "Users can view their own memberships"
ON public.user_workspaces FOR SELECT
TO authenticated
USING (user_id = auth.uid());
