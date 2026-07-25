import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Design tokens (light landing)                                             */
/* -------------------------------------------------------------------------- */
/*
 * Canvas    : white
 * Ink       : slate-950 / slate-600 for body copy
 * Signature : brand-green (#19F5B2) — always used as a FILL with ink text on
 *             top, never as text on white (contrast is too low).
 * Accents   : emerald / violet / blue / amber / rose at the 500-600 range with
 *             their own -50/-100 tints. One accent per card keeps the page
 *             colourful without turning into confetti.
 */

export const ACCENTS = {
    emerald: {
        soft: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
        solid: 'bg-emerald-500',
        text: 'text-emerald-600',
        glow: 'bg-emerald-300/40',
    },
    violet: {
        soft: 'bg-violet-50 text-violet-600 ring-violet-100',
        solid: 'bg-violet-500',
        text: 'text-violet-600',
        glow: 'bg-violet-300/40',
    },
    blue: {
        soft: 'bg-blue-50 text-blue-600 ring-blue-100',
        solid: 'bg-blue-500',
        text: 'text-blue-600',
        glow: 'bg-blue-300/40',
    },
    amber: {
        soft: 'bg-amber-50 text-amber-600 ring-amber-100',
        solid: 'bg-amber-500',
        text: 'text-amber-600',
        glow: 'bg-amber-300/40',
    },
    rose: {
        soft: 'bg-rose-50 text-rose-600 ring-rose-100',
        solid: 'bg-rose-500',
        text: 'text-rose-600',
        glow: 'bg-rose-300/40',
    },
} as const;

export type AccentName = keyof typeof ACCENTS;

/* -------------------------------------------------------------------------- */
/*  Logo                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Light-theme version of the Dialogy mark: two nested speech bubbles.
 * The shipped PNG is a white wordmark built for dark backgrounds, so the mark
 * is redrawn here as inline SVG and the wordmark as type — both then follow
 * whatever `tone` the surface needs.
 */
export function DialogyMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 100 100" className={cn('h-8 w-8', className)} aria-hidden="true">
            <path
                d="M34 73.7 A32 32 0 1 0 18.7 52.7 L 9 89 Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="9"
                strokeLinejoin="round"
            />
            <path
                d="M41.3 61.2 A17.5 17.5 0 1 0 32.9 49.6 L 27 71 Z"
                fill="none"
                stroke="#19F5B2"
                strokeWidth="8"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export function DialogyLogo({
    className,
    tone = 'ink',
}: {
    className?: string;
    tone?: 'ink' | 'light';
}) {
    return (
        <span className={cn('inline-flex items-center gap-2', className)}>
            <DialogyMark className={cn('h-7 w-7', tone === 'ink' ? 'text-slate-900' : 'text-white')} />
            <span
                className={cn(
                    'text-[1.35rem] font-extrabold tracking-tight',
                    tone === 'ink' ? 'text-slate-900' : 'text-white',
                )}
            >
                Dialogy
            </span>
        </span>
    );
}

/* -------------------------------------------------------------------------- */
/*  Buttons                                                                   */
/* -------------------------------------------------------------------------- */

type CtaProps = {
    href: string;
    children: React.ReactNode;
    className?: string;
    size?: 'md' | 'lg';
};

const sizes = {
    md: 'h-11 px-5 text-[0.95rem] whitespace-nowrap',
    lg: 'h-14 px-7 text-base whitespace-nowrap sm:text-lg',
};

/** Primary action — ink pill that flips to the signature mint on hover. */
export function CtaPrimary({ href, children, className, size = 'md' }: CtaProps) {
    return (
        <Link
            href={href}
            className={cn(
                'group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full',
                'bg-slate-900 font-bold text-white shadow-[0_10px_30px_-12px_rgba(15,23,42,0.6)]',
                'transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-14px_rgba(15,23,42,0.55)]',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/15',
                sizes[size],
                className,
            )}
        >
            <span className="absolute inset-0 translate-y-full bg-brand-green transition-transform duration-300 ease-out group-hover:translate-y-0" />
            <span className="relative z-10 flex items-center gap-2 transition-colors duration-300 group-hover:text-slate-900">
                {children}
            </span>
        </Link>
    );
}

/** Signature action for dark surfaces — mint pill with ink text. */
export function CtaMint({ href, children, className, size = 'md' }: CtaProps) {
    return (
        <Link
            href={href}
            className={cn(
                'group inline-flex items-center justify-center gap-2 rounded-full bg-brand-green font-bold text-slate-900',
                'shadow-[0_18px_45px_-18px_rgba(25,245,178,0.75)] transition-all duration-300',
                'hover:-translate-y-0.5 hover:brightness-105',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-green/30',
                sizes[size],
                className,
            )}
        >
            {children}
        </Link>
    );
}

/** Secondary action — outlined pill on white. */
export function CtaSecondary({ href, children, className, size = 'md' }: CtaProps) {
    return (
        <Link
            href={href}
            className={cn(
                'inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white font-bold text-slate-900',
                'shadow-[0_2px_0_0_rgba(15,23,42,0.04)] transition-all duration-200',
                'hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/10',
                sizes[size],
                className,
            )}
        >
            {children}
        </Link>
    );
}

/* -------------------------------------------------------------------------- */
/*  Section helpers                                                           */
/* -------------------------------------------------------------------------- */

export function Eyebrow({
    children,
    accent = 'emerald',
    className,
}: {
    children: React.ReactNode;
    accent?: AccentName;
    className?: string;
}) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.14em] ring-1',
                ACCENTS[accent].soft,
                className,
            )}
        >
            {children}
        </span>
    );
}

export function SectionHeading({
    eyebrow,
    accent = 'emerald',
    title,
    description,
    align = 'center',
    className,
}: {
    eyebrow?: React.ReactNode;
    accent?: AccentName;
    title: React.ReactNode;
    description?: React.ReactNode;
    align?: 'center' | 'left';
    className?: string;
}) {
    return (
        <div
            className={cn(
                'max-w-3xl',
                align === 'center' ? 'mx-auto text-center' : 'text-left',
                className,
            )}
        >
            {eyebrow ? (
                <Eyebrow accent={accent} className="mb-5">
                    {eyebrow}
                </Eyebrow>
            ) : null}
            <h2 className="text-balance text-3xl font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-4xl md:text-5xl">
                {title}
            </h2>
            {description ? (
                <p className="mt-5 text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
                    {description}
                </p>
            ) : null}
        </div>
    );
}

const MARK_TONES = {
    mint: 'rgba(25, 245, 178, 0.5)',
    blue: 'rgba(191, 219, 254, 0.95)',
    violet: 'rgba(221, 214, 254, 0.95)',
    rose: 'rgba(254, 205, 211, 0.95)',
    amber: 'rgba(253, 230, 138, 0.95)',
} as const;

export type MarkTone = keyof typeof MARK_TONES;

/**
 * Signature marker-pen highlight behind a word. Painted as a background
 * gradient rather than an absolutely positioned bar so it survives line
 * breaks — headings wrap freely on narrow screens.
 */
export function Mark({
    children,
    tone = 'mint',
    className,
}: {
    children: React.ReactNode;
    tone?: MarkTone;
    className?: string;
}) {
    const color = MARK_TONES[tone];
    return (
        <span
            className={cn('-mx-1 px-1 [-webkit-box-decoration-break:clone] [box-decoration-break:clone]', className)}
            style={{
                backgroundImage: `linear-gradient(to top, ${color} 0%, ${color} 36%, transparent 36%)`,
            }}
        >
            {children}
        </span>
    );
}
