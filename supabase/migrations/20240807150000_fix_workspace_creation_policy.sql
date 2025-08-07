
-- Remover políticas antigas para evitar conflitos
drop policy if exists "Users can see workspaces they are part of" on public.workspaces;
drop policy if exists "Users can create workspaces" on public.workspaces;

-- Permitir que usuários autenticados CRIEM workspaces.
-- A verificação `with check (true)` é uma forma simples de permitir a inserção para qualquer usuário autenticado.
create policy "Users can create workspaces"
on public.workspaces for insert
to authenticated with check (true);

-- Permitir que usuários VEJAM apenas os workspaces dos quais são membros.
create policy "Users can see workspaces they are part of"
on public.workspaces for select
using (
  id in (
    select workspace_id from public.user_workspaces where user_id = auth.uid()
  )
);

-- Remover política antiga para garantir que a nova seja aplicada
drop policy if exists "Users can manage their own workspace memberships" on public.user_workspaces;

-- Permitir que usuários se insiram (ou sejam inseridos pela aplicação) em um workspace
-- se o user_id for o deles.
create policy "Users can be added to workspaces"
on public.user_workspaces for insert
to authenticated with check ( auth.uid() = user_id );

-- Permitir que usuários vejam suas próprias associações a workspaces.
create policy "Users can see their own workspace memberships"
on public.user_workspaces for select
to authenticated using ( auth.uid() = user_id );
