'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import type {
  ProductUpdateAccent,
  ProductUpdateAnnouncement,
  ProductUpdateComment,
  ProductUpdateContentBlock,
  ProductUpdateFeedItem,
  ProductUpdatePoll,
  ProductUpdateReaction,
} from '@/lib/product-updates';
import { createClient } from '@/lib/supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCENTS = new Set<ProductUpdateAccent>(['emerald', 'blue', 'violet', 'amber', 'rose']);

function asAccent(value: unknown): ProductUpdateAccent {
  return ACCENTS.has(value as ProductUpdateAccent) ? value as ProductUpdateAccent : 'emerald';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 8);
}

function asContentBlocks(value: unknown): ProductUpdateContentBlock[] {
  if (!Array.isArray(value)) return [];
  return value.filter((block): block is ProductUpdateContentBlock => {
    if (!block || typeof block !== 'object' || !('type' in block)) return false;
    const candidate = block as Record<string, unknown>;
    if (candidate.type === 'divider') return true;
    if (candidate.type === 'heading' || candidate.type === 'paragraph' || candidate.type === 'quote') {
      return typeof candidate.text === 'string';
    }
    if (candidate.type === 'image') {
      return typeof candidate.url === 'string' && typeof candidate.alt === 'string';
    }
    if (candidate.type === 'video') return typeof candidate.url === 'string';
    return false;
  }).slice(0, 50);
}

async function authenticatedUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function getProductUpdatesFeed(userId: string): Promise<ProductUpdateFeedItem[]> {
  const result = await db.query(`
    SELECT
      pu.id,
      pu.slug,
      pu.title,
      pu.summary,
      pu.content,
      pu.category,
      pu.image_url,
      pu.accent_color,
      pu.highlights,
      pu.content_blocks,
      pu.published_at,
      pu.author_id,
      author.full_name AS author_name,
      author.avatar_url AS author_avatar_url,
      author_workspace.name AS author_workspace_name,
      COALESCE(reaction_counts.likes, 0)::int AS likes,
      COALESCE(reaction_counts.dislikes, 0)::int AS dislikes,
      mine.reaction AS my_reaction,
      COALESCE(comment_counts.total, 0)::int AS comments_count,
      COALESCE(view_counts.total, 0)::int AS views_count
    FROM public.product_updates pu
    LEFT JOIN public.users author ON author.id = pu.author_id
    LEFT JOIN public.workspaces author_workspace ON author_workspace.id = author.last_active_workspace_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE reaction = 'like') AS likes,
        COUNT(*) FILTER (WHERE reaction = 'dislike') AS dislikes
      FROM public.product_update_reactions pur
      WHERE pur.update_id = pu.id
    ) reaction_counts ON TRUE
    LEFT JOIN public.product_update_reactions mine
      ON mine.update_id = pu.id AND mine.user_id = $1
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total
      FROM public.product_update_comments puc
      WHERE puc.update_id = pu.id AND puc.deleted_at IS NULL
    ) comment_counts ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT pur.user_id)::int AS total
      FROM public.product_update_reads pur
      WHERE pur.update_id = pu.id
    ) view_counts ON TRUE
    WHERE pu.is_published = TRUE AND pu.published_at <= NOW()
    ORDER BY pu.published_at DESC, pu.created_at DESC
  `, [userId]);

  const pollByUpdate = new Map<string, ProductUpdatePoll>();
  const updateIds = result.rows.map((row) => row.id);
  if (updateIds.length) {
    const pollResult = await db.query(`
      SELECT
        pup.id AS poll_id,
        pup.update_id,
        pup.question,
        pup.is_active,
        pupo.id AS option_id,
        pupo.label,
        pupo.position,
        COUNT(pupv.user_id)::int AS votes,
        BOOL_OR(pupv.user_id = $1) AS selected
      FROM public.product_update_polls pup
      JOIN public.product_update_poll_options pupo ON pupo.poll_id = pup.id
      LEFT JOIN public.product_update_poll_votes pupv ON pupv.option_id = pupo.id
      WHERE pup.update_id = ANY($2::uuid[])
      GROUP BY pup.id, pup.update_id, pup.question, pup.is_active, pupo.id, pupo.label, pupo.position
      ORDER BY pup.update_id, pupo.position
    `, [userId, updateIds]);

    for (const row of pollResult.rows) {
      const existing: ProductUpdatePoll = pollByUpdate.get(row.update_id) || {
        id: row.poll_id,
        question: row.question,
        isActive: row.is_active,
        totalVotes: 0,
        selectedOptionId: null,
        options: [],
      };
      existing.totalVotes += row.votes;
      if (row.selected) existing.selectedOptionId = row.option_id;
      existing.options.push({ id: row.option_id, label: row.label, votes: row.votes, percentage: 0 });
      pollByUpdate.set(row.update_id, existing);
    }
    pollByUpdate.forEach((poll) => {
      poll.options.forEach((option) => {
        option.percentage = poll.totalVotes ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
      });
    });
  }

  return result.rows.map((row): ProductUpdateFeedItem => ({
    kind: 'update',
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    content: row.content,
    category: row.category,
    imageUrl: row.image_url,
    accentColor: asAccent(row.accent_color),
    highlights: asStringArray(row.highlights),
    contentBlocks: asContentBlocks(row.content_blocks),
    poll: pollByUpdate.get(row.id) || null,
    publishedAt: new Date(row.published_at).toISOString(),
    author: row.author_name ? {
      id: row.author_id,
      name: row.author_name,
      avatarUrl: row.author_avatar_url,
      workspaceName: row.author_workspace_name,
    } : null,
    media: null,
    isMine: row.author_id === userId,
    reactions: {
      likes: row.likes,
      dislikes: row.dislikes,
      mine: row.my_reaction === 'like' || row.my_reaction === 'dislike' ? row.my_reaction : null,
    },
    commentsCount: row.comments_count,
    viewsCount: row.views_count,
  }));
}

export async function voteProductUpdatePollAction(pollId: string, optionId: string): Promise<{
  success: boolean;
  poll?: ProductUpdatePoll;
  error?: string;
}> {
  const userId = await authenticatedUserId();
  if (!userId) return { success: false, error: 'Faça login para votar.' };
  if (!UUID_PATTERN.test(pollId) || !UUID_PATTERN.test(optionId)) {
    return { success: false, error: 'Opção de enquete inválida.' };
  }

  try {
    const option = await db.query(`
      SELECT pup.id
      FROM public.product_update_polls pup
      JOIN public.product_update_poll_options pupo ON pupo.poll_id = pup.id
      JOIN public.product_updates pu ON pu.id = pup.update_id
      WHERE pup.id = $1 AND pupo.id = $2 AND pup.is_active = TRUE
        AND pu.is_published = TRUE AND pu.published_at <= NOW()
    `, [pollId, optionId]);
    if (!option.rowCount) return { success: false, error: 'Esta enquete não está mais disponível.' };

    await db.query(`
      INSERT INTO public.product_update_poll_votes (poll_id, option_id, user_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (poll_id, user_id)
      DO UPDATE SET option_id = EXCLUDED.option_id, created_at = NOW()
    `, [pollId, optionId, userId]);

    const result = await db.query(`
      SELECT
        pup.id AS poll_id,
        pup.question,
        pup.is_active,
        pupo.id AS option_id,
        pupo.label,
        pupo.position,
        COUNT(pupv.user_id)::int AS votes,
        BOOL_OR(pupv.user_id = $2) AS selected
      FROM public.product_update_polls pup
      JOIN public.product_update_poll_options pupo ON pupo.poll_id = pup.id
      LEFT JOIN public.product_update_poll_votes pupv ON pupv.option_id = pupo.id
      WHERE pup.id = $1
      GROUP BY pup.id, pup.question, pup.is_active, pupo.id, pupo.label, pupo.position
      ORDER BY pupo.position
    `, [pollId, userId]);
    const totalVotes = result.rows.reduce((total, row) => total + row.votes, 0);
    revalidatePath('/comunidade');
    revalidatePath('/novidades');
    return {
      success: true,
      poll: {
        id: pollId,
        question: result.rows[0].question,
        isActive: result.rows[0].is_active,
        totalVotes,
        selectedOptionId: result.rows.find((row) => row.selected)?.option_id || null,
        options: result.rows.map((row) => ({
          id: row.option_id,
          label: row.label,
          votes: row.votes,
          percentage: totalVotes ? Math.round((row.votes / totalVotes) * 100) : 0,
        })),
      },
    };
  } catch (error) {
    console.error('[PRODUCT_UPDATES] Failed to save poll vote:', error);
    return { success: false, error: 'Não foi possível registrar seu voto.' };
  }
}

export async function getProductUpdateCommentsAction(updateId: string): Promise<{
  success: boolean;
  comments?: ProductUpdateComment[];
  error?: string;
}> {
  const userId = await authenticatedUserId();
  if (!userId) return { success: false, error: 'Faça login para ver a conversa.' };
  if (!UUID_PATTERN.test(updateId)) return { success: false, error: 'Publicação inválida.' };

  try {
    const result = await db.query(`
      SELECT
        puc.id,
        puc.update_id,
        puc.user_id,
        puc.content,
        puc.is_edited,
        puc.created_at,
        u.full_name,
        u.avatar_url,
        u.is_superadmin,
        w.name AS workspace_name,
        w.avatar_url AS workspace_avatar_url
      FROM public.product_update_comments puc
      JOIN public.product_updates pu ON pu.id = puc.update_id
      JOIN public.users u ON u.id = puc.user_id
      LEFT JOIN public.workspaces w ON w.id = u.last_active_workspace_id
      WHERE puc.update_id = $1
        AND puc.deleted_at IS NULL
        AND pu.is_published = TRUE
        AND pu.published_at <= NOW()
      ORDER BY puc.created_at ASC
      LIMIT 150
    `, [updateId]);

    return {
      success: true,
      comments: result.rows.map((row): ProductUpdateComment => ({
        id: row.id,
        updateId: row.update_id,
        content: row.content,
        createdAt: new Date(row.created_at).toISOString(),
        isEdited: row.is_edited,
        isMine: row.user_id === userId,
        author: {
          id: row.user_id,
          name: row.full_name,
          avatarUrl: row.avatar_url,
          isSuperAdmin: Boolean(row.is_superadmin),
          workspaceName: row.workspace_name,
          workspaceAvatarUrl: row.workspace_avatar_url,
        },
      })),
    };
  } catch (error) {
    console.error('[PRODUCT_UPDATES] Failed to load comments:', error);
    return { success: false, error: 'Não foi possível carregar os comentários.' };
  }
}

export async function reactToProductUpdateAction(updateId: string, reaction: ProductUpdateReaction): Promise<{
  success: boolean;
  reaction?: ProductUpdateReaction | null;
  likes?: number;
  dislikes?: number;
  error?: string;
}> {
  const userId = await authenticatedUserId();
  if (!userId) return { success: false, error: 'Faça login para reagir.' };
  if (!UUID_PATTERN.test(updateId) || !['like', 'dislike'].includes(reaction)) {
    return { success: false, error: 'Reação inválida.' };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT reaction FROM public.product_update_reactions WHERE update_id = $1 AND user_id = $2 FOR UPDATE',
      [updateId, userId]
    );

    let nextReaction: ProductUpdateReaction | null = reaction;
    if (existing.rows[0]?.reaction === reaction) {
      await client.query(
        'DELETE FROM public.product_update_reactions WHERE update_id = $1 AND user_id = $2',
        [updateId, userId]
      );
      nextReaction = null;
    } else {
      await client.query(`
        INSERT INTO public.product_update_reactions (update_id, user_id, reaction)
        SELECT pu.id, $2, $3
        FROM public.product_updates pu
        WHERE pu.id = $1 AND pu.is_published = TRUE AND pu.published_at <= NOW()
        ON CONFLICT (update_id, user_id)
        DO UPDATE SET reaction = EXCLUDED.reaction, updated_at = NOW()
      `, [updateId, userId, reaction]);
    }

    const counts = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE reaction = 'like')::int AS likes,
        COUNT(*) FILTER (WHERE reaction = 'dislike')::int AS dislikes
      FROM public.product_update_reactions
      WHERE update_id = $1
    `, [updateId]);
    await client.query('COMMIT');
    revalidatePath('/comunidade');
    revalidatePath('/novidades');

    return {
      success: true,
      reaction: nextReaction,
      likes: counts.rows[0]?.likes ?? 0,
      dislikes: counts.rows[0]?.dislikes ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[PRODUCT_UPDATES] Failed to save reaction:', error);
    return { success: false, error: 'Não foi possível registrar sua reação.' };
  } finally {
    client.release();
  }
}

export async function addProductUpdateCommentAction(updateId: string, content: string): Promise<{
  success: boolean;
  comment?: ProductUpdateComment;
  error?: string;
}> {
  const userId = await authenticatedUserId();
  if (!userId) return { success: false, error: 'Faça login para comentar.' };
  if (!UUID_PATTERN.test(updateId)) return { success: false, error: 'Publicação inválida.' };

  const normalizedContent = content.trim().replace(/\r\n/g, '\n');
  if (!normalizedContent || normalizedContent.length > 1200) {
    return { success: false, error: 'O comentário deve ter entre 1 e 1.200 caracteres.' };
  }

  try {
    const result = await db.query(`
      WITH inserted AS (
        INSERT INTO public.product_update_comments (update_id, user_id, content)
        SELECT pu.id, $2, $3
        FROM public.product_updates pu
        WHERE pu.id = $1 AND pu.is_published = TRUE AND pu.published_at <= NOW()
        RETURNING *
      )
      SELECT
        inserted.*,
        u.full_name,
        u.avatar_url,
        u.is_superadmin,
        w.name AS workspace_name,
        w.avatar_url AS workspace_avatar_url
      FROM inserted
      JOIN public.users u ON u.id = inserted.user_id
      LEFT JOIN public.workspaces w ON w.id = u.last_active_workspace_id
    `, [updateId, userId, normalizedContent]);

    if (!result.rows[0]) return { success: false, error: 'Esta publicação não está disponível.' };
    const row = result.rows[0];
    revalidatePath('/comunidade');
    revalidatePath('/novidades');

    return {
      success: true,
      comment: {
        id: row.id,
        updateId: row.update_id,
        content: row.content,
        createdAt: new Date(row.created_at).toISOString(),
        isEdited: false,
        isMine: true,
        author: {
          id: userId,
          name: row.full_name,
          avatarUrl: row.avatar_url,
          isSuperAdmin: Boolean(row.is_superadmin),
          workspaceName: row.workspace_name,
          workspaceAvatarUrl: row.workspace_avatar_url,
        },
      },
    };
  } catch (error) {
    console.error('[PRODUCT_UPDATES] Failed to add comment:', error);
    return { success: false, error: 'Não foi possível publicar seu comentário.' };
  }
}

export async function deleteProductUpdateCommentAction(commentId: string): Promise<{ success: boolean; error?: string }> {
  const userId = await authenticatedUserId();
  if (!userId) return { success: false, error: 'Faça login para remover o comentário.' };
  if (!UUID_PATTERN.test(commentId)) return { success: false, error: 'Comentário inválido.' };

  try {
    const result = await db.query(`
      UPDATE public.product_update_comments
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      RETURNING update_id
    `, [commentId, userId]);
    if (!result.rowCount) return { success: false, error: 'Comentário não encontrado.' };
    revalidatePath('/comunidade');
    revalidatePath('/novidades');
    return { success: true };
  } catch (error) {
    console.error('[PRODUCT_UPDATES] Failed to delete comment:', error);
    return { success: false, error: 'Não foi possível remover o comentário.' };
  }
}

export async function getUnreadProductUpdateAnnouncementAction(): Promise<ProductUpdateAnnouncement | null> {
  const userId = await authenticatedUserId();
  if (!userId) return null;

  try {
    const result = await db.query(`
      SELECT
        pu.id,
        pu.slug,
        COALESCE(NULLIF(pu.modal_title, ''), pu.title) AS title,
        COALESCE(NULLIF(pu.modal_excerpt, ''), NULLIF(pu.summary, ''), LEFT(pu.content, 220)) AS excerpt,
        pu.category,
        pu.accent_color,
        pu.published_at
      FROM public.product_updates pu
      LEFT JOIN public.product_update_reads pur
        ON pur.update_id = pu.id AND pur.user_id = $1
      WHERE pu.is_published = TRUE
        AND pu.published_at <= NOW()
        AND pur.update_id IS NULL
      ORDER BY pu.published_at DESC
      LIMIT 1
    `, [userId]);
    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      category: row.category,
      accentColor: asAccent(row.accent_color),
      publishedAt: new Date(row.published_at).toISOString(),
    };
  } catch (error) {
    console.error('[PRODUCT_UPDATES] Failed to load announcement:', error);
    return null;
  }
}

export async function markProductUpdateReadAction(updateId: string): Promise<void> {
  const userId = await authenticatedUserId();
  if (!userId || !UUID_PATTERN.test(updateId)) return;

  try {
    await db.query(`
      INSERT INTO public.product_update_reads (update_id, user_id, read_at)
      SELECT pu.id, $2, NOW()
      FROM public.product_updates pu
      WHERE pu.id = $1 AND pu.is_published = TRUE
      ON CONFLICT (update_id, user_id) DO UPDATE SET read_at = EXCLUDED.read_at
    `, [updateId, userId]);
  } catch (error) {
    console.error('[PRODUCT_UPDATES] Failed to mark announcement as read:', error);
  }
}

export async function getHasUnreadProductUpdatesAction(): Promise<boolean> {
  const userId = await authenticatedUserId();
  if (!userId) return false;
  try {
    const result = await db.query(`
      SELECT 1
      FROM public.product_updates pu
      LEFT JOIN public.product_update_reads pur
        ON pur.update_id = pu.id AND pur.user_id = $1
      WHERE pu.is_published = TRUE
        AND pu.published_at <= NOW()
        AND pur.update_id IS NULL
      LIMIT 1
    `, [userId]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('[PRODUCT_UPDATES] Failed to check unread:', error);
    return false;
  }
}
