'use client';

import { MessageCircleMore } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BrandMarkProps {
    className?: string;
    labelClassName?: string;
}

export function BrandMark({ className, labelClassName }: BrandMarkProps) {
    return (
        <div className={cn('inline-flex items-center gap-3', className)}>
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#08110d] shadow-[0_16px_30px_-20px_rgba(25,245,178,0.65)]">
                <MessageCircleMore className="h-5 w-5 text-brand-green" />
            </div>
            <span className={cn('text-xl font-semibold tracking-tight text-slate-950', labelClassName)}>
                Dialogy
            </span>
        </div>
    );
}
