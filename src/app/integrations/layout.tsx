import { FacebookSDK } from '@/components/integrations/facebook-sdk';
import { AppRouteShell } from '@/components/layout/app-route-shell';

export default async function IntegrationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppRouteShell>
      <FacebookSDK appId={process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || '740952588412789'} />
      {children}
    </AppRouteShell>
  );
}
