'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { normalizeCommunityMedia, type CommunityMediaInput } from '@/lib/community-media';
import { db } from '@/lib/db';
import type { ProductUpdateComment } from '@/lib/product-updates';
import { createClient } from '@/lib/supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function authenticatedUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function refreshCommunity(): void {
  revalidatePath('/comunidade');
  revalidatePath('/novidades');
}

export async function createCommunityPostAction(input: {
  body: string;
  media?: CommunityMediaInput | null;
}): Promise<{ success: boolean; error?: string }> {
  const userId = await authenticatedUserId();
  if (!userId) return { success: false, error: 'Faça login para publicar.' };
  const body = input.body.trim().replace(/\r\n/g, '\n');
  if (!body || body.length > 5000) return { success: false, error: 'A publicação deve ter entre 1 e 5.000 caracteres.' };

  let media = null;
  try {
    media = normalizeCommunityMedia(input.media);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Mídia inválida.' };
  }

  try {
    const recent = await db.query(`
      SELECT COUNT(*)::int AS total FROM public.community_posts
      WHERE author_id = $1 AND created_at > NOW() - INTERVAL '1 minute'
    `, [userId]);
    if ((recent.rows[0]?.total ?? 0) >= 5) return { success: false, error: 'Aguarde um pouco antes de publicar novamente.' };

    await db.query(`
      INSERT INTO public.community_posts (id, author_id, body, media_type, media_url)
      VALUES ($1, $2, $3, $4, $5)
    `, [randomUUID(), userId, body, media?.type ?? null, media?.url ?? null]);
    refreshCommunity();
    return { success: true };
  } catch (error) {
    console.error('[COMMUNITY] Failed to create post:', error);
    return { success: false, error: 'Não foi possível publicar agora.' };
  }
}

export async function deleteCommunityPostAction(postId: string): Promise<{ success: boolean; error?: string }> {
  const userId = await authenticatedUserId();
  if (!userId || !UUID_PATTERN.test(postId)) return { success: false, error: 'Publicação inválida.' };
  const result = await db.query(`
    UPDATE public.community_posts SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND author_id = $2 AND status = 'published'
  `, [postId, userId]);
  if (!result.rowCount) return { success: false, error: 'Você não pode remover esta publicação.' };
  refreshCommunity();
  return { success: true };
}

export async function reactCommunityPostAction(postId: string): Promise<{
  success: boolean; liked?: boolean; likes?: number; error?: string;
}> {
  const userId = await authenticatedUserId();
  if (!userId || !UUID_PATTERN.test(postId)) return { success: false, error: 'Publicação inválida.' };
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const removed = await client.query(
      'DELETE FROM public.community_post_reactions WHERE post_id = $1 AND user_id = $2 RETURNING post_id',
      [postId, userId],
    );
    let liked = false;
    if (!removed.rowCount) {
      const inserted = await client.query(`
        INSERT INTO public.community_post_reactions (post_id, user_id)
        SELECT id, $2 FROM public.community_posts
        WHERE id = $1 AND status = 'published' AND deleted_at IS NULL
        RETURNING post_id
      `, [postId, userId]);
      liked = Boolean(inserted.rowCount);
    }
    const count = await client.query('SELECT COUNT(*)::int AS likes FROM public.community_post_reactions WHERE post_id = $1', [postId]);
    await client.query('COMMIT');
    refreshCommunity();
    return { success: true, liked, likes: count.rows[0]?.likes ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[COMMUNITY] Failed to react:', error);
    return { success: false, error: 'Não foi possível curtir.' };
  } finally {
    client.release();
  }
}

export async function getCommunityPostCommentsAction(postId: string): Promise<{
  success: boolean; comments?: ProductUpdateComment[]; error?: string;
}> {
  const userId = await authenticatedUserId();
  if (!userId || !UUID_PATTERN.test(postId)) return { success: false, error: 'Publicação inválida.' };
  const result = await db.query(`
    SELECT cpc.*, u.full_name, u.avatar_url, u.is_superadmin, w.name AS workspace_name, w.avatar_url AS workspace_avatar_url
    FROM public.community_post_comments cpc
    JOIN public.users u ON u.id = cpc.user_id
    LEFT JOIN public.workspaces w ON w.id = u.last_active_workspace_id
    JOIN public.community_posts cp ON cp.id = cpc.post_id
    WHERE cpc.post_id = $1 AND cpc.deleted_at IS NULL AND cp.status = 'published' AND cp.deleted_at IS NULL
    ORDER BY cpc.created_at ASC LIMIT 150
  `, [postId]);
  return { success: true, comments: result.rows.map((row): ProductUpdateComment => ({
    id: row.id, updateId: row.post_id, content: row.content,
    createdAt: new Date(row.created_at).toISOString(), isEdited: false, isMine: row.user_id === userId,
    author: {
      id: row.user_id,
      name: row.full_name,
      avatarUrl: row.avatar_url,
      isSuperAdmin: Boolean(row.is_superadmin),
      workspaceName: row.workspace_name,
      workspaceAvatarUrl: row.workspace_avatar_url,
    },
  })) };
}

export async function addCommunityPostCommentAction(postId: string, content: string): Promise<{
  success: boolean; comment?: ProductUpdateComment; error?: string;
}> {
  const userId = await authenticatedUserId();
  if (!userId || !UUID_PATTERN.test(postId)) return { success: false, error: 'Publicação inválida.' };
  const body = content.trim().replace(/\r\n/g, '\n');
  if (!body || body.length > 1200) return { success: false, error: 'O comentário deve ter entre 1 e 1.200 caracteres.' };
  const result = await db.query(`
    WITH inserted AS (
      INSERT INTO public.community_post_comments (post_id, user_id, content)
      SELECT id, $2, $3 FROM public.community_posts WHERE id = $1 AND status = 'published' AND deleted_at IS NULL
      RETURNING *
    )
    SELECT inserted.*, u.full_name, u.avatar_url, u.is_superadmin, w.name AS workspace_name, w.avatar_url AS workspace_avatar_url
    FROM inserted JOIN public.users u ON u.id = inserted.user_id
    LEFT JOIN public.workspaces w ON w.id = u.last_active_workspace_id
  `, [postId, userId, body]);
  const row = result.rows[0];
  if (!row) return { success: false, error: 'Publicação indisponível.' };
  refreshCommunity();
  return { success: true, comment: {
    id: row.id, updateId: row.post_id, content: row.content,
    createdAt: new Date(row.created_at).toISOString(), isEdited: false, isMine: true,
    author: {
      id: userId,
      name: row.full_name,
      avatarUrl: row.avatar_url,
      isSuperAdmin: Boolean(row.is_superadmin),
      workspaceName: row.workspace_name,
      workspaceAvatarUrl: row.workspace_avatar_url,
    },
  } };
}

export async function deleteCommunityPostCommentAction(commentId: string): Promise<{ success: boolean; error?: string }> {
  const userId = await authenticatedUserId();
  if (!userId || !UUID_PATTERN.test(commentId)) return { success: false, error: 'Comentário inválido.' };
  const result = await db.query(`
    UPDATE public.community_post_comments SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
  `, [commentId, userId]);
  if (!result.rowCount) return { success: false, error: 'Comentário não encontrado.' };
  refreshCommunity();
  return { success: true };
}

export async function recordPostViewAction(input: {
  id: string;
  kind: 'community' | 'update';
}): Promise<{ success: boolean }> {
  const userId = await authenticatedUserId();
  if (!userId || !UUID_PATTERN.test(input.id)) return { success: false };

  try {
    if (input.kind === 'community') {
      await db.query(`
        INSERT INTO public.community_post_views (post_id, user_id, viewed_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (post_id, user_id) DO NOTHING
      `, [input.id, userId]);
    } else {
      await db.query(`
        INSERT INTO public.product_update_reads (update_id, user_id, read_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (update_id, user_id) DO NOTHING
      `, [input.id, userId]);
    }
    return { success: true };
  } catch (error) {
    console.error('[COMMUNITY] Error recording view:', error);
    return { success: false };
  }
}

export async function getPostViewersAction(input: {
  id: string;
  kind: 'community' | 'update';
}): Promise<{
  success: boolean;
  viewers?: Array<{
    id: string;
    name: string;
    email?: string;
    avatarUrl: string | null;
    viewedAt: string;
  }>;
  error?: string;
}> {
  const userId = await authenticatedUserId();
  if (!userId) return { success: false, error: 'Não autenticado' };

  // STRICT: Apenas administrador do sistema pode ver quem visualizou
  const userRes = await db.query('SELECT is_superadmin FROM public.users WHERE id = $1', [userId]);
  if (!userRes.rows[0]?.is_superadmin) {
    return { success: false, error: 'Acesso restrito ao administrador do sistema.' };
  }

  if (!UUID_PATTERN.test(input.id)) {
    return { success: false, error: 'Identificador inválido.' };
  }

  try {
    if (input.kind === 'community') {
      const result = await db.query(`
        SELECT u.id, u.full_name, u.email, u.avatar_url, cpv.viewed_at
        FROM public.community_post_views cpv
        JOIN public.users u ON u.id = cpv.user_id
        WHERE cpv.post_id = $1
        ORDER BY cpv.viewed_at DESC
      `, [input.id]);
      return {
        success: true,
        viewers: result.rows.map(row => ({
          id: row.id,
          name: row.full_name || row.email || 'Usuário',
          email: row.email,
          avatarUrl: row.avatar_url,
          viewedAt: new Date(row.viewed_at).toISOString(),
        })),
      };
    } else {
      const result = await db.query(`
        SELECT u.id, u.full_name, u.email, u.avatar_url, pur.read_at AS viewed_at
        FROM public.product_update_reads pur
        JOIN public.users u ON u.id = pur.user_id
        WHERE pur.update_id = $1
        ORDER BY pur.read_at DESC
      `, [input.id]);
      return {
        success: true,
        viewers: result.rows.map(row => ({
          id: row.id,
          name: row.full_name || row.email || 'Usuário',
          email: row.email,
          avatarUrl: row.avatar_url,
          viewedAt: new Date(row.viewed_at).toISOString(),
        })),
      };
    }
  } catch (error) {
    console.error('[COMMUNITY] Error getting viewers:', error);
    return { success: false, error: 'Não foi possível carregar os visualizadores.' };
  }
}
