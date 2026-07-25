'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { LanguageToggle } from '@/components/ui/language-toggle';
import { MenuToggleIcon } from '@/components/ui/menu-toggle-icon';
import { DialogyLogo, CtaPrimary } from './brand';

const NAV_LINKS = [
    { label: 'Canais', href: '/#canais' },
    { label: 'Plataforma', href: '/#plataforma' },
    { label: 'IA', href: '/#ia' },
    { label: 'Integrações', href: '/#integracoes' },
    { label: 'Planos', href: '/#planos' },
    { label: 'Dúvidas', href: '/#faq' },
];

export function SiteHeader() {
    const [open, setOpen] = React.useState(false);
    const [scrolled, setScrolled] = React.useState(false);
    const progressRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        // The app shell makes <body> the scrolling element, so listen in the
        // capture phase to catch scroll from whichever element actually moves.
        let frame = 0;
        const update = () => {
            const scroller = document.scrollingElement ?? document.documentElement;
            const top = Math.max(scroller.scrollTop, document.body.scrollTop);
            const height = Math.max(scroller.scrollHeight, document.body.scrollHeight);
            const max = height - window.innerHeight;
            setScrolled(top > 8);
            if (progressRef.current) {
                progressRef.current.style.transform = `scaleX(${max > 0 ? Math.min(top / max, 1) : 0})`;
            }
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(update);
        };

        update();
        window.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        return () => {
            window.removeEventListener('scroll', schedule, true);
            window.removeEventListener('resize', schedule);
            cancelAnimationFrame(frame);
        };
    }, []);

    React.useEffect(() => {
        document.body.style.overflow = open ? 'hidden' : '';
        return () => {
            document.body.style.overflow = '';
        };
    }, [open]);

    return (
        <header
            className={cn(
                'sticky top-0 z-50 w-full transition-all duration-300',
                scrolled
                    ? 'border-b border-slate-200/80 bg-white/85 backdrop-blur-xl'
                    : 'border-b border-transparent bg-white',
            )}
        >
            <nav className="mx-auto flex h-[68px] w-full max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
                <Link href="/" className="shrink-0 transition-opacity hover:opacity-70">
                    <DialogyLogo />
                </Link>

                <div className="hidden flex-1 items-center justify-center gap-1 lg:flex">
                    {NAV_LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="rounded-full px-4 py-2 text-[0.925rem] font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        >
                            {link.label}
                        </Link>
                    ))}
                </div>

                <div className="ml-auto flex items-center gap-2 sm:gap-3">
                    <LanguageToggle />
                    <Link
                        href="/login"
                        className="hidden rounded-full px-4 py-2 text-[0.925rem] font-semibold text-slate-600 transition-colors hover:text-slate-900 sm:block"
                    >
                        Entrar
                    </Link>
                    <CtaPrimary href="/register" className="hidden sm:inline-flex">
                        Testar grátis
                    </CtaPrimary>
                    <button
                        type="button"
                        onClick={() => setOpen((value) => !value)}
                        aria-expanded={open}
                        aria-controls="mobile-nav"
                        aria-label="Abrir menu"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-900 transition-colors hover:bg-slate-100 lg:hidden"
                    >
                        <MenuToggleIcon open={open} className="size-6" duration={300} />
                    </button>
                </div>
            </nav>

            {/* Scroll progress */}
            <div
                ref={progressRef}
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-[3px] origin-left scale-x-0 bg-gradient-to-r from-brand-green via-blue-400 to-violet-500"
            />

            {open ? (
                <div
                    id="mobile-nav"
                    className="fixed inset-x-0 bottom-0 top-[68px] z-40 flex flex-col gap-2 overflow-y-auto bg-white px-5 pb-10 pt-4 lg:hidden"
                >
                    {NAV_LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            onClick={() => setOpen(false)}
                            className="rounded-2xl px-4 py-3.5 text-lg font-bold text-slate-900 transition-colors hover:bg-slate-50"
                        >
                            {link.label}
                        </Link>
                    ))}
                    <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-6">
                        <Link
                            href="/login"
                            onClick={() => setOpen(false)}
                            className="inline-flex h-12 items-center justify-center rounded-full border border-slate-200 font-bold text-slate-900"
                        >
                            Entrar
                        </Link>
                        <CtaPrimary href="/register" size="lg" className="w-full">
                            Testar grátis por 7 dias
                        </CtaPrimary>
                    </div>
                </div>
            ) : null}
        </header>
    );
}
