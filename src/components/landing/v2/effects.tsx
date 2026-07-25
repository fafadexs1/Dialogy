'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Scroll plumbing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The app shell puts `h-full` on <html> and <body>, which makes <body> the
 * scrolling element instead of the document. Listening on `window` in the
 * capture phase catches scroll events from whichever element actually scrolls,
 * so these effects work without touching the global layout.
 */
function onAnyScroll(handler: () => void) {
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
        window.removeEventListener('scroll', handler, true);
        window.removeEventListener('resize', handler);
    };
}

function prefersReducedMotion() {
    return (
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/* -------------------------------------------------------------------------- */
/*  ScrollUnfold — the product shot "stands up" as it enters the viewport      */
/* -------------------------------------------------------------------------- */

export function ScrollUnfold({
    children,
    className,
    maxRotate = 16,
    minScale = 0.93,
}: {
    children: React.ReactNode;
    className?: string;
    maxRotate?: number;
    minScale?: number;
}) {
    const wrapperRef = React.useRef<HTMLDivElement>(null);
    const innerRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const inner = innerRef.current;
        const wrapper = wrapperRef.current;
        if (!inner || !wrapper) return;

        if (prefersReducedMotion()) {
            inner.style.transform = 'none';
            return;
        }

        let frame = 0;
        const update = () => {
            const rect = wrapper.getBoundingClientRect();
            const viewportHeight = window.innerHeight || 1;
            // 0 while the block sits at the bottom of the screen, 1 once its top
            // has travelled up through ~70% of the viewport.
            const progress = clamp((viewportHeight - rect.top) / (viewportHeight * 0.7));
            const eased = 1 - Math.pow(1 - progress, 3);
            inner.style.transform = `perspective(1800px) rotateX(${(1 - eased) * maxRotate}deg) scale(${
                minScale + eased * (1 - minScale)
            })`;
            inner.style.opacity = String(0.55 + eased * 0.45);
        };

        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(update);
        };

        update();
        const cleanup = onAnyScroll(schedule);
        return () => {
            cleanup();
            cancelAnimationFrame(frame);
        };
    }, [maxRotate, minScale]);

    return (
        <div ref={wrapperRef} className={className} style={{ perspective: '1800px' }}>
            <div
                ref={innerRef}
                style={{ transformOrigin: 'center top', willChange: 'transform' }}
                className="transition-[transform,opacity] duration-100 ease-out"
            >
                {children}
            </div>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Parallax — subtle depth for floating decorations                          */
/* -------------------------------------------------------------------------- */

export function Parallax({
    children,
    className,
    speed = 0.08,
}: {
    children: React.ReactNode;
    className?: string;
    speed?: number;
}) {
    const ref = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const el = ref.current;
        if (!el || prefersReducedMotion()) return;

        let frame = 0;
        const update = () => {
            const rect = el.getBoundingClientRect();
            const viewportHeight = window.innerHeight || 1;
            const offset = (rect.top + rect.height / 2 - viewportHeight / 2) * -speed;
            el.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(update);
        };

        update();
        const cleanup = onAnyScroll(schedule);
        return () => {
            cleanup();
            cancelAnimationFrame(frame);
        };
    }, [speed]);

    return (
        <div ref={ref} className={className} style={{ willChange: 'transform' }}>
            {children}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  SpotlightCard — a glow that tracks the cursor                             */
/* -------------------------------------------------------------------------- */

export function SpotlightCard({
    children,
    className,
    glow = 'rgba(25,245,178,0.22)',
    as: Tag = 'div',
}: {
    children: React.ReactNode;
    className?: string;
    glow?: string;
    as?: 'div' | 'article' | 'li';
}) {
    const ref = React.useRef<HTMLDivElement>(null);

    const handleMove = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
        el.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
        el.style.setProperty('--spot-opacity', '1');
    }, []);

    const handleLeave = React.useCallback(() => {
        ref.current?.style.setProperty('--spot-opacity', '0');
    }, []);

    return (
        <Tag
            ref={ref as never}
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
            className={cn('group/spot relative overflow-hidden', className)}
            style={
                {
                    '--spot-x': '50%',
                    '--spot-y': '50%',
                    '--spot-opacity': '0',
                } as React.CSSProperties
            }
        >
            <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300"
                style={{
                    opacity: 'var(--spot-opacity)',
                    background: `radial-gradient(340px circle at var(--spot-x) var(--spot-y), ${glow}, transparent 70%)`,
                }}
            />
            <span className="relative z-10 block h-full">{children}</span>
        </Tag>
    );
}

/* -------------------------------------------------------------------------- */
/*  Counter — counts up the first time it scrolls into view                   */
/* -------------------------------------------------------------------------- */

export function Counter({
    to,
    duration = 1600,
    decimals = 0,
    prefix = '',
    suffix = '',
    className,
}: {
    to: number;
    duration?: number;
    decimals?: number;
    prefix?: string;
    suffix?: string;
    className?: string;
}) {
    const ref = React.useRef<HTMLSpanElement>(null);
    const [value, setValue] = React.useState(0);
    const started = React.useRef(false);

    React.useEffect(() => {
        const el = ref.current;
        if (!el) return;

        if (prefersReducedMotion()) {
            setValue(to);
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries[0]?.isIntersecting || started.current) return;
                started.current = true;
                const start = performance.now();
                const tick = (now: number) => {
                    const progress = clamp((now - start) / duration);
                    const eased = 1 - Math.pow(1 - progress, 3);
                    setValue(to * eased);
                    if (progress < 1) requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
            },
            { threshold: 0.4 },
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, [to, duration]);

    return (
        <span ref={ref} className={className}>
            {prefix}
            {value.toLocaleString('pt-BR', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            })}
            {suffix}
        </span>
    );
}

/* -------------------------------------------------------------------------- */
/*  Marquee — seamless infinite strip                                          */
/* -------------------------------------------------------------------------- */

export function Marquee({
    children,
    reverse = false,
    className,
    speed = 'normal',
}: {
    children: React.ReactNode;
    reverse?: boolean;
    className?: string;
    speed?: 'slow' | 'normal';
}) {
    return (
        <div
            className={cn(
                'group/marquee relative flex overflow-hidden',
                '[mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]',
                className,
            )}
        >
            {[0, 1].map((copy) => (
                <div
                    key={copy}
                    aria-hidden={copy === 1}
                    className={cn(
                        'flex shrink-0 items-center gap-10 pr-10',
                        reverse ? 'animate-marquee-reverse' : 'animate-marquee',
                        speed === 'slow' && (reverse ? 'animate-marquee-reverse' : 'animate-marquee-slow'),
                        'group-hover/marquee:[animation-play-state:paused] motion-reduce:animate-none',
                    )}
                >
                    {children}
                </div>
            ))}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  RotatingWord — cycles through the channels in the hero                     */
/* -------------------------------------------------------------------------- */

export function RotatingWord({
    words,
    interval = 2200,
    className,
}: {
    words: Array<{ label: string; className?: string; Icon?: React.ComponentType<{ className?: string }> }>;
    interval?: number;
    className?: string;
}) {
    const [index, setIndex] = React.useState(0);

    React.useEffect(() => {
        if (prefersReducedMotion()) return;
        const id = window.setInterval(() => setIndex((i) => (i + 1) % words.length), interval);
        return () => window.clearInterval(id);
    }, [words.length, interval]);

    const current = words[index];

    return (
        <span className={cn('relative inline-flex items-center gap-2', className)}>
            <span
                key={index}
                className="inline-flex animate-in items-center gap-2 fade-in slide-in-from-bottom-2 duration-500"
            >
                {current.Icon ? (
                    <span
                        className={cn(
                            'flex h-7 w-7 items-center justify-center rounded-lg text-white',
                            current.className,
                        )}
                    >
                        <current.Icon className="h-4 w-4" />
                    </span>
                ) : null}
                <span className="font-extrabold text-slate-900">{current.label}</span>
            </span>
        </span>
    );
}
