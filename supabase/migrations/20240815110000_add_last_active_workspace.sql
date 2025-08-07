-- Adiciona a coluna para armazenar o último workspace ativo do usuário
ALTER TABLE public.users
ADD COLUMN last_active_workspace_id UUID
REFERENCES public.workspaces(id) ON DELETE SET NULL;

-- Atualiza a política de SELECT na tabela 'users' para permitir que os usuários leiam sua própria nova coluna.
-- Primeiro, removemos a política existente se ela houver.
DROP POLICY IF EXISTS "Authenticated users can select own user data." ON public.users;

-- Recriamos a política com a permissão de leitura.
CREATE POLICY "Authenticated users can select own user data."
    ON public.users FOR SELECT
    TO authenticated
    USING ( (auth.uid() = id) );

-- Atualiza a política de UPDATE para permitir que o usuário modifique seu 'last_active_workspace_id'.
DROP POLICY IF EXISTS "Authenticated users can update own user data." ON public.users;

CREATE POLICY "Authenticated users can update own user data."
    ON public.users FOR UPDATE
    TO authenticated
    USING ( (auth.uid() = id) )
    WITH CHECK ( (auth.uid() = id) );
