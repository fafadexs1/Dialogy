'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@/lib/types';
import NewCampaignPageClient from '@/components/campaigns/new-campaign-page';
import { Loader2 } from 'lucide-react';

export default function NewCampaignPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/user', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setUser(data);
        } else {
          router.replace('/login');
        }
      } catch (error) {
        console.error('[NEW_CAMPAIGN_PAGE] Failed to load user', error);
        router.replace('/login');
      } finally {
        setIsLoading(false);
      }
    };

    fetchUser();
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <NewCampaignPageClient user={user} />;
}
