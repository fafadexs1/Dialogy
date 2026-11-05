import 'server-only';

import {
  fetchEvolutionAPI,
  type EvolutionApiClientConfig,
} from '@/lib/whatsapp/evolution-api-client';
import { readPrivateObject } from '@/lib/storage/private-s3';
import {
  assertStudioImageKey,
  normalizeStudioTemplates,
  STUDIO_IMAGE_LIMIT,
  type StudioTemplate,
} from '@/lib/whatsapp/studio';

function graphVersion() {
  return /^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION || '')
    ? process.env.META_GRAPH_API_VERSION!
    : 'v25.0';
}

/** Cloud credentials stay on the server. Evolution already owns the account token. */
export async function getStudioCloudAccount(
  config: EvolutionApiClientConfig,
  instanceName: string,
) {
  const result = await fetchEvolutionAPI(
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
    config,
    { method: 'GET', silent: true },
  );
  const instances = Array.isArray(result) ? result : [];
  const instance = instances.find(
    (item) =>
      item.name === instanceName && item.integration === 'WHATSAPP-BUSINESS',
  );
  if (!instance?.token || typeof instance.token !== 'string')
    throw new Error(
      'A conexão oficial não disponibilizou credenciais válidas. Reconecte a conta Meta.',
    );
  if (!/^\d+$/.test(instance.businessId || ''))
    throw new Error(
      'A conta oficial não informou o identificador da empresa WhatsApp. Reconecte a conta Meta.',
    );
  return {
    token: instance.token as string,
    businessId: String(instance.businessId),
    phoneNumberId: /^\d+$/.test(String(instance.number || '')) ? String(instance.number) : null,
  };
}

export async function getStudioCloudToken(
  config: EvolutionApiClientConfig,
  instanceName: string,
): Promise<string> {
  return (await getStudioCloudAccount(config, instanceName)).token;
}

/** Evolution's find endpoint drops Graph's pagination and otherwise returns only 25 templates. */
export async function listStudioMetaTemplates(
  config: EvolutionApiClientConfig,
  instanceName: string,
): Promise<StudioTemplate[]> {
  const account = await getStudioCloudAccount(config, instanceName);
  const templates: StudioTemplate[] = [];
  const cursors = new Set<string>();
  const deadline = Date.now() + 25_000;
  let after = '';
  do {
    const url = new URL(
      `https://graph.facebook.com/${graphVersion()}/${account.businessId}/message_templates`,
    );
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new Error(
        'A Meta demorou para listar todos os templates. Tente atualizar novamente.',
      );
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${account.token}` },
      signal: AbortSignal.timeout(remaining),
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok || payload?.error)
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'A permissão da conta Meta precisa ser renovada. Reconecte a conta oficial para consultar os templates.'
          : 'A Meta não disponibilizou a lista de templates. Tente atualizar novamente.',
      );
    templates.push(...normalizeStudioTemplates(payload));
    after =
      payload?.paging?.next &&
      typeof payload?.paging?.cursors?.after === 'string'
        ? payload.paging.cursors.after
        : '';
    if (after && cursors.has(after))
      throw new Error(
        'A Meta repetiu uma página de templates. Atualize a lista novamente.',
      );
    if (after) cursors.add(after);
  } while (after);
  return [
    ...new Map(
      templates.map((template) => [
        template.name + ':' + template.language,
        template,
      ]),
    ).values(),
  ];
}

export async function uploadStudioImageToMeta(
  key: string,
  workspaceId: string,
  token: string,
): Promise<string> {
  assertStudioImageKey(key, workspaceId);
  const bytes = await readPrivateObject(key, STUDIO_IMAGE_LIMIT);
  const version = graphVersion();
  const sessionUrl = new URL(
    `https://graph.facebook.com/${version}/app/uploads`,
  );
  sessionUrl.searchParams.set('file_length', String(bytes.length));
  sessionUrl.searchParams.set('file_type', 'image/jpeg');
  sessionUrl.searchParams.set('file_name', key.split('/').at(-1)!);
  const sessionResponse = await fetch(sessionUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  });
  const session = await sessionResponse.json();
  if (
    !sessionResponse.ok ||
    typeof session?.id !== 'string' ||
    !session.id.startsWith('upload:')
  )
    throw new Error(
      'Não foi possível preparar a foto na Meta. Verifique as permissões da conexão oficial e tente novamente.',
    );
  const upload = await fetch(
    `https://graph.facebook.com/${version}/${session.id}`,
    {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${token}`,
        file_offset: '0',
        'Content-Type': 'image/jpeg',
      },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    },
  );
  const result = await upload.json();
  if (!upload.ok || typeof result?.h !== 'string')
    throw new Error(
      'A Meta não confirmou o preparo da foto. Tente novamente antes de enviar o template.',
    );
  return result.h;
}
