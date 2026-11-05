'use server';

import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  requireWorkspaceAccess,
  requireWorkspacePermission,
  toPublicAccessError,
} from '@/lib/security/access';
import { consumeRateLimit } from '@/lib/ratelimit';
import {
  getWorkspaceBillingStatus,
  isBillingBlocked,
} from '@/lib/billing-logic';
import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';
import {
  createPrivateObjectDownloadUrl,
  putPrivateObject,
} from '@/lib/storage/private-s3';
import {
  getStudioCloudToken,
  listStudioMetaTemplates,
  uploadStudioImageToMeta,
} from '@/services/whatsapp/studio-media';
import { applyMetaTemplateEdits } from '@/lib/whatsapp/meta-template-edit';
import { requireProviderMessageId } from '@/services/whatsapp/template-send-contract';
import {
  assertStudioImageKey,
  buildStudioTemplate,
  getBodyVariables,
  previewBody,
  STUDIO_IMAGE_LIMIT,
  studioDraftSchema,
  studioImageUrl,
  validateStudioDraft,
  type StudioDraft,
  type StudioLibraryEntry,
} from '@/lib/whatsapp/studio';

const uuid = z.string().uuid();
function publicError(error: unknown) {
  if (error instanceof z.ZodError)
    return 'Revise os campos da mensagem antes de continuar.';
  const access = toPublicAccessError(error);
  if (access)
    return access.code === 'unauthenticated'
      ? 'Entre na sua conta novamente para continuar.'
      : 'Você não tem permissão para alterar esta integração.';
  if (error && typeof error === 'object' && 'code' in error)
    return 'A biblioteca de mensagens está indisponível. Verifique se a atualização do banco foi aplicada.';
  // Provider responses can contain account details; never return raw upstream bodies.
  if (
    error instanceof Error &&
    /Evolution API Error|fetch failed|ECONN|timeout|AbortError/i.test(
      error.message,
    )
  )
    return 'O WhatsApp não confirmou a operação. Atualize o status antes de tentar novamente.';
  if (
    error instanceof Error &&
    /storage configuration|Input buffer|pixel limit|unsupported image/i.test(
      error.message,
    )
  )
    return 'Não foi possível armazenar esta foto. Tente outra imagem JPG ou PNG; se continuar, verifique o armazenamento com o administrador.';
  return error instanceof Error
    ? error.message
    : 'Não foi possível concluir a operação.';
}
async function authorize(workspaceId: string, write = true) {
  uuid.parse(workspaceId);
  return write
    ? requireWorkspacePermission(workspaceId, 'workspace:settings:edit')
    : requireWorkspaceAccess(workspaceId);
}
async function target(workspaceId: string, instanceId: string) {
  uuid.parse(instanceId);
  const { rows } = await db.query(
    'SELECT i.id, i.instance_name, i.type, c.api_url, c.api_key FROM evolution_api_instances i LEFT JOIN whatsapp_clusters c ON c.id = i.cluster_id WHERE i.id = $1 AND i.workspace_id = $2',
    [instanceId, workspaceId],
  );
  const instance = rows[0];
  if (!instance || !['baileys', 'wa_cloud'].includes(instance.type))
    throw new Error('Escolha uma conexão WhatsApp deste workspace.');
  if (!instance.api_url || !instance.api_key)
    throw new Error('A configuração desta conexão está indisponível.');
  return {
    id: instance.id,
    instance_name: instance.instance_name,
    type: instance.type as 'baileys' | 'wa_cloud',
    config: {
      api_url: String(instance.api_url),
      api_key: String(instance.api_key),
    },
  };
}
function checkImages(draft: StudioDraft, workspaceId: string) {
  for (const key of [
    draft.headerImageKey,
    ...draft.cards.map((card) => card.imageKey),
  ].filter(Boolean))
    assertStudioImageKey(key, workspaceId);
}
function publicationFingerprint(draft: StudioDraft) {
  const content = {
    ...draft,
    title: undefined,
    examples: undefined,
    variableLabels: undefined,
    authenticationCode: undefined,
  };
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
const entryFields =
  'id, instance_id, title, draft, revision, provider_name, published_fingerprint, updated_at';
function mapEntry(row: Record<string, unknown>): StudioLibraryEntry {
  const draft = studioDraftSchema.parse(row.draft);
  return {
    id: String(row.id),
    instance_id: row.instance_id ? String(row.instance_id) : null,
    title: String(row.title),
    draft,
    revision: Number(row.revision),
    provider_name: row.provider_name ? String(row.provider_name) : null,
    publication_matches: Boolean(
      row.published_fingerprint &&
      row.published_fingerprint === publicationFingerprint(draft),
    ),
    updated_at: new Date(row.updated_at as string).toISOString(),
  };
}

export async function getWhatsappStudioLibrary(workspaceId: string) {
  try {
    await authorize(workspaceId, false);
    const { rows } = await db.query(
      `SELECT ${entryFields} FROM whatsapp_message_library WHERE workspace_id = $1 ORDER BY updated_at DESC LIMIT 200`,
      [workspaceId],
    );
    return { success: true as const, entries: rows.map(mapEntry) };
  } catch (error) {
    return {
      success: false as const,
      error: publicError(error),
      entries: [] as StudioLibraryEntry[],
    };
  }
}

export async function saveWhatsappStudioDraft(input: {
  workspaceId: string;
  instanceId: string;
  draft: unknown;
  id?: string;
  revision?: number;
}) {
  try {
    const user = await authorize(input.workspaceId);
    if (!consumeRateLimit(`studio-save:${user.id}`, 60, 60_000).ok)
      throw new Error('Aguarde um instante antes de salvar novamente.');
    const draft = studioDraftSchema.parse(input.draft);
    if (!draft.title.trim()) throw new Error('Dê um nome para esta criação.');
    checkImages(draft, input.workspaceId);
    await target(input.workspaceId, input.instanceId);
    if (input.id) {
      uuid.parse(input.id);
      const { rows } = await db.query(
        `UPDATE whatsapp_message_library SET provider_name=CASE WHEN instance_id IS DISTINCT FROM $3::uuid THEN NULL ELSE provider_name END, published_fingerprint=CASE WHEN instance_id IS DISTINCT FROM $3::uuid THEN NULL ELSE published_fingerprint END, instance_id=$3, title=$4, draft=$5::jsonb, revision=revision+1, updated_at=now() WHERE id=$1 AND workspace_id=$2 AND revision=$6 RETURNING ${entryFields}`,
        [
          input.id,
          input.workspaceId,
          input.instanceId,
          draft.title.trim(),
          JSON.stringify(draft),
          input.revision,
        ],
      );
      if (!rows[0])
        throw new Error(
          'Esta criação foi alterada em outra sessão. Volte à biblioteca e abra a versão mais recente antes de editar.',
        );
      return { success: true as const, entry: mapEntry(rows[0]) };
    }
    const { rows } = await db.query(
      `INSERT INTO whatsapp_message_library(workspace_id, instance_id, title, draft, created_by) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING ${entryFields}`,
      [
        input.workspaceId,
        input.instanceId,
        draft.title.trim(),
        JSON.stringify(draft),
        user.id,
      ],
    );
    return { success: true as const, entry: mapEntry(rows[0]) };
  } catch (error) {
    return { success: false as const, error: publicError(error) };
  }
}

export async function deleteWhatsappStudioDraft(
  workspaceId: string,
  id: string,
  revision: number,
) {
  try {
    await authorize(workspaceId);
    uuid.parse(id);
    const result = await db.query(
      'DELETE FROM whatsapp_message_library WHERE id=$1 AND workspace_id=$2 AND revision=$3',
      [id, workspaceId, revision],
    );
    if (!result.rowCount)
      throw new Error(
        'Esta criação mudou. Atualize a biblioteca antes de excluir.',
      );
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: publicError(error) };
  }
}

export async function uploadWhatsappStudioImage(
  workspaceId: string,
  form: FormData,
) {
  try {
    const user = await authorize(workspaceId);
    if (!consumeRateLimit(`studio-image:${user.id}`, 30, 60_000).ok)
      throw new Error('Você enviou muitas fotos. Aguarde um minuto.');
    const file = form.get('file');
    if (
      !(file instanceof File) ||
      !['image/jpeg', 'image/png'].includes(file.type) ||
      file.size < 1 ||
      file.size > STUDIO_IMAGE_LIMIT
    )
      throw new Error('Escolha uma foto JPG ou PNG de até 5 MB.');
    const bytes = Buffer.from(await file.arrayBuffer());
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!isJpeg && !isPng)
      throw new Error(
        'O conteúdo do arquivo não corresponde a uma imagem JPG ou PNG.',
      );
    const body = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88 })
      .toBuffer();
    const key = `workspaces/${workspaceId}/whatsapp-studio/${randomUUID()}.jpg`;
    await putPrivateObject({ key, body, contentType: 'image/jpeg' });
    return { success: true as const, key, url: studioImageUrl(key) };
  } catch (error) {
    return { success: false as const, error: publicError(error) };
  }
}

export async function getWhatsappStudioTemplates(
  workspaceId: string,
  instanceId: string,
) {
  try {
    await authorize(workspaceId, false);
    const instance = await target(workspaceId, instanceId);
    if (instance.type !== 'wa_cloud')
      return { success: true as const, templates: [] };
    const templates = await listStudioMetaTemplates(
      instance.config,
      instance.instance_name,
    );
    return { success: true as const, templates };
  } catch (error) {
    return {
      success: false as const,
      templates: [],
      error: publicError(error),
    };
  }
}

export async function editWhatsappMetaTemplate(input: { workspaceId: string; instanceId: string; templateId: string; originalComponents: string; originalStatus: string; updates: Record<string, string> }) {
  try {
    const user = await authorize(input.workspaceId);
    if (!consumeRateLimit(`studio-edit:${user.id}`, 10, 60_000).ok) throw new Error('Aguarde um minuto antes de tentar novamente.');
    const parsed = z.object({ instanceId: uuid, templateId: z.string().regex(/^\d+$/).max(40), originalComponents: z.string().max(100000), originalStatus: z.string().max(50), updates: z.record(z.string().max(100), z.string().max(2000)) }).parse(input);
    const instance = await target(input.workspaceId, parsed.instanceId);
    if (instance.type !== 'wa_cloud') throw new Error('Escolha uma conexão oficial para editar o template.');
    const templates = await listStudioMetaTemplates(instance.config, instance.instance_name);
    const template = templates.find(item => item.id === parsed.templateId);
    if (!template) throw new Error('Este template não está disponível nesta conta. Atualize a biblioteca.');
    if (template.status !== parsed.originalStatus || JSON.stringify(template.components) !== parsed.originalComponents) throw new Error('O template mudou na Meta. Atualize a biblioteca antes de editar.');
    const components = applyMetaTemplateEdits(template, parsed.updates);
    const response = await fetchEvolutionAPI(`/template/edit/${encodeURIComponent(instance.instance_name)}`, instance.config, { method: 'POST', body: JSON.stringify({templateId: template.id, components}), silent: true });
    if (response?.success !== true) throw new Error('A Meta não confirmou a edição. Atualize a biblioteca antes de tentar novamente.');
    try {
      await db.query("UPDATE whatsapp_message_library SET published_fingerprint=NULL WHERE workspace_id=$1 AND instance_id=$2 AND provider_name=$3 AND draft->>'language'=$4", [input.workspaceId, instance.id, template.name, template.language]);
    } catch (error) { console.error('[WHATSAPP_STUDIO] Meta edit confirmed; local synchronization failed', error); }
    return { success: true as const };
  } catch (error) { return { success: false as const, error: publicError(error) }; }
}

export async function publishWhatsappStudioTemplate(
  workspaceId: string,
  entryId: string,
  revision: number,
) {
  try {
    const user = await authorize(workspaceId);
    uuid.parse(entryId);
    if (!consumeRateLimit(`studio-publish:${user.id}`, 10, 60_000).ok)
      throw new Error(
        'Aguarde um minuto antes de enviar outro template para aprovação.',
      );
    const { rows } = await db.query(
      'SELECT * FROM whatsapp_message_library WHERE workspace_id=$1 AND id=$2 AND revision=$3',
      [workspaceId, entryId, revision],
    );
    if (!rows[0])
      throw new Error('Salve a versão atual antes de enviar para aprovação.');
    const entry = rows[0];
    const draft = studioDraftSchema.parse(entry.draft);
    const instance = await target(workspaceId, entry.instance_id);
    if (instance.type !== 'wa_cloud')
      throw new Error(
        'A aprovação de templates está disponível na conexão oficial. Na conexão QR Code, salve a mensagem na biblioteca.',
      );
    const errors = validateStudioDraft(draft, true);
    if (errors.length) throw new Error(errors[0]);
    checkImages(draft, workspaceId);
    const existing = await listStudioMetaTemplates(
      instance.config,
      instance.instance_name,
    );
    if (
      existing.some(
        (item) =>
          item.name === draft.templateName && item.language === draft.language,
      )
    )
      throw new Error(
        'Já existe um template com este nome de registro. Crie uma cópia com outro nome para enviar uma nova versão.',
      );
    const handles: Record<string, string> = {};
    const keys = [
      ...new Set(
        (draft.kind === 'carousel'
          ? draft.cards.map((card) => card.imageKey)
          : [draft.headerImageKey]
        ).filter(Boolean),
      ),
    ];
    if (keys.length) {
      const token = await getStudioCloudToken(
        instance.config,
        instance.instance_name,
      );
      // Sequential uploads avoid exhausting the Meta account's upload limits.
      for (const key of keys)
        handles[key] = await uploadStudioImageToMeta(key, workspaceId, token);
    }
    const payload = buildStudioTemplate(draft, handles);
    const created = await fetchEvolutionAPI(
      `/template/create/${encodeURIComponent(instance.instance_name)}`,
      instance.config,
      { method: 'POST', body: JSON.stringify(payload), silent: true },
    );
    if (!created?.id || created?.error)
      throw new Error(
        'A Meta não confirmou o recebimento do template. Atualize a lista antes de tentar novamente.',
      );
    await db.query(
      'UPDATE whatsapp_message_library SET provider_name=$3, published_fingerprint=$4 WHERE workspace_id=$1 AND id=$2 AND revision=$5',
      [
        workspaceId,
        entryId,
        draft.templateName,
        publicationFingerprint(draft),
        revision,
      ],
    );
    return { success: true as const, name: draft.templateName };
  } catch (error) {
    return { success: false as const, error: publicError(error) };
  }
}

export async function sendWhatsappStudioTest(input: {
  workspaceId: string;
  entryId: string;
  revision: number;
  requestId: string;
  recipient: string;
}) {
  let reserved = false;
  let calledProvider = false;
  try {
    const user = await authorize(input.workspaceId);
    uuid.parse(input.entryId);
    uuid.parse(input.requestId);
    const recipient = input.recipient.replace(/[\s()+-]/g, '');
    if (!/^[1-9]\d{7,14}$/.test(recipient))
      throw new Error(
        'Informe um telefone válido com código do país, como +55 11 99999-9999.',
      );
    const { rows } = await db.query(
      'SELECT * FROM whatsapp_message_library WHERE workspace_id=$1 AND id=$2 AND revision=$3',
      [input.workspaceId, input.entryId, input.revision],
    );
    if (!rows[0])
      throw new Error('Salve a versão atual antes de enviar um teste.');
    const entry = rows[0];
    const draft = studioDraftSchema.parse(entry.draft);
    const instance = await target(input.workspaceId, entry.instance_id);
    const official = instance.type === 'wa_cloud';
    const errors = validateStudioDraft(draft, official);
    if (errors.length) throw new Error(errors[0]);
    checkImages(draft, input.workspaceId);
    if (isBillingBlocked(await getWorkspaceBillingStatus(input.workspaceId)))
      throw new Error(
        'Regularize a assinatura do workspace para enviar mensagens.',
      );
    if (official) {
      if (
        !entry.provider_name ||
        entry.published_fingerprint !== publicationFingerprint(draft)
      )
        throw new Error(
          'Esta versão ainda não foi enviada para aprovação. Envie o template e aguarde a aprovação da Meta.',
        );
      const templates = await listStudioMetaTemplates(
        instance.config,
        instance.instance_name,
      );
      if (
        !templates.some(
          (item) =>
            item.name === entry.provider_name &&
            item.language === draft.language &&
            item.status === 'APPROVED',
        )
      )
        throw new Error(
          'O template precisa estar aprovado e ativo na Meta antes de enviar um teste.',
        );
    }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          entryId: entry.id,
          revision: entry.revision,
          instanceId: instance.id,
          recipient,
        }),
      )
      .digest('hex');
    const reservation = await db.query(
      "INSERT INTO whatsapp_studio_sends(id,workspace_id,instance_id,fingerprint,status) VALUES($1,$2,$3,$4,'pending') ON CONFLICT (id) DO NOTHING RETURNING id",
      [input.requestId, input.workspaceId, instance.id, fingerprint],
    );
    if (!reservation.rowCount) {
      const previous = await db.query(
        'SELECT status,fingerprint FROM whatsapp_studio_sends WHERE id=$1 AND workspace_id=$2',
        [input.requestId, input.workspaceId],
      );
      if (previous.rows[0]?.fingerprint !== fingerprint)
        throw new Error(
          'Esta tentativa já foi usada. Abra um novo teste para alterar o destinatário ou a mensagem.',
        );
      if (previous.rows[0]?.status === 'sent')
        return { success: true as const };
      throw new Error(
        'Esta tentativa já foi processada. Verifique o WhatsApp do destinatário antes de iniciar outro teste.',
      );
    }
    reserved = true;
    if (!consumeRateLimit(`studio-send:${user.id}`, 5, 60_000).ok)
      throw new Error('Você atingiu o limite de testes. Aguarde um minuto.');
    const signedImage = async (key: string) => {
      assertStudioImageKey(key, input.workspaceId);
      return createPrivateObjectDownloadUrl(key, 900);
    };
    let endpoint: string;
    let payload: Record<string, unknown>;
    if (official) {
      const components: Record<string, unknown>[] = [];
      const bodyVariables =
        draft.category === 'AUTHENTICATION'
          ? [1]
          : getBodyVariables(draft.body);
      if (bodyVariables.length)
        components.push({
          type: 'body',
          parameters: bodyVariables.map((position) => ({
            type: 'text',
            text:
              draft.category === 'AUTHENTICATION'
                ? draft.authenticationCode
                : draft.examples[String(position)],
          })),
        });
      if (draft.category === 'AUTHENTICATION')
        components.push({
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: draft.authenticationCode }],
        });
      else if (draft.kind === 'carousel')
        components.push({
          type: 'carousel',
          cards: await Promise.all(
            draft.cards.map(async (card, index) => ({
              card_index: index,
              components: [
                {
                  type: 'header',
                  parameters: [
                    {
                      type: 'image',
                      image: { link: await signedImage(card.imageKey) },
                    },
                  ],
                },
              ],
            })),
          ),
        });
      else if (draft.headerImageKey)
        components.push({
          type: 'header',
          parameters: [
            {
              type: 'image',
              image: { link: await signedImage(draft.headerImageKey) },
            },
          ],
        });
      endpoint = 'sendTemplate';
      payload = {
        number: recipient,
        name: entry.provider_name,
        language: draft.language,
        components,
      };
    } else if (draft.kind === 'carousel') {
      endpoint = 'sendCarousel';
      payload = {
        number: recipient,
        body: previewBody(draft),
        cards: await Promise.all(
          draft.cards.map(async (card) => ({
            title: card.title,
            body: `*${card.title}*\n\n${card.body}`,
            imageUrl: await signedImage(card.imageKey),
            buttons: card.buttons.map((button) =>
              button.type === 'reply'
                ? { type: 'reply', displayText: button.text, id: button.id }
                : button.type === 'url'
                  ? { type: 'url', displayText: button.text, url: button.value }
                  : {
                      type: 'call',
                      displayText: button.text,
                      phoneNumber: button.value,
                    },
            ),
          })),
        ),
      };
    } else if (draft.buttons.length) {
      endpoint = 'sendButtons';
      payload = {
        number: recipient,
        title: draft.header || draft.title,
        description: previewBody(draft),
        footer: draft.footer || undefined,
        thumbnailUrl: draft.headerImageKey
          ? await signedImage(draft.headerImageKey)
          : undefined,
        buttons: draft.buttons.map((button) =>
          button.type === 'reply'
            ? { type: 'reply', displayText: button.text, id: button.id }
            : button.type === 'url'
              ? { type: 'url', displayText: button.text, url: button.value }
              : {
                  type: 'call',
                  displayText: button.text,
                  phoneNumber: button.value,
                },
        ),
      };
    } else if (draft.headerImageKey) {
      endpoint = 'sendMedia';
      payload = {
        number: recipient,
        mediatype: 'image',
        mimetype: 'image/jpeg',
        media: await signedImage(draft.headerImageKey),
        caption: [draft.header, previewBody(draft), draft.footer]
          .filter(Boolean)
          .join('\n\n'),
      };
    } else {
      endpoint = 'sendText';
      payload = {
        number: recipient,
        text: [draft.header, previewBody(draft), draft.footer]
          .filter(Boolean)
          .join('\n\n'),
      };
    }
    calledProvider = true;
    const response = await fetchEvolutionAPI(
      `/message/${endpoint}/${encodeURIComponent(instance.instance_name)}`,
      instance.config,
      { method: 'POST', body: JSON.stringify(payload), silent: true },
    );
    const messageId = requireProviderMessageId(response);
    await db.query(
      "UPDATE whatsapp_studio_sends SET status='sent', provider_message_id=$3 WHERE id=$1 AND workspace_id=$2",
      [input.requestId, input.workspaceId, messageId],
    );
    return { success: true as const };
  } catch (error) {
    if (reserved)
      await db
        .query(
          'UPDATE whatsapp_studio_sends SET status=$3 WHERE id=$1 AND workspace_id=$2',
          [
            input.requestId,
            input.workspaceId,
            calledProvider ? 'unknown' : 'failed',
          ],
        )
        .catch(() => undefined);
    return {
      success: false as const,
      error: calledProvider
        ? 'O provedor não confirmou o teste. Confira o WhatsApp do destinatário antes de enviar novamente.'
        : publicError(error),
    };
  }
}
