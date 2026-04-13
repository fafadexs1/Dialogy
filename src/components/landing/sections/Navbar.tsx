'use client';

import React, { useEffect, useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import Link from 'next/link';
import { BrandMark } from '../BrandMark';

const sectionLinks = [
    { href: '#features', label: 'Beneficios' },
    { href: '#omnichannel', label: 'Canais' },
    { href: '#pricing', label: 'Precos' },
];

export function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const isMobile = useIsMobile();

    useEffect(() => {
        if (isMobile) {
            setScrolled(false);
            return;
        }

        const handleScroll = () => {
            const scrollPos = window.scrollY || document.documentElement.scrollTop;
            setScrolled(scrollPos > 12);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();

        return () => window.removeEventListener('scroll', handleScroll);
    }, [isMobile]);

    return (
        <header className={`fixed inset-x-0 top-0 z-[100] transition-all duration-300 ${scrolled ? 'py-2 md:py-3' : 'py-3 md:py-5'}`}>
            <div className="mx-auto max-w-7xl px-3 md:px-8">
                <div className={`rounded-full border bg-white px-4 py-2.5 shadow-[0_14px_32px_-24px_rgba(15,23,42,0.22)] transition-all duration-300 md:bg-white/90 md:backdrop-blur md:shadow-[0_22px_60px_-42px_rgba(15,23,42,0.45)] ${scrolled ? 'border-black/10' : 'border-black/5'}`}>
                    <div className="flex items-center justify-between gap-4">
                        <Link href="/" className="shrink-0">
                            <BrandMark
                                className="gap-2.5"
                                labelClassName="text-lg md:text-xl"
                            />
                        </Link>

                        <nav className="hidden items-center gap-8 md:flex">
                            {sectionLinks.map((item) => (
                                <a
                                    key={item.href}
                                    href={item.href}
                                    className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-950"
                                >
                                    {item.label}
                                </a>
                            ))}
                            <Link href="/developer" className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-950">
                                Developer
                            </Link>
                        </nav>

                        <div className="hidden items-center gap-3 md:flex">
                            <Link href="/login" className="rounded-full px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:text-slate-950">
                                Login
                            </Link>
                            <Link
                                href="/pricing"
                                className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-slate-800"
                            >
                                Ver planos
                                <ArrowRight className="h-4 w-4" />
                            </Link>
                        </div>

                        <button
                            type="button"
                            className="rounded-full border border-black/10 p-2 text-slate-900 md:hidden"
                            onClick={() => setMobileOpen((open) => !open)}
                            aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
                        >
                            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                        </button>
                    </div>
                </div>

                {mobileOpen && (
                    <div className="mt-2 rounded-[24px] border border-black/10 bg-white p-4 shadow-[0_20px_40px_-32px_rgba(15,23,42,0.3)] md:hidden">
                        <div className="flex flex-col gap-2">
                            {sectionLinks.map((item) => (
                                <a
                                    key={item.href}
                                    href={item.href}
                                    onClick={() => setMobileOpen(false)}
                                    className="rounded-2xl px-3 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950"
                                >
                                    {item.label}
                                </a>
                            ))}
                            <Link
                                href="/developer"
                                onClick={() => setMobileOpen(false)}
                                className="rounded-2xl px-3 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950"
                            >
                                Developer
                            </Link>
                            <div className="mt-3 flex gap-3">
                                <Link
                                    href="/login"
                                    onClick={() => setMobileOpen(false)}
                                    className="flex-1 rounded-full border border-black/10 px-4 py-3 text-center text-sm font-medium text-slate-900"
                                >
                                    Login
                                </Link>
                                <Link
                                    href="/pricing"
                                    onClick={() => setMobileOpen(false)}
                                    className="flex-1 rounded-full bg-slate-950 px-4 py-3 text-center text-sm font-semibold text-white"
                                >
                                    Ver planos
                                </Link>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </header>
    );
}
