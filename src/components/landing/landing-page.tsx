import { Header } from '@/components/ui/header-3';
import { NewHero } from './sections/NewHero';
import { ChatVolumePricingSection } from '@/components/pricing/chat-volume-pricing-section';
import { AutomagicShowcase } from './sections/AutomagicShowcase';
import { BrutalistSocialProof } from './sections/BrutalistSocialProof';
import { HomeSeoContent } from './sections/HomeSeoContent';
import { MinimalFooter } from './sections/MinimalFooter';
import { CanvasRevealEffect } from '@/components/ui/sign-in-flow-1';
import { FloatingButtons } from './ui/FloatingButtons';

export default function LandingPage() {
    return (
        <div className="relative min-h-screen overflow-x-hidden bg-black font-sans text-white selection:bg-brand-green/30 selection:text-brand-green">
            {/* Global Background Effect (Noise/Shader) */}
            <div className="fixed inset-0 z-0 h-full w-full pointer-events-none">
                <div className="absolute inset-0 opacity-20">
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

            <div className="relative z-10 flex flex-col">
                <Header />

                <main className="flex flex-col">
                    <NewHero />
                    <ChatVolumePricingSection variant="landing" />
                    <AutomagicShowcase />
                    <BrutalistSocialProof />
                    <HomeSeoContent />
                </main>

                <MinimalFooter />
                <FloatingButtons />
            </div>
        </div>
    );
}
