import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { putPrivateObject, readPrivateObject, createPrivateObjectDownloadUrl, deletePrivateObject } from '@/lib/storage/private-s3';
import { WorkflowFileReferenceSchema, type WorkflowFileReference } from '@/services/workflow-runtime/file-reference';

const MAX_BYTES = 10_000_000;
export async function saveWorkflowFile(input: { workspaceId: string; name: string; mimeType: string; data: Buffer }): Promise<WorkflowFileReference> {
  if (input.data.length > MAX_BYTES) throw new Error('Arquivo excede 10 MB.');
  const file = WorkflowFileReferenceSchema.parse({ kind: 'workflow_file', id: randomUUID(), name: input.name.replace(/[\\/\r\n\u0000-\u001f]/g, '_').slice(0, 255) || 'arquivo', mimeType: input.mimeType.split(';')[0]!.slice(0, 150), size: input.data.length });
  const key = `workspaces/${input.workspaceId}/workflow-files/${file.id}`;
  await putPrivateObject({ key, body: input.data, contentType: file.mimeType });
  try { await db.query(`INSERT INTO nexus_workflow_files (id,workspace_id,object_key,name,mime_type,byte_size) VALUES ($1,$2,$3,$4,$5,$6)`, [file.id, input.workspaceId, key, file.name, file.mimeType, file.size]); }
  catch (error) { await deletePrivateObject(key).catch(() => undefined); throw error; }
  return file;
}

async function lookup(workspaceId: string, value: unknown) {
  const ref = WorkflowFileReferenceSchema.parse(value);
  const { rows } = await db.query(`SELECT object_key,name,mime_type,byte_size FROM nexus_workflow_files WHERE workspace_id=$1 AND id=$2 AND expires_at>clock_timestamp()`, [workspaceId, ref.id]);
  if (!rows[0]) throw new Error('Arquivo expirado ou indisponível neste workspace.');
  const row = rows[0];
  return { key: String(row.object_key), file: WorkflowFileReferenceSchema.parse({ kind: 'workflow_file', id: ref.id, name: row.name, mimeType: row.mime_type, size: Number(row.byte_size) }) };
}
export async function loadWorkflowFile(workspaceId: string, value: unknown) {
  const { key, file } = await lookup(workspaceId, value);
  return { file, data: await readPrivateObject(key, MAX_BYTES) };
}
export async function workflowFileDownload(workspaceId: string, value: unknown) {
  const { key, file } = await lookup(workspaceId, value);
  return { file, url: await createPrivateObjectDownloadUrl(key) };
}
export async function purgeExpiredWorkflowFiles() {
  const { rows } = await db.query(`SELECT id,workspace_id,object_key FROM nexus_workflow_files WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 50`);
  for (const row of rows) {
    await deletePrivateObject(String(row.object_key));
    await db.query(`DELETE FROM nexus_workflow_files WHERE workspace_id=$1 AND id=$2 AND expires_at<=clock_timestamp()`, [row.workspace_id, row.id]);
  }
}
