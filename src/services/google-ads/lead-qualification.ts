import { db } from '@/lib/db';
import { PIPELINE_STAGE_CATEGORY } from '@/lib/crm-pipeline';
import { LEAD_QUALIFIED_EVENT } from '@/lib/marketing-attribution';

import { enqueueContactConversionExport, type EnqueueResult } from './conversion-queue';

/** Estagios que significam perda nunca contam como lead qualificado. */
const LOST_STAGE_VALUES = new Set(['perdido', 'perdida', 'lost']);

/**
 * Um lead vira "qualificado" quando avanca do primeiro estagio do funil para
 * qualquer estagio seguinte que nao seja de perda. A unicidade por evento na
 * fila garante que isso valha uma unica vez por atribuicao, entao nao e preciso
 * comparar o estagio anterior.
 */
export async function maybeEnqueueLeadQualified(params: {
  workspaceId: string;
  contactId: string;
}): Promise<EnqueueResult> {
  if (!params.workspaceId || !params.contactId) {
    return { enqueued: false, reason: 'parametros_incompletos' };
  }

  const stageRes = await db.query(
    `
    WITH pipeline AS (
      SELECT id, value, is_close_reason, COALESCE(sort_order, 2147483647) AS sort_order
      FROM tags
      WHERE workspace_id = $1
        AND category = $3
    )
    SELECT
      current_stage.value,
      current_stage.is_close_reason,
      current_stage.sort_order,
      (SELECT MIN(sort_order) FROM pipeline) AS first_sort_order
    FROM contact_tags ct
    JOIN pipeline current_stage ON current_stage.id = ct.tag_id
    WHERE ct.contact_id = $2::uuid
    ORDER BY current_stage.sort_order DESC
    LIMIT 1
    `,
    [params.workspaceId, params.contactId, PIPELINE_STAGE_CATEGORY]
  );

  const stage = stageRes.rows[0];
  if (!stage) return { enqueued: false, reason: 'sem_estagio_de_funil' };

  if (stage.is_close_reason || LOST_STAGE_VALUES.has(String(stage.value || '').toLowerCase())) {
    return { enqueued: false, reason: 'estagio_de_perda' };
  }

  if (Number(stage.sort_order) <= Number(stage.first_sort_order)) {
    return { enqueued: false, reason: 'ainda_no_primeiro_estagio' };
  }

  return enqueueContactConversionExport({
    workspaceId: params.workspaceId,
    contactId: params.contactId,
    eventName: LEAD_QUALIFIED_EVENT,
  });
}
