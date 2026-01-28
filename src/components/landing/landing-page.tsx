'use client';

import React from 'react';
import { Navbar } from './sections/Navbar';
import { Hero } from './sections/Hero';
import { SocialProof } from './sections/SocialProof';
import { Features } from './sections/Features';

import { Omnichannel } from './sections/Omnichannel';
import { Pricing } from './sections/Pricing';
import { Footer } from './sections/Footer';
import SectionReveal from './ui/SectionReveal';
import { FloatingButtons } from './ui/FloatingButtons';
import { AntigravityBackground } from '../ui/antigravity-background';

export default function LandingPage() {
    return (
        <div className="min-h-screen bg-[#050507] text-gray-100 font-body selection:bg-brand-green/30 selection:text-white relative overflow-x-hidden">
            {/* Background Effect */}
            <div className="fixed inset-0 z-0">
                <AntigravityBackground />
            </div>

            <Navbar />

            <main className="relative z-10">
                <Hero />

                <SectionReveal delay={0.1}>
                    <SocialProof />
                </SectionReveal>

                <SectionReveal delay={0.2}>
                    <Features />
                </SectionReveal>

                <SectionReveal delay={0.1}>
                    <Omnichannel />
                </SectionReveal>

                <SectionReveal delay={0.1}>
                    <Pricing />
                </SectionReveal>
            </main>

            <Footer />

            {/* Floating WhatsApp and Login buttons */}
            <FloatingButtons />
        </div>
    );
}

