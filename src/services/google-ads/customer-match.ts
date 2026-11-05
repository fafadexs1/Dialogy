import { db } from '@/lib/db';
import { buildSegmentAudienceQuery, type CriteriaGroup } from '@/lib/crm-query-builder';

import { googleAdsPost, loadWorkspaceGoogleAdsContext, GoogleAdsApiError } from './api-client';
import { buildUserIdentifiers } from './identifiers';

/** Limite da API por chamada de addOperations. */
const OPERATIONS_PER_REQUEST = 10000;

/** Duracao maxima de associacao permitida pelo Google (dias). */
const MEMBERSHIP_LIFE_SPAN_DAYS = 540;

export type CustomerMatchSyncResult = {
  userListResourceName: string;
  userListName: string;
  uploadedCount: number;
  skippedCount: number;
};

type SegmentRow = { workspace_id: string; name: string; criteria: CriteriaGroup };

async function loadSegment(workspaceId: string, segmentId: string): Promise<SegmentRow> {
  const result = await db.query(
    `SELECT workspace_id, name, criteria FROM crm_segments WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
    [segmentId, workspaceId]
  );

  const segment = result.rows[0];
  if (!segment) throw new GoogleAdsApiError('Lista do CRM nao encontrada.', 404);
  return segment as SegmentRow;
}

async function findStoredUserList(workspaceId: string, segmentId: string, customerId: string) {
  const result = await db.query(
    `
    SELECT user_list_resource_name, user_list_name
    FROM google_ads_user_lists
    WHERE workspace_id = $1 AND segment_id = $2 AND customer_id = $3
    LIMIT 1
    `,
    [workspaceId, segmentId, customerId]
  );
  return result.rows[0] || null;
}

/**
 * Cria a lista no Google Ads na primeira sincronizacao e reaproveita depois.
 * Criar lista nova a cada envio zeraria o aprendizado das campanhas.
 */
async function ensureUserList(params: {
  workspaceId: string;
  segmentId: string;
  segmentName: string;
  customerId: string;
  loginCustomerId: string | null;
  credentials: Awaited<ReturnType<typeof loadWorkspaceGoogleAdsContext>>['credentials'];
}): Promise<{ resourceName: string; name: string }> {
  const stored = await findStoredUserList(params.workspaceId, params.segmentId, params.customerId);
  if (stored) {
    return { resourceName: stored.user_list_resource_name, name: stored.user_list_name };
  }

  const userListName = `Dialogy · ${params.segmentName}`.slice(0, 120);
  const payload = await googleAdsPost({
    credentials: params.credentials,
    loginCustomerId: params.loginCustomerId,
    path: `customers/${params.customerId}/userLists:mutate`,
    body: {
      operations: [
        {
          create: {
            name: userListName,
            description: 'Lista sincronizada automaticamente pelo Dialogy.',
            membershipLifeSpan: MEMBERSHIP_LIFE_SPAN_DAYS,
            crmBasedUserList: {
              uploadKeyType: 'CONTACT_INFO',
              dataSourceType: 'FIRST_PARTY',
            },
          },
        },
      ],
    },
  });

  const resourceName = payload?.results?.[0]?.resourceName;
  if (!resourceName) {
    throw new GoogleAdsApiError('Google Ads nao devolveu a lista criada.', 502);
  }

  await db.query(
    `
    INSERT INTO google_ads_user_lists (
      workspace_id, segment_id, customer_id, user_list_resource_name, user_list_name
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (workspace_id, segment_id, customer_id)
    DO UPDATE SET user_list_resource_name = EXCLUDED.user_list_resource_name,
                  user_list_name = EXCLUDED.user_list_name,
                  updated_at = timezone('utc', now())
    `,
    [params.workspaceId, params.segmentId, params.customerId, resourceName, userListName]
  );

  return { resourceName, name: userListName };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Sincroniza um segmento do CRM com uma lista de Customer Match. Os dados saem
 * daqui apenas com hash SHA-256 — e-mail e telefone em texto puro nunca chegam
 * ao Google.
 */
export async function syncSegmentToCustomerMatch(params: {
  workspaceId: string;
  segmentId: string;
}): Promise<CustomerMatchSyncResult> {
  const segment = await loadSegment(params.workspaceId, params.segmentId);
  const context = await loadWorkspaceGoogleAdsContext(params.workspaceId);

  if (!context.customerId) {
    throw new GoogleAdsApiError('Selecione a conta do Google Ads antes de sincronizar publicos.', 400);
  }

  const audienceQuery = buildSegmentAudienceQuery(segment.workspace_id, segment.criteria);
  const contactsRes = await db.query(audienceQuery.text, audienceQuery.values);

  const operations = contactsRes.rows.flatMap((contact) => {
    const identifiers = buildUserIdentifiers({
      email: contact.email,
      phone: contact.phone_canonical || contact.phone || contact.phone_number_jid,
    });
    return identifiers.length > 0 ? [{ create: { userIdentifiers: identifiers } }] : [];
  });

  if (operations.length === 0) {
    throw new GoogleAdsApiError(
      'Esta lista nao possui contatos com e-mail ou telefone validos para o Google Ads.',
      422
    );
  }

  const userList = await ensureUserList({
    workspaceId: params.workspaceId,
    segmentId: params.segmentId,
    segmentName: segment.name,
    customerId: context.customerId,
    loginCustomerId: context.loginCustomerId,
    credentials: context.credentials,
  });

  try {
    const jobPayload = await googleAdsPost({
      credentials: context.credentials,
      loginCustomerId: context.loginCustomerId,
      path: `customers/${context.customerId}/offlineUserDataJobs:create`,
      body: {
        job: {
          type: 'CUSTOMER_MATCH_USER_LIST',
          customerMatchUserListMetadata: { userList: userList.resourceName },
        },
      },
    });

    const jobResourceName = jobPayload?.resourceName;
    if (!jobResourceName) {
      throw new GoogleAdsApiError('Google Ads nao devolveu o job de upload.', 502);
    }

    for (const batch of chunk(operations, OPERATIONS_PER_REQUEST)) {
      await googleAdsPost({
        credentials: context.credentials,
        loginCustomerId: context.loginCustomerId,
        path: `${jobResourceName}:addOperations`,
        body: { operations: batch, enablePartialFailure: true },
      });
    }

    // O job roda em segundo plano no Google; a chamada apenas o inicia.
    await googleAdsPost({
      credentials: context.credentials,
      loginCustomerId: context.loginCustomerId,
      path: `${jobResourceName}:run`,
      body: {},
    });

    const skippedCount = contactsRes.rows.length - operations.length;

    await db.query(
      `
      UPDATE google_ads_user_lists
      SET last_synced_at = timezone('utc', now()),
          last_uploaded_count = $4,
          last_skipped_count = $5,
          last_error = NULL,
          updated_at = timezone('utc', now())
      WHERE workspace_id = $1 AND segment_id = $2 AND customer_id = $3
      `,
      [params.workspaceId, params.segmentId, context.customerId, operations.length, skippedCount]
    );

    return {
      userListResourceName: userList.resourceName,
      userListName: userList.name,
      uploadedCount: operations.length,
      skippedCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.query(
      `
      UPDATE google_ads_user_lists
      SET last_error = $4, updated_at = timezone('utc', now())
      WHERE workspace_id = $1 AND segment_id = $2 AND customer_id = $3
      `,
      [params.workspaceId, params.segmentId, context.customerId, message.slice(0, 1000)]
    );
    throw error;
  }
}

export type CustomerMatchStatus = {
  userListName: string;
  lastSyncedAt: string | null;
  lastUploadedCount: number;
  lastSkippedCount: number;
  lastError: string | null;
};

export async function getCustomerMatchStatus(
  workspaceId: string,
  segmentId: string
): Promise<CustomerMatchStatus | null> {
  const result = await db.query(
    `
    SELECT user_list_name, last_synced_at, last_uploaded_count, last_skipped_count, last_error
    FROM google_ads_user_lists
    WHERE workspace_id = $1 AND segment_id = $2
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [workspaceId, segmentId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    userListName: row.user_list_name,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
    lastUploadedCount: Number(row.last_uploaded_count || 0),
    lastSkippedCount: Number(row.last_skipped_count || 0),
    lastError: row.last_error,
  };
}
