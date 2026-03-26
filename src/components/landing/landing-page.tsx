import type { CSSProperties } from 'react';
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
    const deferredSectionStyle: CSSProperties = {
        contentVisibility: 'auto',
        containIntrinsicSize: '900px',
    };

    return (
        <div className="relative isolate min-h-screen overflow-x-hidden bg-[#f8f9fa] font-sans text-black selection:bg-brand-green selection:text-black">
            <div className="relative z-50">
                <Navbar />
            </div>

            <main className="relative z-10 flex flex-col">
                <NewHero />
                <ChatVolumePricingSection variant="landing" />
                <div style={deferredSectionStyle}>
                    <OmnichannelOrbit />
                </div>
                <div style={deferredSectionStyle}>
                    <AutomagicShowcase />
                </div>
                <div style={deferredSectionStyle}>
                    <AsymmetricFeatures />
                </div>
                <div style={deferredSectionStyle}>
                    <BrutalistSocialProof />
                </div>
                <div style={deferredSectionStyle}>
                    <HomeSeoContent />
                </div>
            </main>

            <div style={deferredSectionStyle}>
                <MinimalFooter />
            </div>
        </div>
    );
}
