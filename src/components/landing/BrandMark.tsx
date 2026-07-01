'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface BrandMarkProps {
    className?: string;
    labelClassName?: string;
}

export function BrandMark({ className, labelClassName }: BrandMarkProps) {
    return (
        <div className={cn('inline-flex items-center', className)}>
            <Image
                src="/logo.png"
                alt="Dialogy"
                width={112}
                height={29}
                priority
                className={cn('h-[25px] w-auto object-contain', labelClassName)}
            />
        </div>
    );
}
