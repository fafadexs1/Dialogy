
'use server';

import { db } from '@/lib/db';

const PERMISSIONS = [
    // Workspace & Settings
    { id: 'workspace:settings:view', category: 'Workspace', description: 'Visualizar configurações do workspace' },
    { id: 'workspace:settings:edit', category: 'Workspace', description: 'Editar configurações do workspace' },
    { id: 'workspace:invites:manage', category: 'Workspace', description: 'Criar e revogar convites para o workspace' },
    // Members & Permissions
    { id: 'members:view', category: 'Membros', description: 'Visualizar membros do workspace' },
    { id: 'members:remove', category: 'Membros', description: 'Remover membros do workspace' },
    { id: 'permissions:view', category: 'Membros', description: 'Visualizar papéis e permissões' },
    { id: 'permissions:edit', category: 'Membros', description: 'Criar, editar e atribuir papéis e permissões' },
    // Teams
    { id: 'teams:view', category: 'Equipes', description: 'Visualizar equipes' },
    { id: 'teams:edit', category: 'Equipes', description: 'Criar, editar e remover equipes e seus membros' },
    // CRM
    { id: 'crm:view', category: 'CRM', description: 'Visualizar contatos e suas informações' },
    { id: 'crm:edit', category: 'CRM', description: 'Criar e editar contatos e suas informações' },
    { id: 'crm:delete', category: 'CRM', description: 'Excluir contatos' },
    // Campaigns
    { id: 'campaigns:manage', category: 'Campanhas', description: 'Criar, visualizar e gerenciar campanhas' },
    { id: 'campaigns:delete', category: 'Campanhas', description: 'Excluir campanhas' },
    // Automations
    { id: 'automations:manage', category: 'Automações', description: 'Gerenciar o Piloto Automático e Agentes do Sistema' },
    // Analytics
    { id: 'analytics:view', category: 'Analytics', description: 'Visualizar a página de Analytics' },
];


export async function initializeDatabase(): Promise<{ success: boolean; message: string }> {
  console.log('[DB_SETUP] Iniciando a configuração completa do banco de dados...');
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    console.log('[DB_SETUP] Transação iniciada.');

    // --- 1. Garante a extensão pgcrypto ---
    console.log('[DB_SETUP] Verificando/Criando extensão pgcrypto...');
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    console.log('[DB_SETUP] Extensão pgcrypto garantida.');

    // --- 2. Garante UUIDs para as tabelas principais ---
    const tablesToUpdate = [
        'workspaces', 'roles', 'user_workspace_roles', 'teams', 
        'team_members', 'contacts', 'tags', 'contact_tags', 
        'activities', 'custom_field_definitions', 'contact_custom_field_values', 
        'chats', 'messages', 'workspace_invites', 'user_invites',
        'role_permissions', 'system_agents', 'autopilot_configs', 
        'autopilot_rules', 'autopilot_usage_logs', 'evolution_api_configs', 
        'evolution_api_instances', 'shortcuts', 'campaigns', 'campaign_recipients'
    ];
    console.log('[DB_SETUP] Configurando IDs padrão para as tabelas...');
    for (const table of tablesToUpdate) {
        await client.query(`
            ALTER TABLE "${table}" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
        `);
    }
    console.log('[DB_SETUP] IDs padrão configurados.');

    // --- 3. Garante que as permissões padrão existam ---
    console.log('[DB_SETUP] Verificando e populando a tabela de permissões...');
    const existingPermissions = await client.query('SELECT id FROM permissions');
    const existingIds = new Set(existingPermissions.rows.map(p => p.id));
    
    const permissionsToInsert = PERMISSIONS.filter(p => !existingIds.has(p.id));

    if (permissionsToInsert.length > 0) {
        const permValues = permissionsToInsert.map(p => `('${p.id}', '${p.category}', '${p.description}')`).join(',');
        await client.query(`INSERT INTO permissions (id, category, description) VALUES ${permValues}`);
        console.log(`[DB_SETUP] ${permissionsToInsert.length} novas permissões foram inseridas.`);
    } else {
        console.log('[DB_SETUP] Todas as permissões padrão já existem. Nenhuma inserção necessária.');
    }
    
    // --- Outras alterações (se houver) ---
    console.log('[DB_SETUP] Configurando outros padrões...');
    await client.query(`ALTER TABLE "workspaces" ALTER COLUMN "updated_at" SET DEFAULT NOW();`);

    await client.query('COMMIT');
    console.log('[DB_SETUP] Transação concluída com sucesso.');

    return {
      success: true,
      message: "Banco de dados inicializado e verificado com sucesso! As permissões e os padrões de ID foram aplicados.",
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
