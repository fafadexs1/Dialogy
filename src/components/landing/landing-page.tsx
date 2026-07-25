import { SiteHeader } from './v2/site-header';
import { Hero } from './v2/hero';
import { SocialProof } from './v2/social-proof';
import { Channels } from './v2/channels';
import { BeforeAfter } from './v2/before-after';
import { Platform } from './v2/platform';
import { AiSection } from './v2/ai-section';
import { HowItWorks } from './v2/how-it-works';
import { UseCases } from './v2/use-cases';
import { Integrations } from './v2/integrations';
import { Team } from './v2/team';
import { Pricing } from './v2/pricing';
import { Faq } from './v2/faq';
import { FinalCta } from './v2/final-cta';
import { SiteFooter } from './v2/site-footer';
import { FloatingButtons } from './ui/FloatingButtons';

export default function LandingPage() {
    return (
        <div className="min-h-screen overflow-x-hidden bg-white font-sans text-slate-900 selection:bg-brand-green/40 selection:text-slate-900">
            <SiteHeader />

            <main>
                <Hero />
                <SocialProof />
                <Channels />
                <BeforeAfter />
                <Platform />
                <AiSection />
                <HowItWorks />
                <UseCases />
                <Integrations />
                <Team />
                <Pricing />
                <Faq />
                <FinalCta />
            </main>

            <SiteFooter />
            <FloatingButtons />
        </div>
    );
}
