'use client';

import React from "react";
import { motion } from "framer-motion";
import { Github, Linkedin, Twitter, Mail, Globe, Award, Code, Cpu, Sparkles } from "lucide-react";
import Link from "next/link";

const primary = "#3b82f6";

function SocialLink({ href, icon: Icon }: { href: string, icon: any }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 hover:scale-110 transition-all duration-300"
        >
            <Icon className="w-5 h-5" />
        </a>
    );
}

function SkillBadge({ children }: { children: React.ReactNode }) {
    return (
        <span className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium">
            {children}
        </span>
    );
}

export default function CreatorsPage() {
    return (
        <div className="min-h-screen bg-[#020617] text-white selection:bg-blue-500/30 flex flex-col">
            {/* Navbar */}
            <nav className="absolute top-0 w-full p-6 z-50 flex justify-between items-center">
                <Link href="/" className="text-white/50 hover:text-white transition-colors font-medium">
                    ← Voltar para Home
                </Link>
            </nav>

            <main className="flex-1 flex items-center justify-center relative overflow-hidden py-20 px-6">
                {/* Background Elements */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-600/10 blur-[120px] rounded-full" />
                    <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-purple-600/10 blur-[100px] rounded-full" />
                </div>

                <div className="max-w-5xl w-full relative z-10">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8 }}
                        className="grid md:grid-cols-5 gap-12 items-center"
                    >
                        {/* Profile Image Section */}
                        <div className="md:col-span-2 flex justify-center md:justify-end">
                            <div className="relative group">
                                <div className="absolute -inset-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full blur-2xl opacity-40 group-hover:opacity-60 transition-opacity duration-500" />
                                <div className="relative w-64 h-64 md:w-80 md:h-80 rounded-full overflow-hidden border-4 border-white/10 shadow-2xl">
                                    {/* Real image of Fabricio */}
                                    <img src="/fabricio.jpg" alt="Fabricio de Sousa Soares" className="w-full h-full object-cover" />
                                </div>
                                <div className="absolute bottom-4 right-4 bg-[#0f172a] border border-white/10 p-3 rounded-2xl shadow-xl flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                                    <span className="text-xs font-medium text-white/80">Disponível para projetos</span>
                                </div>
                            </div>
                        </div>

                        {/* Content Section */}
                        <div className="md:col-span-3 text-center md:text-left">
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.3, duration: 0.8 }}
                            >
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/60 text-xs font-medium mb-6">
                                    <Sparkles className="w-3 h-3 text-yellow-400" /> Criador & Idealizador
                                </div>

                                <h1 className="text-5xl md:text-7xl font-bold mb-4 tracking-tight">
                                    Fabricio <br />
                                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                                        de Sousa Soares
                                    </span>
                                </h1>

                                <p className="text-xl text-white/60 mb-8 leading-relaxed max-w-lg mx-auto md:mx-0">
                                    Desenvolvedor visionário e arquiteto por trás do Dialogy. Apaixonado por construir soluções de IA escaláveis e experiências de usuário intuitivas.
                                </p>

                                <div className="flex flex-wrap justify-center md:justify-start gap-2 mb-10">
                                    <SkillBadge>Desenvolvimento Fullstack</SkillBadge>
                                    <SkillBadge>IA & Machine Learning</SkillBadge>
                                    <SkillBadge>Arquitetura de Sistemas</SkillBadge>
                                    <SkillBadge>UI/UX Design</SkillBadge>
                                    <SkillBadge>Estratégia de Produto</SkillBadge>
                                </div>

                                <div className="flex items-center justify-center md:justify-start gap-4">
                                    <SocialLink href="https://github.com" icon={Github} />
                                    <SocialLink href="https://linkedin.com" icon={Linkedin} />
                                    <SocialLink href="https://twitter.com" icon={Twitter} />
                                    <SocialLink href="mailto:contact@example.com" icon={Mail} />
                                    <div className="h-8 w-px bg-white/10 mx-2" />
                                    <Link href="/portfolio" className="text-sm font-medium text-blue-400 hover:text-blue-300 flex items-center gap-1">
                                        Ver Portfólio <Globe className="w-4 h-4" />
                                    </Link>
                                </div>
                            </motion.div>
                        </div>
                    </motion.div>

                    {/* Achievements / Stats (Optional) */}
                    <motion.div
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6, duration: 0.8 }}
                        className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6"
                    >
                        {[
                            { label: "Anos de Experiência", value: "8+", icon: Award },
                            { label: "Projetos Entregues", value: "50+", icon: Code },
                            { label: "Linhas de Código", value: "1M+", icon: Cpu },
                        ].map((stat, i) => (
                            <div key={i} className="p-6 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-4 hover:bg-white/10 transition-colors">
                                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                                    <stat.icon className="w-6 h-6 text-blue-400" />
                                </div>
                                <div>
                                    <div className="text-2xl font-bold text-white">{stat.value}</div>
                                    <div className="text-sm text-white/50">{stat.label}</div>
                                </div>
                            </div>
                        ))}
                    </motion.div>
                </div>
            </main>
        </div>
    );
}
