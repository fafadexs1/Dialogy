-- supabase/migrations/20240808110000_final_rls_policy_reset.sql

-- LIMPEZA AGRESSIVA DE POLÍTICAS ANTIGAS E CONFLITANTES

-- Policies na tabela 'workspaces'
DROP POLICY IF EXISTS "Allow authenticated users to create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Allow users to view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Authenticated users can insert workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can delete their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Owners can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem alterar seus próprios workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Proprietários podem deletar seus próprios workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can create and view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can see workspaces they are part of" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view workspaces they are members of" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários podem ver workspaces dos quais são membros" ON public.workspaces;
DROP POLICY IF EXISTS "Usuários autenticados podem criar workspaces" ON public.workspaces;


-- Policies na tabela 'user_workspaces'
DROP POLICY IF EXISTS "Allow workspace creator linking via trigger" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can be added to workspaces" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can see their own workspace memberships" ON public.user_workspaces;
DROP POLICY IF EXISTS "Users can view their own workspace memberships" ON public.user_workspaces;


-- RECRIAR O CONJUNTO DE POLÍTICAS CORRETO E DEFINITIVO

-- Policies para a tabela 'workspaces'

CREATE POLICY "Authenticated users can insert workspaces"
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Users can view workspaces they are members of"
ON public.workspaces FOR SELECT
USING (id IN (
    SELECT workspace_id FROM public.user_workspaces WHERE user_id = auth.uid()
));

CREATE POLICY "Owners can update their own workspaces"
ON public.workspaces FOR UPDATE
USING (owner_id = auth.uid());

CREATE POLICY "Owners can delete their own workspaces"
ON public.workspaces FOR DELETE
USING (owner_id = auth.uid());


-- Policies para a tabela 'user_workspaces'

CREATE POLICY "Users can insert their own workspace memberships"
ON public.user_workspaces FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());


CREATE POLICY "Users can view their own workspace memberships"
ON public.user_workspaces FOR SELECT
TO authenticated
USING (user_id = auth.uid());
