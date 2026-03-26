
import { notFound } from 'next/navigation';

import { getDangerousAdminAccess } from '@/lib/security/dangerous-admin';

import { SetupPageClient } from './setup-page-client';

export default async function SetupPage() {
  const access = await getDangerousAdminAccess();

  if (!access.ok) {
    notFound();
  }

  return <SetupPageClient />;
}
