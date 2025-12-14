'use client';

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Bot } from "lucide-react";
import { Section } from "./ui";

export function Footer() {
    return (
        <footer className="border-t border-white/10 bg-[#020617] pt-20 pb-10">
            <Section>
                <div className="grid md:grid-cols-4 gap-12 mb-16">
                    <div className="col-span-1 md:col-span-2">
                        <Link href="/" className="flex items-center gap-2 mb-6">
                            <Image src="/logo.png" alt="Dialogy" width={150} height={48} className="h-10 w-auto" />
                        </Link>
                        <p className="text-white/50 max-w-sm leading-relaxed">
                            A plataforma de IA conversacional mais avançada para empresas modernas.
                            Conecte, automatize e cresça com Dialogy.
                        </p>
                    </div>
                    <div>
                        <h4 className="text-white font-semibold mb-6">Produto</h4>
                        <ul className="space-y-4 text-white/60">
                            <li><Link href="/#features" className="hover:text-blue-400 transition-colors">Funcionalidades</Link></li>
                            <li><Link href="/pricing" className="hover:text-blue-400 transition-colors">Preços</Link></li>
                            <li><Link href="/integrations" className="hover:text-blue-400 transition-colors">Integrações</Link></li>
                            <li><Link href="/changelog" className="hover:text-blue-400 transition-colors">Changelog</Link></li>
                        </ul>
                    </div>
                    <div>
                        <h4 className="text-white font-semibold mb-6">Recursos</h4>
                        <ul className="space-y-4 text-white/60">
                            <li><Link href="/developer" className="hover:text-blue-400 transition-colors">Wiki do Desenvolvedor</Link></li>
                            <li><Link href="/creators" className="hover:text-blue-400 transition-colors">Criadores</Link></li>
                            <li><Link href="/blog" className="hover:text-blue-400 transition-colors">Blog</Link></li>
                            <li><Link href="/support" className="hover:text-blue-400 transition-colors">Suporte</Link></li>
                        </ul>
                    </div>
                </div>
                <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-white/40">
                    <p>© {new Date().getFullYear()} Dialogy Inc. Todos os direitos reservados.</p>
                    <div className="flex gap-6">
                        <Link href="/privacy" className="hover:text-white transition-colors">Política de Privacidade</Link>
                        <Link href="/terms" className="hover:text-white transition-colors">Termos de Serviço</Link>
                    </div>
                </div>
            </Section>
        </footer>
    );
}
