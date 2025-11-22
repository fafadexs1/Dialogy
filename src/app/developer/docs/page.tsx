'use client';

import React from "react";
import Link from "next/link";
import { Book, ChevronRight, Code2, FileText, Key, Shield, Terminal, Zap } from "lucide-react";

export default function DocsPage() {
    return (
        <div className="min-h-screen bg-[#030712] text-white selection:bg-blue-500/30">
            {/* Navbar */}
            <nav className="border-b border-white/10 bg-[#030712]/50 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        <Link href="/developer" className="font-bold text-xl tracking-tight flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                                <Code2 className="w-5 h-5 text-white" />
                            </div>
                            Dialogy <span className="text-white/40 font-normal">Docs</span>
                        </Link>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link href="/developer" className="text-sm font-medium text-white/60 hover:text-white">Voltar para Developer Hub</Link>
                    </div>
                </div>
            </nav>

            <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row gap-12">
                {/* Sidebar */}
                <aside className="w-full md:w-64 shrink-0 space-y-8">
                    <div>
                        <h3 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-4">Começando</h3>
                        <div className="space-y-1">
                            <Link href="#" className="block px-3 py-2 rounded-lg bg-blue-600/10 text-blue-400 font-medium text-sm">Introdução</Link>
                            <Link href="#" className="block px-3 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors text-sm">Autenticação</Link>
                            <Link href="#" className="block px-3 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors text-sm">Primeiros Passos</Link>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-4">Guias</h3>
                        <div className="space-y-1">
                            <Link href="#" className="block px-3 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors text-sm">Mensagens</Link>
                            <Link href="#" className="block px-3 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors text-sm">Webhooks</Link>
                            <Link href="#" className="block px-3 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors text-sm">Contatos</Link>
                        </div>
                    </div>
                </aside>

                {/* Main Content */}
                <main className="flex-1 max-w-3xl">
                    <div className="mb-12">
                        <h1 className="text-4xl font-bold mb-6">Documentação do Dialogy</h1>
                        <p className="text-xl text-white/60 leading-relaxed">
                            Bem-vindo à documentação oficial do Dialogy. Aqui você encontrará tudo o que precisa para integrar nossa plataforma de IA conversacional em seus aplicativos.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6 mb-12">
                        <div className="p-6 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors">
                            <Zap className="w-8 h-8 text-yellow-400 mb-4" />
                            <h3 className="text-lg font-semibold mb-2">Início Rápido</h3>
                            <p className="text-sm text-white/60 mb-4">Aprenda a enviar sua primeira mensagem em menos de 5 minutos.</p>
                            <Link href="#" className="text-blue-400 text-sm font-medium flex items-center gap-1 hover:gap-2 transition-all">
                                Começar agora <ChevronRight className="w-4 h-4" />
                            </Link>
                        </div>
                        <div className="p-6 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors">
                            <Key className="w-8 h-8 text-green-400 mb-4" />
                            <h3 className="text-lg font-semibold mb-2">Autenticação</h3>
                            <p className="text-sm text-white/60 mb-4">Entenda como gerar e usar suas chaves de API com segurança.</p>
                            <Link href="#" className="text-blue-400 text-sm font-medium flex items-center gap-1 hover:gap-2 transition-all">
                                Ler guia <ChevronRight className="w-4 h-4" />
                            </Link>
                        </div>
                    </div>

                    <div className="prose prose-invert max-w-none">
                        <h2 className="text-2xl font-bold mb-4">Por que usar o Dialogy?</h2>
                        <p className="text-white/60 mb-6">
                            O Dialogy oferece uma API unificada para comunicação multicanal, permitindo que você alcance seus usuários onde quer que eles estejam. Com suporte nativo para IA, você pode criar experiências conversacionais ricas e automatizadas.
                        </p>

                        <h3 className="text-xl font-bold mb-4">Recursos Principais</h3>
                        <ul className="space-y-2 text-white/60 mb-8">
                            <li className="flex items-center gap-2"><Shield className="w-4 h-4 text-blue-400" /> Segurança de nível empresarial</li>
                            <li className="flex items-center gap-2"><Terminal className="w-4 h-4 text-blue-400" /> SDKs para as linguagens mais populares</li>
                            <li className="flex items-center gap-2"><Zap className="w-4 h-4 text-blue-400" /> Baixa latência e alta disponibilidade</li>
                        </ul>
                    </div>
                </main>
            </div>
        </div>
    );
}
