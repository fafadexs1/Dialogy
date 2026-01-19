'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Menu, X, Code2, Users, User } from 'lucide-react';
import Link from 'next/link';

export function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [showLoginText, setShowLoginText] = useState(true);

    useEffect(() => {
        const handleScroll = () => {
            const scrollPos = window.scrollY || document.documentElement.scrollTop;
            setScrolled(scrollPos > 10);
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        // Initial check on mount
        handleScroll();
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Collapse login text after 3 seconds
    useEffect(() => {
        const timer = setTimeout(() => {
            setShowLoginText(false);
        }, 3500);
        return () => clearTimeout(timer);
    }, []);

    return (
        <motion.nav
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-300 ${scrolled
                ? 'bg-black/95 border-b border-white/10 py-3 shadow-2xl shadow-black/50'
                : 'bg-black/40 backdrop-blur-md py-6 border-b border-white/5'
                }`}
        >
            <div className="max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between">
                <div className="flex items-center">
                    <img
                        src="/logo.png"
                        alt="Dialogy Logo"
                        className="h-6 md:h-8 w-auto object-contain"
                    />
                </div>

                {/* Desktop Menu */}
                <div className="hidden md:flex items-center gap-8">
                    <a href="/developer" className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-white transition-colors">
                        <Code2 size={14} />
                        Desenvolvedores
                    </a>
                    <a href="/creators" className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-white transition-colors">
                        <Users size={14} />
                        Criadores
                    </a>
                    <a href="#features" className="text-sm font-medium text-gray-300 hover:text-white transition-colors">Funcionalidades</a>
                    <a href="/pricing" className="text-sm font-medium text-gray-300 hover:text-white transition-colors">Preços</a>
                </div>

                {/* CTA */}
                <div className="hidden md:flex items-center gap-4">
                    <a href="/login" className="text-sm font-medium text-white hover:text-brand-green transition-colors">Login</a>
                    <a href="/pricing" className="px-5 py-2 bg-white text-black text-sm font-semibold rounded-lg hover:bg-gray-100 hover:shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all">
                        Começar Agora
                    </a>
                </div>

                {/* Mobile Login + Toggle */}
                <div className="md:hidden flex items-center gap-3">
                    <Link
                        href="/login"
                        className="relative flex items-center gap-2 px-3 py-2 rounded-full bg-gradient-to-r from-brand-green/20 to-brand-green/10 border border-brand-green/30 text-brand-green hover:from-brand-green/30 hover:to-brand-green/20 hover:border-brand-green/50 transition-all duration-500 group overflow-hidden"
                    >
                        <User className="w-4 h-4 flex-shrink-0" />
                        <span
                            className={`text-sm font-medium whitespace-nowrap overflow-hidden transition-all duration-500 ease-out ${showLoginText ? 'max-w-[60px] opacity-100' : 'max-w-0 opacity-0'
                                }`}
                        >
                            Login
                        </span>
                        {/* Shimmer effect */}
                        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-shimmer" />
                    </Link>
                    <button className="text-white p-2" onClick={() => setMobileOpen(!mobileOpen)}>
                        {mobileOpen ? <X /> : <Menu />}
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            {mobileOpen && (
                <div className="absolute top-full left-0 w-full bg-[#050507] border-b border-white/10 p-4 flex flex-col gap-4 md:hidden animate-in slide-in-from-top-2">
                    <a href="/developer" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 text-gray-300 py-2">
                        <Code2 size={16} /> Desenvolvedores
                    </a>
                    <a href="/creators" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 text-gray-300 py-2">
                        <Users size={16} /> Criadores
                    </a>
                    <a href="#features" onClick={() => setMobileOpen(false)} className="text-gray-300 py-2">Funcionalidades</a>
                    <a href="/pricing" onClick={() => setMobileOpen(false)} className="text-gray-300 py-2">Preços</a>
                    <a href="/pricing" onClick={() => setMobileOpen(false)} className="w-full py-3 bg-white text-black font-bold text-center rounded-lg">Começar Agora</a>
                </div>
            )}

            {/* Bottom neon line on scroll */}
            <div className={`absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-brand-green/50 to-transparent transition-opacity duration-300 ${scrolled ? 'opacity-100' : 'opacity-0'}`} />
        </motion.nav>
    );
}

