'use client';

import { MessageCircleMore } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BrandMarkProps {
    className?: string;
    labelClassName?: string;
}

export function BrandMark({ className, labelClassName }: BrandMarkProps) {
    return (
        <div className={cn('inline-flex items-center gap-2', className)}>
            <span className={cn('text-xl font-bold tracking-tighter text-white', labelClassName)}>
                Dialogy
            </span>
        </div>
    );
}
