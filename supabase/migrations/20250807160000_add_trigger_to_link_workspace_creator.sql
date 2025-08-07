
-- 1. Criar a função que será executada pelo gatilho
create or replace function public.link_creator_to_workspace()
returns trigger
language plpgsql
security definer -- Executa com os privilégios do usuário que definiu a função (normalmente o superuser)
as $$
begin
  -- Insere um registro na tabela de junção `user_workspaces`
  -- `new.id` se refere ao ID do workspace que acabou de ser criado
  -- `auth.uid()` se refere ao ID do usuário autenticado que acionou o gatilho
  insert into public.user_workspaces (user_id, workspace_id)
  values (auth.uid(), new.id);
  return new;
end;
$$;

-- 2. Criar o gatilho que será acionado após a inserção de um novo workspace
-- Remover o gatilho antigo se ele existir, para evitar erros
drop trigger if exists on_workspace_created on public.workspaces;

-- Criar o novo gatilho
create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute procedure public.link_creator_to_workspace();
