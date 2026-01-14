'use client';

import React from 'react';
import { Navbar } from './sections/Navbar';
import { Hero } from './sections/Hero';
import { SocialProof } from './sections/SocialProof';
import { Features } from './sections/Features';

import { Omnichannel } from './sections/Omnichannel';
import { Pricing } from './sections/Pricing';
import { Footer } from './sections/Footer';
import { StarsBackground } from './ui/StarsBackground';
import { ShootingStars } from './ui/ShootingStars';
import Particles from './ui/Particles';
import SectionReveal from './ui/SectionReveal';

export default function LandingPage() {
    return (
        <div className="min-h-screen bg-[#050507] text-gray-100 font-body selection:bg-brand-green/30 selection:text-white relative">
            {/* Background Effects */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <StarsBackground />
                <ShootingStars />
                <Particles
                    className="absolute inset-0"
                    quantity={150}
                    ease={80}
                    color="#19F5B2"
                    refresh
                />
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
        </div>
    );
}
