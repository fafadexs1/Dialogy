import { db } from '../src/lib/db';

async function main() {
  console.log('[MIGRATION] Aplicando custom_access_token_hook...');

  const sql = `
  create or replace function public.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  as $$
  declare
    claims jsonb;
    user_id_val uuid;
    is_super boolean;
    workspace_ids jsonb;
  begin
    user_id_val := (event->>'user_id')::uuid;
    claims := event->'claims';

    if claims is null then
      return event;
    end if;

    -- 1. Verifica se o usuário é superadmin
    select coalesce(is_superadmin, false) into is_super
    from public.users
    where id = user_id_val;

    -- 2. Coleta todos os workspace_ids acessíveis (como dono ou membro)
    select coalesce(jsonb_agg(w_id), '[]'::jsonb) into workspace_ids
    from (
      select id::text as w_id from public.workspaces where owner_id = user_id_val
      union
      select workspace_id::text as w_id from public.user_workspace_roles where user_id = user_id_val
    ) w;

    -- Garante que app_metadata existe
    if jsonb_typeof(claims->'app_metadata') is null or jsonb_typeof(claims->'app_metadata') = 'null' then
      claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
    end if;

    -- Injeta claims seguras no app_metadata do JWT
    claims := jsonb_set(claims, '{app_metadata,is_superadmin}', to_jsonb(coalesce(is_super, false)));
    claims := jsonb_set(claims, '{app_metadata,workspace_ids}', workspace_ids);

    event := jsonb_set(event, '{claims}', claims);
    return event;
  exception when others then
    -- Fallback seguro em caso de exceção: nunca derruba o login
    return event;
  end;
  $$;

  grant usage on schema public to supabase_auth_admin;
  grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
  grant select on table public.users to supabase_auth_admin;
  grant select on table public.workspaces to supabase_auth_admin;
  grant select on table public.user_workspace_roles to supabase_auth_admin;

  revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
  `;

  await db.query(sql);
  console.log('[MIGRATION] custom_access_token_hook criado e permissões concedidas com sucesso!');

  // Teste direto da função SQL com payload simulado do GoTrue
  const testUser = await db.query('SELECT id FROM public.users LIMIT 1');
  if (testUser.rows[0]) {
    const uid = testUser.rows[0].id;
    const testPayload = {
      user_id: uid,
      claims: {
        aud: 'authenticated',
        app_metadata: {},
      },
      authentication_method: 'password',
    };
    const testResult = await db.query(
      'SELECT public.custom_access_token_hook($1::jsonb) AS result',
      [JSON.stringify(testPayload)]
    );
    console.log('[MIGRATION_TEST] Resultado do hook:', JSON.stringify(testResult.rows[0]?.result, null, 2));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[MIGRATION_ERROR]', err);
  process.exit(1);
});
