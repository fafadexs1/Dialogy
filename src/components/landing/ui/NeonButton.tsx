'use client';

import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface NeonButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
    glowColor?: 'green' | 'blue' | 'purple';
    isLoading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    children: React.ReactNode;
}

export function NeonButton({
    className,
    variant = 'primary',
    glowColor = 'green',
    isLoading = false,
    leftIcon,
    rightIcon,
    children,
    ...props
}: NeonButtonProps) {
    const ref = useRef<HTMLButtonElement>(null);
    const [position, setPosition] = useState({ x: 0, y: 0 });

    const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (!ref.current) return;
        const { clientX, clientY } = e;
        const { left, top, width, height } = ref.current.getBoundingClientRect();
        const x = (clientX - (left + width / 2)) * 0.2; // Magnetic strength
        const y = (clientY - (top + height / 2)) * 0.2;
        setPosition({ x, y });
    };

    const handleMouseLeave = () => {
        setPosition({ x: 0, y: 0 });
    };

    const glowStyles = {
        green: 'shadow-[0_0_20px_-5px_rgba(25,245,178,0.5)] hover:shadow-[0_0_30px_-5px_rgba(25,245,178,0.7)] text-brand-dark bg-brand-green border-transparent',
        blue: 'shadow-[0_0_20px_-5px_rgba(58,169,255,0.5)] hover:shadow-[0_0_30px_-5px_rgba(58,169,255,0.7)] text-brand-dark bg-brand-blue border-transparent',
        purple: 'shadow-[0_0_20px_-5px_rgba(139,92,255,0.5)] hover:shadow-[0_0_30px_-5px_rgba(139,92,255,0.7)] text-brand-dark bg-brand-purple border-transparent',
    };

    const outlineGlowStyles = {
        green: 'border-brand-green/30 text-brand-green hover:bg-brand-green/10 hover:border-brand-green/60 shadow-[0_0_10px_-5px_rgba(25,245,178,0)] hover:shadow-[0_0_15px_-5px_rgba(25,245,178,0.4)]',
        blue: 'border-brand-blue/30 text-brand-blue hover:bg-brand-blue/10 hover:border-brand-blue/60 shadow-[0_0_10px_-5px_rgba(58,169,255,0)] hover:shadow-[0_0_15px_-5px_rgba(58,169,255,0.4)]',
        purple: 'border-brand-purple/30 text-brand-purple hover:bg-brand-purple/10 hover:border-brand-purple/60 shadow-[0_0_10px_-5px_rgba(139,92,255,0)] hover:shadow-[0_0_15px_-5px_rgba(139,92,255,0.4)]',
    };

    let variantStyles = '';
    if (variant === 'primary') {
        variantStyles = glowStyles[glowColor];
    } else if (variant === 'secondary') {
        variantStyles = 'bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20';
    } else if (variant === 'outline') {
        variantStyles = `bg-transparent border ${outlineGlowStyles[glowColor]}`;
    } else if (variant === 'ghost') {
        variantStyles = 'bg-transparent text-muted-foreground hover:text-white hover:bg-white/5';
    }

    return (
        <motion.button
            ref={ref}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            animate={{ x: position.x, y: position.y }}
            transition={{ type: 'spring', stiffness: 150, damping: 15, mass: 0.1 }}
            className={cn(
                'relative inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]',
                variantStyles,
                className
            )}
            {...props}
        >
            {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
                <>
                    {leftIcon && <span className="mr-2">{leftIcon}</span>}
                    {children}
                    {rightIcon && <span className="ml-2">{rightIcon}</span>}
                </>
            )}
        </motion.button>
    );
}
