import { db } from '@/lib/db';

export type CausalPatternReviewDecision = 'approve' | 'dismiss' | 'mark_applied';

export type ReviewedCausalPattern = {
  id: string;
  status: 'approved' | 'dismissed' | 'applied';
  reviewedAt: string | null;
  appliedAt: string | null;
};

function statusForDecision(decision: CausalPatternReviewDecision): ReviewedCausalPattern['status'] {
  if (decision === 'approve') return 'approved';
  if (decision === 'dismiss') return 'dismissed';
  return 'applied';
}

function shouldSuppressReviewError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('agent_causal_patterns');
}

export async function reviewCausalPattern(input: {
  workspaceId: string;
  patternId: string;
  decision: CausalPatternReviewDecision;
  reviewedByUserId?: string | null;
  note?: string | null;
}): Promise<{ pattern: ReviewedCausalPattern | null; error?: string }> {
  const status = statusForDecision(input.decision);
  const reviewMetadata = {
    decision: input.decision,
    note: input.note?.trim() || null,
    reviewedByUserId: input.reviewedByUserId || null,
    reviewedAt: new Date().toISOString(),
  };

  try {
    const { rows } = await db.query(
      `UPDATE agent_causal_patterns
       SET status = $3,
           reviewed_at = COALESCE(reviewed_at, clock_timestamp()),
           applied_at = CASE WHEN $3 = 'applied' THEN COALESCE(applied_at, clock_timestamp()) ELSE applied_at END,
           reviewed_by_user_id = COALESCE($4, reviewed_by_user_id),
           review_metadata = COALESCE(review_metadata, '{}'::jsonb) || $5::jsonb
       WHERE id = $1
         AND workspace_id = $2
         AND status IN ('pending', 'approved')
       RETURNING id, status, reviewed_at, applied_at`,
      [
        input.patternId,
        input.workspaceId,
        status,
        input.reviewedByUserId || null,
        JSON.stringify(reviewMetadata),
      ],
    );
    const pattern = rows[0];
    if (!pattern) {
      return { pattern: null, error: 'Padrao nao encontrado ou ja revisado.' };
    }
    return {
      pattern: {
        id: pattern.id,
        status: pattern.status,
        reviewedAt: pattern.reviewed_at ? new Date(pattern.reviewed_at).toISOString() : null,
        appliedAt: pattern.applied_at ? new Date(pattern.applied_at).toISOString() : null,
      },
    };
  } catch (error) {
    if (!shouldSuppressReviewError(error)) {
      console.error('[AUTOPILOT_CAUSAL_PATTERN_REVIEW] Failed to review pattern:', error);
    }
    return { pattern: null, error: 'Falha ao revisar sugestao.' };
  }
}
