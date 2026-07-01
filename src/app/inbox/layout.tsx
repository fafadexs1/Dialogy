import { AppRouteShell } from '@/components/layout/app-route-shell';
import { GlobalAlertRealtime } from '@/components/layout/global-alert-realtime';
import { getGlobalAlertAction } from '@/actions/system-alerts';
import { CanvasRevealEffect } from '@/components/ui/sign-in-flow-1';

export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const alert = await getGlobalAlertAction();

  return (
    <AppRouteShell>
      <div className="relative isolate flex h-full min-h-0 w-full flex-col overflow-hidden bg-black">
        {/* Global Background Effect (Noise/Shader) */}
        <div className="absolute inset-0 z-0 pointer-events-none">
            <div className="absolute inset-0 opacity-30">
                <CanvasRevealEffect
                    animationSpeed={2}
                    containerClassName="bg-black"
                    colors={[[255, 255, 255], [255, 255, 255]]}
                    dotSize={6}
                />
            </div>
            {/* Global Noise Texture */}
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.05] mix-blend-overlay" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(0,0,0,0.8)_100%)]" />
        </div>

        <div className="relative z-10 flex h-full min-h-0 w-full flex-col overflow-hidden">
          <GlobalAlertRealtime initialAlert={alert} />
          <div className="relative min-h-0 w-full flex-1 overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </AppRouteShell>
  );
}
