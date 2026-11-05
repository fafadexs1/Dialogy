'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { OAuthCredentialSchema } from '../services/oauth-credentials';
import {
  deleteNexusCredential,
  listNexusCredentialSummaries,
  saveNexusCredential,
  type NexusCredentialSummary,
  type NexusCredentialType,
} from '../services/credentials';

async function requireManager(workspaceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado.');
  if (!await hasWorkspacePermission(user.id, workspaceId, 'automations:manage')) throw new Error('Acesso não autorizado.');
  return user;
}

export async function listNexusCredentials(workspaceId: string): Promise<{ credentials: NexusCredentialSummary[]; error?: string }> {
  try {
    await requireManager(workspaceId);
    return { credentials: await listNexusCredentialSummaries(workspaceId) };
  } catch (error) {
    return { credentials: [], error: error instanceof Error ? error.message : 'Falha ao listar credenciais.' };
  }
}

export async function createNexusCredentialAction(input: {
  workspaceId: string;
  name: string;
  type: NexusCredentialType;
  payload: Record<string, unknown>;
}): Promise<{ success: boolean; credential?: NexusCredentialSummary; error?: string }> {
  try {
    const user = await requireManager(input.workspaceId);
    if (!input.name.trim()) return { success: false, error: 'Informe o nome da credencial.' };
    const allowedFields: Record<NexusCredentialType, string[]> = {
      oauth2: ['tokenUrl', 'allowedOrigin', 'clientId', 'clientSecret', 'refreshToken', 'grantType', 'scope'],
      bearer: ['token'],
      api_key: ['name', 'value', 'placement'],
      basic: ['username', 'password'],
      smtp: ['host', 'port', 'secure', 'username', 'password', 'from'],
      google_oauth: ['clientId', 'clientSecret', 'refreshToken'],
      database: ['connectionString', 'ssl'],
    };
    const payload = Object.fromEntries(allowedFields[input.type]
      .filter((key) => input.payload[key] !== undefined)
      .map((key) => [key, input.payload[key]]));
    if (input.type === 'oauth2') {
      const checked = OAuthCredentialSchema.safeParse(payload);
      if (!checked.success) return { success: false, error: checked.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') };
    }
    if (Object.values(payload).every((value) => String(value ?? '').trim() === '')) {
      return { success: false, error: 'Preencha os dados da credencial.' };
    }
    const credential = await saveNexusCredential({
      workspaceId: input.workspaceId,
      userId: user.id,
      name: input.name,
      type: input.type,
      payload,
    });
    revalidatePath('/nexus');
    return { success: true, credential };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao salvar a credencial.' };
  }
}

export async function deleteNexusCredentialAction(input: { workspaceId: string; credentialId: string }) {
  try {
    await requireManager(input.workspaceId);
    await deleteNexusCredential(input.workspaceId, input.credentialId);
    revalidatePath('/nexus');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao excluir a credencial.' };
  }
}

