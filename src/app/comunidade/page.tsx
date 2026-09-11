import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getProductUpdatesFeed } from '@/actions/product-updates';
import { CommunityFeed } from '@/components/community/community-feed';
import { getCommunityPostsFeed } from '@/lib/community-feed-server';
import { db } from '@/lib/db';
import type { ProductUpdateFeedItem } from '@/lib/product-updates';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Comunidade & Novidades | Dialogy',
  description: 'Conecte-se com a comunidade, descubra tendências e acompanhe atualizações oficiais da Dialogy.',
};

export default async function CommunityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let updates: ProductUpdateFeedItem[] = [];
  let unavailable = false;
  let isSuperAdmin = false;

  try {
    const [officialUpdates, communityPosts, userDb] = await Promise.all([
      getProductUpdatesFeed(user.id),
      getCommunityPostsFeed(user.id),
      db.query('SELECT is_superadmin FROM public.users WHERE id = $1', [user.id]),
    ]);
    isSuperAdmin = userDb.rows[0]?.is_superadmin === true;
    updates = [...officialUpdates, ...communityPosts]
      .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  } catch (error) {
    console.error('[COMMUNITY] Failed to load feed:', error);
    unavailable = true;
  }

  return <CommunityFeed initialItems={updates} unavailable={unavailable} isSuperAdmin={isSuperAdmin} />;
}
