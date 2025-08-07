
-- Remover políticas antigas para evitar conflitos
drop policy if exists "Users can see workspaces they are part of" on public.workspaces;
drop policy if exists "Authenticated users can create workspaces" on public.workspaces;
drop policy if exists "Users can insert their own user_workspace link" on public.user_workspaces;
drop policy if exists "Users can see their own workspace memberships" on public.user_workspaces;


-- Política para a tabela WORKSPACES
-- 1. Permite que QUALQUER usuário autenticado crie um novo workspace.
create policy "Authenticated users can insert workspaces"
on public.workspaces for insert
to authenticated
with check (true);

-- 2. Permite que usuários vejam APENAS os workspaces dos quais são membros.
create policy "Users can view workspaces they are members of"
on public.workspaces for select
using (
  auth.uid() in (
    select user_id from public.user_workspaces where workspace_id = id
  )
);


-- Política para a tabela USER_WORKSPACES
-- Permite que um usuário veja suas próprias associações de workspace.
create policy "Users can view their own workspace memberships"
on public.user_workspaces for select
using ( auth.uid() = user_id );

-- Permite que a função de gatilho (security definer) insira na tabela
-- (Necessário para o gatilho `link_creator_to_workspace`)
create policy "Allow workspace creator linking via trigger"
on public.user_workspaces for insert
with check (true);

-- Um usuário não pode adicionar a si mesmo ou outros a um workspace diretamente
-- Apenas o gatilho pode fazer isso.

