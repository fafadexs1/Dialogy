'use client';

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Bot, Code2, Users } from "lucide-react";
import { CTAButton } from "./ui";
import { usePathname } from 'next/navigation';

export function Navbar() {
    const pathname = usePathname();
    const isHome = pathname === '/';

    return (
        <nav className="fixed top-0 w-full z-40 backdrop-blur-md border-b border-white/5 bg-black/50">
            <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                <Link href="/" className="flex items-center gap-3 group">
                    <Image src="/logo.png" alt="Dialogy" width={120} height={38} className="h-7 w-auto" />
                </Link>

                {isHome ? (
                    <div className="hidden md:flex items-center gap-8">
                        <Link href="/developer" className="text-sm font-medium text-white/70 hover:text-white transition-colors flex items-center gap-2">
                            <Code2 className="w-4 h-4" /> Desenvolvedores
                        </Link>
                        <Link href="/creators" className="text-sm font-medium text-white/70 hover:text-white transition-colors flex items-center gap-2">
                            <Users className="w-4 h-4" /> Criadores
                        </Link>
                        <Link href="#features" className="text-sm font-medium text-white/70 hover:text-white transition-colors">
                            Funcionalidades
                        </Link>
                        <Link href="/pricing" className="text-sm font-medium text-white/70 hover:text-white transition-colors">
                            Preços
                        </Link>
                    </div>
                ) : (
                    <div className="hidden md:flex items-center gap-8">
                        <Link href="/" className="text-sm font-medium text-white/70 hover:text-white transition-colors">
                            Início
                        </Link>
                        <Link href="/developer" className="text-sm font-medium text-white/70 hover:text-white transition-colors flex items-center gap-2">
                            <Code2 className="w-4 h-4" /> Desenvolvedores
                        </Link>
                        <Link href="/pricing" className="text-sm font-medium text-white/70 hover:text-white transition-colors">
                            Preços
                        </Link>
                    </div>
                )}

                <div className="flex items-center gap-4">
                    <Link href="/login" className="text-sm font-medium text-white hover:text-blue-400 transition-colors hidden sm:block">
                        Entrar
                    </Link>
                    <CTAButton href="/register" className="px-5 py-2.5 text-sm">
                        Começar Agora
                    </CTAButton>
                </div>
            </div>
        </nav>
    );
}
