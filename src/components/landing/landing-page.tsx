import { Navbar } from './sections/Navbar';
import { NewHero } from './sections/NewHero';
import { ChatVolumePricingSection } from '@/components/pricing/chat-volume-pricing-section';
import { OmnichannelOrbit } from './sections/OmnichannelOrbit';
import { AutomagicShowcase } from './sections/AutomagicShowcase';
import { AsymmetricFeatures } from './sections/AsymmetricFeatures';
import { BrutalistSocialProof } from './sections/BrutalistSocialProof';
import { HomeSeoContent } from './sections/HomeSeoContent';
import { MinimalFooter } from './sections/MinimalFooter';

export default function LandingPage() {
    return (
        <div className="relative isolate min-h-screen overflow-x-hidden bg-[#f8f9fa] font-sans text-black selection:bg-brand-green selection:text-black">
            <div className="relative z-50">
                <Navbar />
            </div>

            <main className="relative z-10 flex flex-col">
                <NewHero />
                <ChatVolumePricingSection variant="landing" />
                <div>
                    <OmnichannelOrbit />
                </div>
                <div>
                    <AutomagicShowcase />
                </div>
                <div>
                    <AsymmetricFeatures />
                </div>
                <div>
                    <BrutalistSocialProof />
                </div>
                <div>
                    <HomeSeoContent />
                </div>
            </main>

            <div>
                <MinimalFooter />
            </div>
        </div>
    );
}
