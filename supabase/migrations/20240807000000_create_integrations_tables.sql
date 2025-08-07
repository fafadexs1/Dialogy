
-- Tabela para armazenar a configuração global da Evolution API por usuário
create table public.evolution_api_configs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users not null unique,
    api_url text,
    api_key text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Tabela para armazenar as instâncias individuais da Evolution API
create table public.evolution_api_instances (
    id uuid primary key default gen_random_uuid(),
    config_id uuid references public.evolution_api_configs not null,
    name text not null,
    type text not null default 'baileys', -- 'baileys' ou 'wa_cloud'
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Ativar RLS (Row-Level Security)
alter table public.evolution_api_configs enable row level security;
alter table public.evolution_api_instances enable row level security;

-- Políticas de Segurança para evolution_api_configs
create policy "Usuários podem ver suas próprias configurações"
on public.evolution_api_configs for select
using (auth.uid() = user_id);

create policy "Usuários podem inserir suas próprias configurações"
on public.evolution_api_configs for insert
with check (auth.uid() = user_id);

create policy "Usuários podem atualizar suas próprias configurações"
on public.evolution_api_configs for update
using (auth.uid() = user_id);

-- Políticas de Segurança para evolution_api_instances
create policy "Usuários podem ver instâncias associadas à sua configuração"
on public.evolution_api_instances for select
using (exists (
    select 1 from public.evolution_api_configs
    where id = config_id and user_id = auth.uid()
));

create policy "Usuários podem inserir instâncias associadas à sua configuração"
on public.evolution_api_instances for insert
with check (exists (
    select 1 from public.evolution_api_configs
    where id = config_id and user_id = auth.uid()
));

create policy "Usuários podem remover suas próprias instâncias"
on public.evolution_api_instances for delete
using (exists (
    select 1 from public.evolution_api_configs
    where id = config_id and user_id = auth.uid()
));
