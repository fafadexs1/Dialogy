'use client';

import React from "react";
import { motion } from "framer-motion";
import { Github, Linkedin, Twitter, Mail, Globe, Award, Code, Cpu, Sparkles, Users } from "lucide-react";
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
    const creators = [
        {
            name: "Fabricio de Sousa Soares",
            role: "Criador & Idealizador",
            description: "Desenvolvedor visionário e arquiteto por trás do Dialogy. Apaixonado por construir soluções de IA escaláveis e experiências de usuário intuitivas.",
            image: "/fabricio.jpg",
            skills: ["Desenvolvimento Fullstack", "IA & Machine Learning", "Arquitetura de Sistemas", "UI/UX Design", "Estratégia de Produto"],
            socials: {
                github: "https://github.com",
                linkedin: "https://linkedin.com",
                twitter: "https://twitter.com",
                email: "mailto:contact@example.com"
            },
            stats: [
                { label: "Anos de Experiência", value: "8+", icon: Award },
                { label: "Projetos Entregues", value: "50+", icon: Code },
                { label: "Linhas de Código", value: "1M+", icon: Cpu },
            ]
        },
        {
            name: "Helton Pereira Barbosa",
            role: "Co-Diretor de Relações Institucionais",
            description: "Atua como um dos pilares estratégicos da Dialogy, contribuindo diretamente para o fortalecimento da presença institucional da plataforma e para a construção de conexões de alto valor. Oferece visão estratégica, análise de oportunidades e suporte consultivo essencial para a expansão sustentável da empresa.",
            image: "/helton.jpg",
            skills: ["Relações Institucionais", "Estratégia de Mercado", "Parcerias Estratégicas", "Posicionamento de Marca", "Expansão de Negócios"],
            socials: {
                linkedin: "https://linkedin.com",
                email: "mailto:helton@dialogy.com"
            }
        },
        {
            name: "Caio Silva Alixandre da Costa",
            role: "Co-Diretor de Relações Institucionais",
            description: "Desempenha um papel fundamental no direcionamento estratégico da Dialogy, trazendo insights valiosos sobre mercado, posicionamento e oportunidades emergentes. Sua atuação consultiva contribui para fortalecer a expansão da marca e ampliar a relevância institucional da empresa.",
            image: "/caio.png",
            skills: ["Estratégia Corporativa", "Expansão de Mercado", "Parcerias Estratégicas", "Representação Institucional", "Consultoria de Negócios"],
            socials: {
                linkedin: "https://linkedin.com",
                email: "mailto:caio@dialogy.com"
            }
        }
    ];

    return (
        <div className="min-h-screen bg-[#020617] text-white selection:bg-blue-500/30 flex flex-col">
            {/* Navbar */}
            <nav className="fixed top-0 w-full p-6 z-50 flex justify-between items-center bg-[#020617]/80 backdrop-blur-md border-b border-white/5">
                <Link href="/" className="text-white/50 hover:text-white transition-colors font-medium flex items-center gap-2">
                    ← Voltar para Home
                </Link>
            </nav>

            <main className="flex-1 relative overflow-hidden pt-24 pb-20 px-6">
                {/* Background Elements */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none fixed">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-600/10 blur-[120px] rounded-full" />
                    <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-purple-600/10 blur-[100px] rounded-full" />
                </div>

                <div className="max-w-6xl mx-auto space-y-16 relative z-10">
                    <div className="text-center mb-12">
                        <h1 className="text-4xl md:text-6xl font-bold mb-6 tracking-tight">
                            Mentes por trás do <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                                Dialogy
                            </span>
                        </h1>
                        <p className="text-xl text-white/60 max-w-2xl mx-auto">
                            Conheça as pessoas que estão redefinindo o futuro da comunicação empresarial com inteligência artificial.
                        </p>
                    </div>

                    {creators.map((creator, index) => (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 40 }}
                            animate={index === 0 ? { opacity: 1, y: 0 } : undefined}
                            whileInView={index !== 0 ? { opacity: 1, y: 0 } : undefined}
                            viewport={{ once: true }}
                            transition={{ duration: 0.8 }}
                            className={`grid md:grid-cols-5 gap-12 items-center ${index % 2 === 1 ? 'md:flex-row-reverse' : ''}`}
                        >
                            {/* Profile Image Section */}
                            <div className={`md:col-span-2 flex justify-center ${index % 2 === 1 ? 'md:order-2 md:justify-start' : 'md:justify-end'}`}>
                                <div className="relative group">
                                    <div className="absolute -inset-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full blur-2xl opacity-40 group-hover:opacity-60 transition-opacity duration-500" />
                                    <div className="relative w-64 h-64 md:w-80 md:h-80 rounded-full overflow-hidden border-4 border-white/10 shadow-2xl bg-zinc-900">
                                        <img src={creator.image} alt={creator.name} className="w-full h-full object-cover" />
                                    </div>
                                    {index === 0 && (
                                        <div className="absolute bottom-4 right-4 bg-[#0f172a] border border-white/10 p-3 rounded-2xl shadow-xl flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                                            <span className="text-xs font-medium text-white/80">Disponível para projetos</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Content Section */}
                            <div className={`md:col-span-3 text-center ${index % 2 === 1 ? 'md:order-1 md:text-right' : 'md:text-left'}`}>
                                <div>
                                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/60 text-xs font-medium mb-6 ${index % 2 === 1 ? 'flex-row-reverse' : ''}`}>
                                        <Sparkles className="w-3 h-3 text-yellow-400" /> {creator.role}
                                    </div>

                                    <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight text-white">
                                        {creator.name}
                                    </h2>

                                    <p className={`text-lg text-white/60 mb-8 leading-relaxed max-w-lg mx-auto ${index % 2 === 1 ? 'md:ml-auto md:mr-0' : 'md:mr-auto md:ml-0'}`}>
                                        {creator.description}
                                    </p>

                                    <div className={`flex flex-wrap justify-center ${index % 2 === 1 ? 'md:justify-end' : 'md:justify-start'} gap-2 mb-10`}>
                                        {creator.skills.map((skill, i) => (
                                            <SkillBadge key={i}>{skill}</SkillBadge>
                                        ))}
                                    </div>

                                    <div className={`flex items-center justify-center ${index % 2 === 1 ? 'md:justify-end' : 'md:justify-start'} gap-4 mb-10`}>
                                        {creator.socials.github && <SocialLink href={creator.socials.github} icon={Github} />}
                                        {creator.socials.linkedin && <SocialLink href={creator.socials.linkedin} icon={Linkedin} />}
                                        {creator.socials.twitter && <SocialLink href={creator.socials.twitter} icon={Twitter} />}
                                        {creator.socials.email && <SocialLink href={creator.socials.email} icon={Mail} />}
                                    </div>

                                    {creator.stats && (
                                        <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 ${index % 2 === 1 ? 'md:justify-end' : 'md:justify-start'}`}>
                                            {creator.stats.map((stat, i) => (
                                                <div key={i} className="p-4 rounded-xl bg-white/5 border border-white/5 flex flex-col items-center justify-center hover:bg-white/10 transition-colors">
                                                    <stat.icon className="w-5 h-5 text-blue-400 mb-2" />
                                                    <div className="text-xl font-bold text-white">{stat.value}</div>
                                                    <div className="text-xs text-white/50">{stat.label}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </main>
        </div>
    );
}
