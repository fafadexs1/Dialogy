'use client';

import React from "react";
import Link from "next/link";
import {
    Book, Code2, Terminal, Share2, Zap, Shield,
    Search, ChevronRight, FileText, Box, Layers
} from "lucide-react";

const primary = "#3b82f6";

function Card({ title, description, icon: Icon, href }: { title: string, description: string, icon: any, href: string }) {
    return (
        <Link href={href} className="group relative p-6 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all duration-300 hover:-translate-y-1">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Icon className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                {title} <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-blue-400" />
            </h3>
            <p className="text-sm text-white/60">{description}</p>
        </Link>
    );
}

export default function DeveloperPage() {
    return (
        <div className="min-h-screen bg-[#030712] text-white selection:bg-blue-500/30">
            {/* Navbar */}
            <nav className="border-b border-white/10 bg-[#030712]/50 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        <Link href="/" className="font-bold text-xl tracking-tight flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                                <Code2 className="w-5 h-5 text-white" />
                            </div>
                            Dialogy <span className="text-white/40 font-normal">Developers</span>
                        </Link>
                        <div className="hidden md:flex items-center gap-6 text-sm font-medium text-white/60">
                            <Link href="/developer/docs" className="hover:text-white transition-colors">Documentação</Link>
                            <Link href="/developer/api" className="hover:text-white transition-colors">Referência da API</Link>
                            <Link href="/developer/sdks" className="hover:text-white transition-colors">SDKs</Link>
                            <Link href="/developer/community" className="hover:text-white transition-colors">Comunidade</Link>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="relative hidden md:block">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                            <input
                                type="text"
                                placeholder="Buscar docs..."
                                className="bg-white/5 border border-white/10 rounded-full py-1.5 pl-9 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-64"
                            />
                        </div>
                        <Link href="/login" className="text-sm font-medium hover:text-blue-400">Dashboard</Link>
                    </div>
                </div>
            </nav>

            {/* Hero */}
            <header className="py-20 border-b border-white/5 relative overflow-hidden">
                <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-20" />
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />

                <div className="max-w-7xl mx-auto px-6 relative z-10">
                    <div className="max-w-3xl">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-6">
                            <Terminal className="w-3 h-3" /> API v2.0 já está disponível
                        </div>
                        <h1 className="text-5xl font-bold mb-6 tracking-tight">
                            Construa o futuro das <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-400">experiências conversacionais.</span>
                        </h1>
                        <p className="text-xl text-white/60 mb-10 leading-relaxed max-w-2xl">
                            Tudo o que você precisa para integrar o Dialogy em suas aplicações.
                            Guias abrangentes, APIs poderosas e SDKs robustos para ajudar você a entregar mais rápido.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <Link href="/developer/docs" className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors text-center">
                                Ler a Documentação
                            </Link>
                            <button className="px-6 py-3 rounded-lg border border-white/10 hover:bg-white/5 text-white font-semibold transition-colors">
                                Obter Chave de API
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Content Grid */}
            <main className="max-w-7xl mx-auto px-6 py-20">
                <div className="grid md:grid-cols-3 gap-8 mb-20">
                    <Card
                        title="Guia de Início Rápido"
                        description="Coloque seu primeiro chatbot no ar em menos de 5 minutos."
                        icon={Zap}
                        href="/developer/docs"
                    />
                    <Card
                        title="Referência da API"
                        description="Endpoints detalhados, parâmetros e exemplos de resposta."
                        icon={Book}
                        href="/developer/api"
                    />
                    <Card
                        title="SDKs & Bibliotecas"
                        description="Bibliotecas oficiais para Node.js, Python, Go e mais."
                        icon={Box}
                        href="/developer/sdks"
                    />
                </div>

                <div className="grid md:grid-cols-2 gap-16">
                    <div>
                        <h2 className="text-2xl font-bold mb-6">Tópicos Populares</h2>
                        <div className="space-y-4">
                            {[
                                { title: "Autenticação", icon: Shield },
                                { title: "Webhooks", icon: Share2 },
                                { title: "Tipos de Mensagem", icon: MessagesSquare },
                                { title: "Limites de Taxa", icon: Layers },
                            ].map((item, i) => (
                                <Link key={i} href="#" className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 hover:bg-white/10 transition-all group">
                                    <div className="flex items-center gap-4">
                                        <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center">
                                            <item.icon className="w-4 h-4 text-white/70" />
                                        </div>
                                        <span className="font-medium text-white/90">{item.title}</span>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-white/30 group-hover:text-white transition-colors" />
                                </Link>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h2 className="text-2xl font-bold mb-6">Snippet de Código</h2>
                        <div className="rounded-xl bg-[#0f172a] border border-white/10 overflow-hidden shadow-2xl">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5">
                                <span className="text-xs font-mono text-white/50">send-message.js</span>
                                <div className="flex gap-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/20" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/20" />
                                </div>
                            </div>
                            <div className="p-6 overflow-x-auto">
                                <pre className="font-mono text-sm leading-relaxed">
                                    <span className="text-purple-400">const</span> <span className="text-blue-400">dialogy</span> = <span className="text-purple-400">require</span>(<span className="text-green-400">'dialogy-node'</span>);{'\n\n'}
                                    <span className="text-white/50">// Inicializar cliente</span>{'\n'}
                                    <span className="text-purple-400">const</span> client = <span className="text-purple-400">new</span> <span className="text-yellow-400">Client</span>(process.env.API_KEY);{'\n\n'}
                                    <span className="text-white/50">// Enviar uma mensagem de texto</span>{'\n'}
                                    <span className="text-purple-400">await</span> client.messages.<span className="text-blue-400">create</span>({'{'}{'\n'}
                                    {'  '}to: <span className="text-green-400">'+1234567890'</span>,{'\n'}
                                    {'  '}text: <span className="text-green-400">'Olá mundo!'</span>{'\n'}
                                    {'}'});
                                </pre>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            <footer className="border-t border-white/10 py-12 bg-[#020617]">
                <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-2 text-white/40 text-sm">
                        <Code2 className="w-4 h-4" />
                        <span>Construído por desenvolvedores para desenvolvedores</span>
                    </div>
                    <div className="flex gap-6 text-sm text-white/60">
                        <Link href="#" className="hover:text-white">Status</Link>
                        <Link href="#" className="hover:text-white">GitHub</Link>
                        <Link href="#" className="hover:text-white">Twitter</Link>
                        <Link href="#" className="hover:text-white">Discord</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}

// Helper icon component
function MessagesSquare(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2v5Z" />
            <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
        </svg>
    )
}
