export const PRODUCT_UPDATES_REALTIME_TOPIC = 'system:product-updates';
export const PRODUCT_UPDATES_COMMUNITY_TOPIC = 'system:product-updates-community';

export type ProductUpdateReaction = 'like' | 'dislike';
export type ProductUpdateAccent = 'emerald' | 'blue' | 'violet' | 'amber' | 'rose';

export type ProductUpdateContentBlock =
  | { type: 'heading'; text: string; level?: 2 | 3 }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string; attribution?: string }
  | { type: 'image'; url: string; alt: string; caption?: string }
  | { type: 'video'; url: string; poster?: string; caption?: string }
  | { type: 'divider' };

export type ProductUpdatePoll = {
  id: string;
  question: string;
  isActive: boolean;
  totalVotes: number;
  selectedOptionId: string | null;
  options: Array<{
    id: string;
    label: string;
    votes: number;
    percentage: number;
  }>;
};

export type ProductUpdateFeedItem = {
  kind: 'update' | 'community';
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  content: string;
  category: string;
  imageUrl: string | null;
  accentColor: ProductUpdateAccent;
  highlights: string[];
  contentBlocks: ProductUpdateContentBlock[];
  poll: ProductUpdatePoll | null;
  publishedAt: string;
  author: {
    id: string;
    name: string;
    avatarUrl: string | null;
    workspaceName: string | null;
  } | null;
  media: { type: 'image' | 'youtube' | 'vimeo'; url: string } | null;
  isMine: boolean;
  reactions: {
    likes: number;
    dislikes: number;
    mine: ProductUpdateReaction | null;
  };
  commentsCount: number;
  viewsCount?: number;
  isDemo?: boolean;
  demoComments?: ProductUpdateComment[];
};

export type PostViewer = {
  id: string;
  name: string;
  email?: string;
  avatarUrl: string | null;
  viewedAt: string;
};

export type ProductUpdateComment = {
  id: string;
  updateId: string;
  content: string;
  createdAt: string;
  isEdited: boolean;
  isMine: boolean;
  author: {
    id: string;
    name: string;
    avatarUrl: string | null;
    isSuperAdmin?: boolean;
    workspaceName: string | null;
    workspaceAvatarUrl?: string | null;
  };
};

export type ProductUpdateAnnouncement = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  accentColor: ProductUpdateAccent;
  publishedAt: string;
};
