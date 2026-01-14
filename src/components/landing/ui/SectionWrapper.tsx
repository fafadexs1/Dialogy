'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface SectionWrapperProps {
    children: React.ReactNode;
    className?: string;
    id?: string;
    fullWidth?: boolean;
}

export function SectionWrapper({ children, className, id, fullWidth = false }: SectionWrapperProps) {
    return (
        <section
            id={id}
            className={cn(
                'relative py-24 md:py-32 overflow-hidden',
                className
            )}
        >
            <div className={cn(
                'relative z-10 mx-auto',
                fullWidth ? 'w-full' : 'container-width'
            )}>
                {children}
            </div>
        </section>
    );
}

export const FadeIn = ({
    children,
    delay = 0,
    className,
    direction = 'up'
}: {
    children: React.ReactNode,
    delay?: number,
    className?: string,
    direction?: 'up' | 'down' | 'left' | 'right'
}) => {
    const directionMap = {
        up: { y: 20, x: 0 },
        down: { y: -20, x: 0 },
        left: { x: 20, y: 0 },
        right: { x: -20, y: 0 }
    }

    return (
        <motion.div
            initial={{ opacity: 0, ...directionMap[direction] }}
            whileInView={{ opacity: 1, x: 0, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, delay, ease: "easeOut" }}
            className={className}
        >
            {children}
        </motion.div>
    )
}
