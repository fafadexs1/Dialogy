// Read-only by default. --media also checks an unpublished sample upload and removes its private storage object.
// node --conditions=react-server --import tsx scripts/check-whatsapp-studio.ts [--media]
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import {
  getStudioCloudToken,
  listStudioMetaTemplates,
  uploadStudioImageToMeta,
} from '../src/services/whatsapp/studio-media';

async function main() {
  const schema = await db.query(
    "SELECT relname, relrowsecurity FROM pg_class WHERE oid IN (to_regclass('public.whatsapp_message_library'), to_regclass('public.whatsapp_studio_sends'))",
  );
  console.log('Studio schema:', JSON.stringify(schema.rows));
  const { rows } = await db.query(
    "SELECT i.workspace_id, i.display_name, i.instance_name, c.api_url, c.api_key FROM evolution_api_instances i JOIN whatsapp_clusters c ON c.id=i.cluster_id WHERE i.type='wa_cloud' ORDER BY i.created_at",
  );
  for (const instance of rows) {
    try {
      const templates = await listStudioMetaTemplates(
        { api_url: instance.api_url, api_key: instance.api_key },
        instance.instance_name,
      );
      console.log(
        JSON.stringify({
          connection: instance.display_name,
          templates: templates.length,
          approved: templates.filter(
            (template) => template.status === 'APPROVED',
          ).length,
          rejected: templates.filter(
            (template) => template.status === 'REJECTED',
          ).length,
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          connection: instance.display_name,
          available: false,
          error: error instanceof Error ? error.message : 'Unavailable',
        }),
      );
      process.exitCode = 1;
    }
  }
  if (process.argv.includes('--media') && rows[0]) {
    const instance = rows[0];
    const config = { api_url: instance.api_url, api_key: instance.api_key };
    const { default: sharp } = await import('sharp');
    const {
      putPrivateObject,
      readPrivateObject,
      createPrivateObjectDownloadUrl,
      deletePrivateObject,
    } = await import('../src/lib/storage/private-s3');
    const key = `workspaces/${instance.workspace_id}/whatsapp-studio/${randomUUID()}.jpg`;
    const bytes = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#bdd0ba' },
    })
      .jpeg()
      .toBuffer();
    try {
      await putPrivateObject({ key, body: bytes, contentType: 'image/jpeg' });
      const restored = await readPrivateObject(key, 5 * 1024 * 1024);
      if (!bytes.equals(restored))
        throw new Error('Private image round-trip failed.');
      const download = await fetch(
        await createPrivateObjectDownloadUrl(key, 60),
        { signal: AbortSignal.timeout(15_000) },
      );
      if (
        !download.ok ||
        !bytes.equals(Buffer.from(await download.arrayBuffer()))
      )
        throw new Error('Private image download failed.');
      const token = await getStudioCloudToken(config, instance.instance_name);
      const handle = await uploadStudioImageToMeta(
        key,
        instance.workspace_id,
        token,
      );
      console.log(
        JSON.stringify({
          privateImageStoredAndRead: true,
          privateImageDownloaded: true,
          metaSampleUploadAccepted: Boolean(handle),
          templatePublished: false,
          messageSent: false,
        }),
      );
    } finally {
      await deletePrivateObject(key);
      console.log('Temporary verification image removed from private storage.');
    }
  }
}
main()
  .catch(() => {
    console.error('Studio verification failed.');
    process.exitCode = 1;
  })
  .finally(() => db.end());
