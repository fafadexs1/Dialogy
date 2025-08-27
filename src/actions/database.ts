
'use server';

import { db } from '@/lib/db';

export async function initializeDatabase(): Promise<{ success: boolean; message: string }> {
  console.log('[DB_SETUP] Iniciando a configuração do banco de dados...');
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    console.log('[DB_SETUP] Transação iniciada.');

    // --- Garante a extensão pgcrypto ---
    console.log('[DB_SETUP] Verificando/Criando extensão pgcrypto...');
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    console.log('[DB_SETUP] Extensão pgcrypto garantida.');

    // --- Garante UUIDs para as tabelas principais ---
    const tablesToUpdate = [
        'workspaces', 'roles', 'user_workspace_roles', 'teams', 
        'team_members', 'contacts', 'tags', 'contact_tags', 
        'activities', 'custom_field_definitions', 'contact_custom_field_values', 
        'chats', 'messages', 'workspace_invites', 'user_invites',
        'role_permissions', 'system_agents', 'autopilot_configs', 
        'autopilot_rules', 'autopilot_usage_logs', 'evolution_api_configs', 
        'evolution_api_instances', 'shortcuts', 'campaigns', 'campaign_recipients'
    ];

    for (const table of tablesToUpdate) {
        console.log(`[DB_SETUP] Verificando e alterando a tabela: ${table}`);
        await client.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = '${table}' AND column_name = 'id'
                ) THEN
                    ALTER TABLE "${table}" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
                ELSE
                    RAISE NOTICE 'A tabela ${table} não possui uma coluna "id", pulando.';
                END IF;
            END$$;
        `);
        console.log(`[DB_SETUP] Tabela ${table} atualizada (ou ignorada se não aplicável).`);
    }

    // --- Outras alterações ---
    console.log('[DB_SETUP] Configurando outros padrões...');
    await client.query(`ALTER TABLE "workspaces" ALTER COLUMN "updated_at" SET DEFAULT NOW();`);

    await client.query('COMMIT');
    console.log('[DB_SETUP] Transação concluída com sucesso.');

    return {
      success: true,
      message: "Banco de dados inicializado com sucesso! As tabelas foram verificadas e os padrões de ID foram aplicados.",
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[DB_SETUP] Erro durante a inicialização do banco de dados:', error);
    return {
      success: false,
      message: `Falha na inicialização: ${error.message}`,
    };
  } finally {
    client.release();
    console.log('[DB_SETUP] Conexão com o banco de dados liberada.');
  }
}
