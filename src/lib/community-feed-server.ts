import 'server-only';

import { db } from '@/lib/db';
import type { ProductUpdateFeedItem } from '@/lib/product-updates';

export async function getCommunityPostsFeed(userId: string): Promise<ProductUpdateFeedItem[]> {
  const result = await db.query(`
    SELECT
      cp.id,
      cp.body,
      cp.media_type,
      cp.media_url,
      cp.created_at,
      cp.author_id,
      u.full_name AS author_name,
      u.avatar_url AS author_avatar_url,
      w.name AS workspace_name,
      COALESCE(rc.likes, 0)::int AS likes,
      (mine.user_id IS NOT NULL) AS liked_by_me,
      COALESCE(cc.total, 0)::int AS comments_count
    FROM public.community_posts cp
    JOIN public.users u ON u.id = cp.author_id
    LEFT JOIN public.workspaces w ON w.id = u.last_active_workspace_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS likes FROM public.community_post_reactions cpr WHERE cpr.post_id = cp.id
    ) rc ON TRUE
    LEFT JOIN public.community_post_reactions mine ON mine.post_id = cp.id AND mine.user_id = $1
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total FROM public.community_post_comments cpc
      WHERE cpc.post_id = cp.id AND cpc.deleted_at IS NULL
    ) cc ON TRUE
    WHERE cp.status = 'published' AND cp.deleted_at IS NULL
    ORDER BY cp.created_at DESC, cp.id DESC
    LIMIT 50
  `, [userId]);

  return result.rows.map((row): ProductUpdateFeedItem => ({
    kind: 'community',
    id: row.id,
    slug: `post-${row.id}`,
    title: row.body.split(/\r?\n/)[0].slice(0, 100),
    summary: null,
    content: row.body,
    category: 'Comunidade',
    imageUrl: row.media_type === 'image' ? row.media_url : null,
    accentColor: 'emerald',
    highlights: [],
    contentBlocks: [],
    poll: null,
    publishedAt: new Date(row.created_at).toISOString(),
    author: {
      id: row.author_id,
      name: row.author_name,
      avatarUrl: row.author_avatar_url,
      workspaceName: row.workspace_name,
    },
    media: row.media_type && row.media_url ? { type: row.media_type, url: row.media_url } : null,
    isMine: row.author_id === userId,
    reactions: { likes: row.likes, dislikes: 0, mine: row.liked_by_me ? 'like' : null },
    commentsCount: row.comments_count,
  }));
}
