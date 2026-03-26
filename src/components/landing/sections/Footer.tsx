'use client';

import React from 'react';
import Link from 'next/link';
import { BrandMark } from '../BrandMark';

export function Footer() {
    const year = new Date().getFullYear();

    return (
        <footer className="relative z-10 border-t border-black/10 bg-[#efece3] px-4 pb-10 pt-16">
            <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-4">
                <div className="md:col-span-2">
                    <BrandMark />
                    <p className="mt-5 max-w-md text-sm leading-7 text-slate-600">
                        Atendimento omnichannel, CRM e automacao em uma operacao mais simples de entender e mais facil de usar.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-3">
                        <Link href="/register" className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
                            Criar conta
                        </Link>
                        <Link href="/login" className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-white">
                            Login
                        </Link>
                    </div>
                </div>

                <div>
                    <h4 className="mb-4 font-semibold text-slate-950">Produto</h4>
                    <ul className="space-y-3 text-sm text-slate-600">
                        <li><Link href="/pricing" className="transition-colors hover:text-slate-950">Precos</Link></li>
                        <li><Link href="/autopilot" className="transition-colors hover:text-slate-950">Autopilot IA</Link></li>
                        <li><Link href="/campaigns" className="transition-colors hover:text-slate-950">Campanhas</Link></li>
                        <li><Link href="/developer" className="transition-colors hover:text-slate-950">Developer</Link></li>
                    </ul>
                </div>

                <div>
                    <h4 className="mb-4 font-semibold text-slate-950">Empresa</h4>
                    <ul className="space-y-3 text-sm text-slate-600">
                        <li><Link href="/about" className="transition-colors hover:text-slate-950">Sobre</Link></li>
                        <li><Link href="/privacy" className="transition-colors hover:text-slate-950">Privacidade</Link></li>
                        <li><Link href="/terms" className="transition-colors hover:text-slate-950">Termos</Link></li>
                        <li><a href="https://wa.me/551151994714" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-slate-950">Contato</a></li>
                    </ul>
                </div>
            </div>

            <div className="mx-auto mt-12 flex max-w-7xl flex-col items-start justify-between gap-4 border-t border-black/10 pt-8 text-xs text-slate-500 md:flex-row md:items-center">
                <div className="flex flex-col gap-1 md:flex-row md:gap-4">
                    <p>&copy; {year} Dialogy.</p>
                    <p>Klyraai Inova Simples (I.S.) - CNPJ 63.905.247/0001-77</p>
                </div>
                <div className="flex gap-6">
                    <Link href="/privacy" className="transition-colors hover:text-slate-950">Privacidade</Link>
                    <Link href="/terms" className="transition-colors hover:text-slate-950">Termos</Link>
                    <Link href="/developer" className="transition-colors hover:text-slate-950">Developer</Link>
                </div>
            </div>
        </footer>
    );
}
