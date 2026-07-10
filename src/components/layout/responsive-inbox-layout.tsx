'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

import type { InitialChatsPayload } from '@/actions/chats';
import type { User } from '@/lib/types';
import InboxLoadingShell from './inbox-loading-shell';

const CustomerChatLayout = dynamic(() => import('./customer-chat-layout'), {
  ssr: false,
  loading: () => <InboxLoadingShell />,
});

const MobileChatLayout = dynamic(() => import('./mobile-chat-layout'), {
  ssr: false,
  loading: () => <InboxLoadingShell />,
});

export default function ResponsiveInboxLayout({
  initialUser,
  initialChatId,
  initialData,
}: {
  initialUser: User;
  initialChatId: string | null;
  initialData: InitialChatsPayload | null;
}) {
  const [layout, setLayout] = useState<'mobile' | 'desktop' | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const syncLayout = () => setLayout(mediaQuery.matches ? 'desktop' : 'mobile');
    syncLayout();
    mediaQuery.addEventListener('change', syncLayout);
    return () => mediaQuery.removeEventListener('change', syncLayout);
  }, []);

  if (!layout) return <InboxLoadingShell />;

  const sharedProps = { initialUser, chatId: initialChatId, initialData };
  return (
    <div className="flex h-full w-full">
      {layout === 'mobile'
        ? <MobileChatLayout {...sharedProps} />
        : <CustomerChatLayout {...sharedProps} />}
    </div>
  );
}
