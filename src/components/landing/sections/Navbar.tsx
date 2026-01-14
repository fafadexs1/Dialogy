'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Menu, X, Code2, Users } from 'lucide-react';

export function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

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

                {/* Mobile Toggle */}
                <button className="md:hidden text-white" onClick={() => setMobileOpen(!mobileOpen)}>
                    {mobileOpen ? <X /> : <Menu />}
                </button>
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
