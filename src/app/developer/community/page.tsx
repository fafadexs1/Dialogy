'use client';

import React from "react";
import Link from "next/link";
import { Code2, MessageCircle, Github, Twitter, Heart, Users, Sparkles } from "lucide-react";

function CommunityCard({ title, description, icon: Icon, href, color }: { title: string, description: string, icon: any, href: string, color: string }) {
    return (
        <Link href={href} className="group relative p-8 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all duration-300 hover:-translate-y-1 overflow-hidden">
            <div className={`absolute top-0 right-0 w-32 h-32 bg-${color}-500/10 blur-[60px] rounded-full pointer-events-none group-hover:bg-${color}-500/20 transition-colors`} />

            <div className={`w-12 h-12 rounded-xl bg-${color}-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                <Icon className={`w-6 h-6 text-${color}-400`} />
            </div>

            <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
            <p className="text-white/60 leading-relaxed mb-6">{description}</p>

            <span className={`text-${color}-400 text-sm font-medium flex items-center gap-2 group-hover:gap-3 transition-all`}>
                Participar <span className="text-lg">→</span>
            </span>
        </Link>
    );
}

export default function CommunityPage() {
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
                            Dialogy <span className="text-white/40 font-normal">Community</span>
                        </Link>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link href="/developer" className="text-sm font-medium text-white/60 hover:text-white">Voltar para Developer Hub</Link>
                    </div>
                </div>
            </nav>

            <main className="relative overflow-hidden">
                {/* Hero */}
                <div className="py-24 px-6 relative z-10">
                    <div className="max-w-4xl mx-auto text-center">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-400 text-xs font-medium mb-8">
                            <Heart className="w-3 h-3 fill-current" /> Junte-se a mais de 5.000 desenvolvedores
                        </div>
                        <h1 className="text-5xl md:text-7xl font-bold mb-8 tracking-tight">
                            Construa melhor, <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-400">juntos.</span>
                        </h1>
                        <p className="text-xl text-white/60 mb-12 leading-relaxed max-w-2xl mx-auto">
                            A comunidade Dialogy é o lugar onde desenvolvedores, criadores e entusiastas de IA se reúnem para compartilhar conhecimento, resolver problemas e mostrar o que estão construindo.
                        </p>
                    </div>
                </div>

                {/* Cards */}
                <div className="max-w-7xl mx-auto px-6 pb-24">
                    <div className="grid md:grid-cols-3 gap-6">
                        <CommunityCard
                            title="Discord"
                            description="Converse em tempo real com outros desenvolvedores e a equipe do Dialogy. Obtenha ajuda rápida e compartilhe suas ideias."
                            icon={MessageCircle}
                            href="#"
                            color="blue"
                        />
                        <CommunityCard
                            title="GitHub"
                            description="Contribua para nossos SDKs open-source, relate bugs e sugira novos recursos diretamente em nossos repositórios."
                            icon={Github}
                            href="#"
                            color="gray"
                        />
                        <CommunityCard
                            title="Twitter / X"
                            description="Fique por dentro das últimas atualizações, dicas e destaques da comunidade. Siga-nos para não perder nada."
                            icon={Twitter}
                            href="#"
                            color="sky"
                        />
                    </div>
                </div>

                {/* Showcase */}
                <div className="border-t border-white/10 py-24 bg-[#0f172a]/30">
                    <div className="max-w-7xl mx-auto px-6">
                        <div className="flex items-center justify-between mb-12">
                            <h2 className="text-3xl font-bold">Showcase da Comunidade</h2>
                            <Link href="#" className="text-blue-400 font-medium hover:text-blue-300 transition-colors">
                                Ver todos os projetos →
                            </Link>
                        </div>

                        <div className="grid md:grid-cols-2 gap-8">
                            {[
                                { title: "Chatbot de Atendimento", author: "Empresa X", desc: "Automatizando 80% do suporte ao cliente com Dialogy." },
                                { title: "Assistente de Viagens", author: "Dev Y", desc: "Um guia de viagens personalizado que usa nossa API de localização." },
                            ].map((project, i) => (
                                <div key={i} className="p-6 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-all">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600" />
                                        <div>
                                            <h3 className="font-bold text-white">{project.title}</h3>
                                            <p className="text-xs text-white/40">por {project.author}</p>
                                        </div>
                                    </div>
                                    <p className="text-white/60 text-sm">{project.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
