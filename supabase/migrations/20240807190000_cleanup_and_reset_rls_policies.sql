-- Limpeza completa de todas as políticas antigas e conflitantes
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can create and view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can see workspaces they are part of" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view workspaces they are members of" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can insert workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspaces" ON public.workspaces;

DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Allow workspace creator linking via trigger" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can be added to workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can see their own workspace memberships" ON public.user_workspaces;


-- Políticas Corretas e Únicas para a tabela WORKSPACES

-- 1. Qualquer usuário autenticado pode criar um workspace.
CREATE POLICY "Allow authenticated users to create workspaces"
ON public.workspaces
FOR INSERT TO authenticated
WITH CHECK (true);

-- 2. Usuários podem ver apenas os workspaces dos quais são membros.
CREATE POLICY "Allow users to view their own workspaces"
ON public.workspaces
FOR SELECT USING (
  id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
  )
);


-- Políticas Corretas e Únicas para a tabela USER_WORKSPACES

-- 1. Um usuário pode se inserir na tabela de associação, desde que o user_id seja o seu próprio.
--    Isso é necessário para a action que cria o workspace e depois vincula o usuário.
CREATE POLICY "Allow users to join workspaces"
ON public.user_workspaces
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 2. Usuários podem ver apenas as suas próprias associações.
CREATE POLICY "Allow users to see their own workspace memberships"
ON public.user_workspaces
FOR SELECT TO authenticated
USING (auth.uid() = user_id);
