'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface AuthInputProps extends React.ComponentProps<typeof Input> {
    icon?: React.ReactNode;
    label?: string;
}

export const AuthInput = React.forwardRef<HTMLInputElement, AuthInputProps>(
    ({ className, icon, type, ...props }, ref) => {
        const [isFocused, setIsFocused] = React.useState(false);

        return (
            <div className="relative group w-full">
                {/* Animated Background Glow */}
                <AnimatePresence>
                    {isFocused && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="absolute -inset-[1px] rounded-xl bg-gradient-to-r from-[#20E401]/20 via-[#20E401]/40 to-[#20E401]/20 blur-[2px] z-0"
                            style={{ padding: '1px' }}
                        />
                    )}
                </AnimatePresence>

                <div className="relative z-10">
                    {icon && (
                        <div className={cn(
                            "absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300",
                            isFocused ? "text-[#20E401]" : "text-gray-600"
                        )}>
                            {icon}
                        </div>
                    )}

                    <Input
                        ref={ref}
                        type={type}
                        onFocus={(e) => {
                            setIsFocused(true);
                            props.onFocus?.(e);
                        }}
                        onBlur={(e) => {
                            setIsFocused(false);
                            props.onBlur?.(e);
                        }}
                        className={cn(
                            "h-12 bg-[#0B0B10]/60 border-white/10 rounded-xl transition-all duration-300 placeholder:text-gray-700 text-white",
                            icon ? "pl-12" : "px-4",
                            isFocused ? "border-[#20E401]/50 ring-1 ring-[#20E401]/20 shadow-[0_0_20px_rgba(32,228,1,0.1)]" : "hover:border-white/20",
                            className
                        )}
                        {...props}
                    />

                    {/* Type-beam effect (subtle line that moves when typing could be too much, let's stick to glow) */}
                </div>
            </div>
        );
    }
);

AuthInput.displayName = "AuthInput";
