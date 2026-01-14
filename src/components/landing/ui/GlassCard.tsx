'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface GlassCardProps extends React.ComponentProps<typeof motion.div> {
    children: React.ReactNode;
    className?: string;
    hoverEffect?: boolean;
    intensity?: 'low' | 'medium' | 'high';
}

export function GlassCard({
    children,
    className,
    hoverEffect = false,
    intensity = 'medium',
    ...props
}: GlassCardProps) {

    const intensityMap = {
        low: 'bg-black/20 backdrop-blur-md border-white/5',
        medium: 'bg-[#0B0B10]/60 backdrop-blur-xl border-white/5 shadow-xl',
        high: 'bg-[#15151A]/80 backdrop-blur-2xl border-white/10 shadow-2xl',
    }

    return (
        <motion.div
            className={cn(
                'rounded-2xl border transition-all duration-300',
                intensityMap[intensity],
                hoverEffect && 'hover:border-white/20 hover:shadow-2xl hover:-translate-y-1',
                className
            )}
            initial={hoverEffect ? { opacity: 0, y: 20 } : undefined}
            whileInView={hoverEffect ? { opacity: 1, y: 0 } : undefined}
            viewport={{ once: true, margin: '-50px' }}
            {...props}
        >
            {children}
        </motion.div>
    );
}
