
'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { Buffer } from 'node:buffer';
import { ensurePermissionsSeed } from '@/lib/permissions-seed';
import { updateUserOnlineStatus } from '@/lib/presence-server';
import { loadResourceMappingProfileText, upsertResourceMappingProfile } from '@/services/resource-mapper/profiles';

function normalizeWorkspaceVertical(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  if (value === '__none__') return null;
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return normalized || null;
}

async function isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
  const res = await db.query(
    'SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2 LIMIT 1',
    [userId, workspaceId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function createWorkspaceAction(
  prevState: any,
  formData: FormData
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }
  const userId = user.id;
  const workspaceName = formData.get('workspaceName') as string;
  const workspaceVertical = normalizeWorkspaceVertical(formData.get('vertical'));

  if (!workspaceName) {
    return { success: false, error: 'O nome do workspace é obrigatório.' };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await ensurePermissionsSeed();

    // 1. Inserir o novo workspace.
    const workspaceRes = await client.query(
      'INSERT INTO workspaces (name, owner_id, vertical) VALUES ($1, $2, $3) RETURNING id',
      [workspaceName, userId, workspaceVertical]
    );
    const newWorkspaceId = workspaceRes.rows[0].id;

    // 2. Criar os papéis (roles) padrão para o novo workspace.
    const adminRoleRes = await client.query(
      `INSERT INTO roles (workspace_id, name, description, is_default) VALUES ($1, 'Administrador', 'Acesso total a todas as funcionalidades e configurações.', FALSE) RETURNING id`,
      [newWorkspaceId]
    );
    // CRIAÇÃO DO PAPEL DE MEMBRO - CORREÇÃO
    await client.query(
      `INSERT INTO roles (workspace_id, name, description, is_default) VALUES ($1, 'Membro', 'Acesso às funcionalidades principais, mas com permissões limitadas.', TRUE)`,
      [newWorkspaceId]
    );
    const adminRoleId = adminRoleRes.rows[0].id;

    // 3. Buscar todas as permissões disponíveis no sistema.
    const permissionsRes = await client.query('SELECT id::text FROM permissions');
    const permissions = permissionsRes.rows;

    // 4. Atribuir TODAS as permissões ao papel de Administrador recém-criado.
    if (permissions.length > 0) {
      const rolePermissionValues = permissions.map(p => `('${adminRoleId}', '${p.id}')`).join(',');
      await client.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ${rolePermissionValues}`);
    } else {
      console.warn(`[CREATE_WORKSPACE] Nenhuma permissão encontrada no banco de dados para atribuir ao Administrador.`);
    }

    // 5. Associar o usuário criador ao papel de Administrador.
    await client.query(
      'INSERT INTO user_workspace_roles (user_id, workspace_id, role_id) VALUES ($1, $2, $3)',
      [userId, newWorkspaceId, adminRoleId]
    );

    // 6. Atualizar o workspace ativo do usuário
    await client.query(
      'UPDATE users SET last_active_workspace_id = $1 WHERE id = $2',
      [newWorkspaceId, userId]
    );

    await client.query('COMMIT');

    console.log(`[CREATE_WORKSPACE] Workspace "${workspaceName}" (ID: ${newWorkspaceId}) criado, usuário ${userId} definido como Administrador com ${permissions.length} permissões.`);

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[CREATE_WORKSPACE] Erro:', error);
    // Retorna a mensagem de erro específica do banco de dados
    return { success: false, error: error.message || 'Ocorreu um erro desconhecido no servidor.' };
  } finally {
    client.release();
  }

  revalidatePath('/', 'layout');
  revalidateTag('workspace-config', 'default');

  // Return success state instead of redirecting
  return { success: true, error: null };
}

export async function getResourceMappingProfile(workspaceId: string): Promise<{
  profileText: string;
  error?: string | null;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { profileText: '', error: 'Usuario nao autenticado.' };
  if (!workspaceId || !(await isWorkspaceMember(user.id, workspaceId))) {
    return { profileText: '', error: 'Voce nao tem acesso a este workspace.' };
  }

  return {
    profileText: await loadResourceMappingProfileText({ workspaceId }),
    error: null,
  };
}

export async function updateResourceMappingProfileAction(
  prevState: any,
  formData: FormData
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Usuario nao autenticado.' };

  const workspaceId = String(formData.get('workspaceId') || '').trim();
  const aliasesText = String(formData.get('resourceMappingAliases') || '');
  if (!workspaceId) return { success: false, error: 'ID do workspace nao encontrado.' };
  if (!(await isWorkspaceMember(user.id, workspaceId))) {
    return { success: false, error: 'Voce nao tem acesso a este workspace.' };
  }

  try {
    await upsertResourceMappingProfile({ workspaceId, aliasesText });
  } catch (error: any) {
    console.error('[RESOURCE_MAPPING_PROFILE] Failed to update profile:', error);
    return { success: false, error: `Falha ao salvar aliases do Resource Mapper: ${error.message || 'erro desconhecido'}` };
  }

  revalidatePath('/settings/workspace');
  return { success: true, error: null };
}


export async function updateWorkspaceAction(
  prevState: any,
  formData: FormData
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const workspaceId = formData.get('workspaceId') as string;
  const workspaceName = formData.get('workspaceName') as string;
  const timezone = formData.get('timezone') as string;
  const closeMessageTemplate = formData.get('closeMessageTemplate') as string;
  const transferMessageTemplate = formData.get('transferMessageTemplate') as string;
  const marketingAutoCloseSecondsRaw = formData.get('marketingAutoCloseSeconds') as string;
  const queueAutoCloseSecondsRaw = formData.get('queueAutoCloseSeconds') as string;
  const avatarFile = formData.get('avatarFile');


  if (!workspaceId) {
    return { success: false, error: 'ID do workspace não encontrado.' };
  }

  // Futuramente: Adicionar verificação de permissão 'workspace:settings:edit'

  const fieldsToUpdate: { [key: string]: any } = {};
  if (formData.has('workspaceName')) fieldsToUpdate.name = workspaceName;
  if (formData.has('timezone')) fieldsToUpdate.timezone = timezone;
  if (formData.has('vertical')) fieldsToUpdate.vertical = normalizeWorkspaceVertical(formData.get('vertical'));
  if (formData.has('closeMessageTemplate')) fieldsToUpdate.close_message_template = closeMessageTemplate || '';
  if (formData.has('transferMessageTemplate')) fieldsToUpdate.transfer_team_message_template = transferMessageTemplate || '';
  if (formData.has('marketingAutoCloseSeconds')) {
    const parsed = Number(marketingAutoCloseSecondsRaw);
    const normalized = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
    if (normalized !== null) {
      fieldsToUpdate.marketing_auto_close_seconds = normalized;
    }
  }
  if (formData.has('queueAutoCloseSeconds')) {
    const parsed = Number(queueAutoCloseSecondsRaw);
    const normalized = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
    if (normalized !== null) {
      fieldsToUpdate.queue_auto_close_seconds = normalized;
    }
  }

  const nexusEmail = formData.get('nexusEmail') as string | null;
  if (nexusEmail !== null && nexusEmail !== undefined) {
    // If empty string, we might want to plain null or empty object. 
    // Let's store object { email: ... }
    if (nexusEmail.trim() === '') {
      fieldsToUpdate.nexus_settings = {};
    } else {
      fieldsToUpdate.nexus_settings = { email: nexusEmail.trim() };
    }
  }

  if (avatarFile && avatarFile instanceof File && avatarFile.size > 0) {
    try {
      const arrayBuffer = await avatarFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const extension = avatarFile.name?.split('.').pop() || 'png';
      const filePath = `public/${workspaceId}-${Date.now()}.${extension}`;

      const { error: uploadError } = await getSupabaseAdmin().storage
        .from('workspace-avatars')
        .upload(filePath, buffer, {
          upsert: true,
          contentType: avatarFile.type || 'image/png',
        });

      if (uploadError) {
        console.error('[UPDATE_WORKSPACE] Upload erro:', uploadError);
        return { success: false, error: `Erro ao enviar avatar: ${uploadError.message}` };
      }

      const { data: publicData } = getSupabaseAdmin().storage
        .from('workspace-avatars')
        .getPublicUrl(filePath);

      if (!publicData?.publicUrl) {
        return { success: false, error: 'Erro ao gerar URL pública do avatar.' };
      }

      fieldsToUpdate.avatar_url = publicData.publicUrl;
    } catch (error: any) {
      console.error('[UPDATE_WORKSPACE] Avatar upload exception:', error);
      return { success: false, error: 'Erro inesperado ao enviar o avatar do workspace.' };
    }
  }

  if (Object.keys(fieldsToUpdate).length === 0) {
    return { success: true, error: null }; // Nada para atualizar
  }

  const setClause = Object.keys(fieldsToUpdate)
    .map((key, i) => `${key} = $${i + 1}`)
    .join(', ');

  const values = Object.values(fieldsToUpdate);

  try {
    await db.query(`UPDATE workspaces SET ${setClause} WHERE id = $${values.length + 1}`, [...values, workspaceId]);
    console.log(`[UPDATE_WORKSPACE] Workspace ${workspaceId} atualizado. Campos: ${Object.keys(fieldsToUpdate).join(', ')}.`);
  } catch (error: any) {
    console.error('[UPDATE_WORKSPACE] Erro:', error);
    return { success: false, error: `Ocorreu um erro no servidor ao atualizar o workspace: ${error.message}` };
  }

  revalidatePath('/', 'layout');
  revalidatePath('/settings/workspace');
  revalidateTag('workspace-config', 'default');

  return { success: true, error: null };
}

export async function switchWorkspaceAction(workspaceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error('[SWITCH_WORKSPACE] Usuário não autenticado.');
    return;
  }
  const userId = user.id;

  try {
    // 1. Get the current active workspace to mark as offline
    const userRes = await db.query('SELECT last_active_workspace_id FROM users WHERE id = $1', [userId]);
    const oldWorkspaceId = userRes.rows[0]?.last_active_workspace_id;

    if (oldWorkspaceId && oldWorkspaceId !== workspaceId) {
      // 2. Mark as offline in the OLD workspace (clear all sessions)
      await updateUserOnlineStatus(userId, oldWorkspaceId, false, undefined, true, 'workspace_switch');
      console.log(`[SWITCH_WORKSPACE] User ${userId} marked offline in old workspace ${oldWorkspaceId}`);
    }

    // 3. Switch to NEW workspace
    await db.query('UPDATE users SET last_active_workspace_id = $1 WHERE id = $2', [workspaceId, userId]);

    // 4. Force online in NEW workspace immediately
    await updateUserOnlineStatus(userId, workspaceId, true, undefined, false, 'workspace_switch_bootstrap');

    console.log(`[SWITCH_WORKSPACE] Usuário ${userId} trocou para o workspace ${workspaceId}.`);
  } catch (error) {
    console.error('[SWITCH_WORKSPACE] Erro:', error);
  }

  revalidatePath('/', 'layout');
}
