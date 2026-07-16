'use server';

import { randomUUID } from 'crypto';
import { requireWorkspacePermission, toPublicAccessError } from '@/lib/security/access';
import { putPrivateObject } from '@/lib/storage/private-s3';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

export async function uploadToS3Action(formData: FormData): Promise<{
  success: boolean;
  url?: string;
  fileName?: string;
  code?: string;
  error?: string;
}> {
  try {
    const workspaceId = String(formData.get('workspaceId') || '').trim();
    await requireWorkspacePermission(workspaceId, 'crm:edit');

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return { success: false, code: 'invalid_file', error: 'Arquivo obrigatório.' };
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return { success: false, code: 'invalid_file_size', error: 'O arquivo deve ter no máximo 10 MB.' };
    }

    const extension = ALLOWED_UPLOAD_TYPES[file.type.toLowerCase()];
    if (!extension) {
      return { success: false, code: 'invalid_file_type', error: 'Tipo de arquivo não permitido.' };
    }

    const key = `workspaces/${workspaceId}/crm-custom-fields/${randomUUID()}.${extension}`;
    await putPrivateObject({
      key,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
    });

    const url = `/api/storage/object?key=${encodeURIComponent(key)}`;
    return { success: true, url, fileName: file.name };
  } catch (error) {
    const access = toPublicAccessError(error);
    if (access) return { success: false, code: access.code, error: access.error };
    console.error('[PRIVATE_UPLOAD] Upload failed:', error instanceof Error ? error.message : error);
    return { success: false, code: 'dependency_unavailable', error: 'Falha ao armazenar o arquivo.' };
  }
}
