'use client';

import { cn } from '@/lib/utils';
import { Zap } from 'lucide-react';

interface LeadScoreBadgeProps {
    score: number | undefined | null;
    size?: 'sm' | 'md';
    className?: string;
}

function getScoreColor(score: number) {
    if (score >= 61) return { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-emerald-500/20' };
    if (score >= 31) return { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', glow: 'shadow-amber-500/20' };
    return { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30', glow: 'shadow-red-500/20' };
}

function getScoreLabel(score: number) {
    if (score >= 80) return 'Quente';
    if (score >= 61) return 'Morno';
    if (score >= 31) return 'Frio';
    return 'Gelado';
}

export default function LeadScoreBadge({ score, size = 'sm', className }: LeadScoreBadgeProps) {
    if (score == null || score === undefined) return null;

    const colors = getScoreColor(score);
    const label = getScoreLabel(score);

    if (size === 'sm') {
        return (
            <div
                className={cn(
                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold tabular-nums',
                    colors.bg, colors.text, colors.border,
                    className
                )}
                title={`Lead Score: ${score} (${label})`}
            >
                <Zap className="h-2.5 w-2.5" />
                {score}
            </div>
        );
    }

    // size === 'md'
    return (
        <div
            className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold tabular-nums shadow-sm',
                colors.bg, colors.text, colors.border,
                className
            )}
            title={`Lead Score: ${score} (${label})`}
        >
            <Zap className="h-3 w-3" />
            <span>{score}</span>
            <span className="text-[9px] font-medium opacity-60 uppercase">{label}</span>
        </div>
    );
}

export { getScoreColor, getScoreLabel };
