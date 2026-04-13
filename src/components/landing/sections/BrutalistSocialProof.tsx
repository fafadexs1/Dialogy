"use client";

import { motion } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';

export const BrutalistSocialProof = () => {
    const isMobile = useIsMobile();
    const textMotionProps = {
        initial: { opacity: 0, y: 10 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true },
        transition: { duration: 0.5 },
    };
    const groupMotionProps = {
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true },
        transition: { staggerChildren: 0.2, duration: 0.5 },
    };
    const itemMotionProps = {
        initial: { opacity: 0, scale: 0.9 },
        whileInView: { opacity: 1, scale: 1 },
        transition: { duration: 0.4 },
    };

    return (
        <section className="relative overflow-hidden border-b border-zinc-100 bg-white py-16 md:py-24">
            <div className="mx-auto max-w-7xl px-6 text-center">
                <motion.p 
                    {...textMotionProps}
                    className="mb-8 text-sm font-bold uppercase tracking-[0.2em] text-zinc-400 md:mb-12 md:text-xs"
                >
                    Mais de 10 workspaces globais criados na plataforma
                </motion.p>

                <motion.div 
                    {...groupMotionProps}
                    className="flex flex-wrap items-center justify-center gap-12 opacity-80 grayscale transition-all duration-500 md:gap-x-24 md:gap-y-12 md:hover:grayscale-0"
                >
                    <motion.div 
                        {...itemMotionProps}
                        className="flex items-center gap-3 cursor-default md:transition-transform md:hover:scale-105"
                    >
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-xl font-black text-white shadow-lg">
                            V
                        </div>
                        <div className="text-3xl font-extrabold tracking-tighter text-zinc-900">Velpro Telecom</div>
                    </motion.div>

                    <motion.div 
                        {...itemMotionProps}
                        className="flex items-center gap-3 cursor-default md:transition-transform md:hover:scale-105"
                    >
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-xl font-black text-white shadow-lg">
                            K
                        </div>
                        <div className="text-3xl font-extrabold tracking-tighter text-zinc-900">KlyraAi</div>
                    </motion.div>
                </motion.div>
            </div>
        </section>
    );
};
