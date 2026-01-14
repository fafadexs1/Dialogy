'use client';

import React from 'react';

export function SocialProof() {
    return (
        <section className="py-20 border-y border-white/5 bg-black/20 overflow-hidden relative">
            {/* Gradients for smooth fade in/out on edges */}
            <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#050507] to-transparent z-10"></div>
            <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#050507] to-transparent z-10"></div>

            <div className="max-w-7xl mx-auto px-4 mb-10 text-center">
                <p className="text-sm text-gray-500 font-medium uppercase tracking-[0.3em]">Confiado por grandes empresas</p>
            </div>

            <div className="flex w-full overflow-hidden justify-center items-center">
                <div className="flex animate-marquee whitespace-nowrap gap-24 items-center">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                        <div key={i} className="flex items-center justify-center grayscale opacity-20 hover:grayscale-0 hover:opacity-50 transition-all duration-300 mx-10 shrink-0">
                            <img
                                src="/ntelecom.png"
                                alt="N Telecom"
                                className="w-48 md:w-40 h-auto object-contain brightness-200"
                            />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
