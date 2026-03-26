'use client';

import { motion } from 'framer-motion';
import { Award, Code, Cpu, Github, Linkedin, Mail, Sparkles, Twitter } from 'lucide-react';

import { Footer } from '@/components/landing/footer';
import { Navbar } from '@/components/landing/navbar';

function SocialLink({ href, icon: Icon }: { href: string; icon: any }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition-all duration-300 hover:scale-110 hover:bg-white/10 hover:text-white"
        >
            <Icon className="h-5 w-5" />
        </a>
    );
}

function SkillBadge({ children }: { children: React.ReactNode }) {
    return (
        <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400">
            {children}
        </span>
    );
}

export default function CreatorsClient() {
    const creators = [
        {
            name: 'Fabricio de Sousa Soares',
            role: 'Criador e Idealizador',
            description: 'Arquiteto do produto e da operacao tecnica da Dialogy, com foco em IA aplicada, experiencia de usuario e sistemas escalaveis.',
            image: '/fabricio.jpg',
            skills: ['Desenvolvimento Fullstack', 'IA e Machine Learning', 'Arquitetura de Sistemas', 'UI e UX', 'Estrategia de Produto'],
            socials: {
                github: 'https://github.com',
                linkedin: 'https://linkedin.com',
                twitter: 'https://twitter.com',
                email: 'mailto:contact@example.com',
            },
            stats: [
                { label: 'Anos de experiencia', value: '8+', icon: Award },
                { label: 'Projetos entregues', value: '50+', icon: Code },
                { label: 'Linhas de codigo', value: '1M+', icon: Cpu },
            ],
        },
        {
            name: 'Helton Pereira Barbosa',
            role: 'Co-Diretor de Relacoes Institucionais',
            description: 'Atua na expansao institucional da Dialogy, conectando posicionamento, mercado e oportunidades de alto valor para a plataforma.',
            image: '/helton.jpg',
            skills: ['Relacoes Institucionais', 'Estrategia de Mercado', 'Parcerias Estrategicas', 'Posicionamento de Marca', 'Expansao de Negocios'],
            socials: {
                linkedin: 'https://linkedin.com',
                email: 'mailto:helton@dialogy.com',
            },
        },
        {
            name: 'Caio Silva Alixandre da Costa',
            role: 'Co-Diretor de Relacoes Institucionais',
            description: 'Contribui para o direcionamento estrategico da Dialogy com foco em expansao, representacao institucional e desenvolvimento de mercado.',
            image: '/caio.png',
            skills: ['Estrategia Corporativa', 'Expansao de Mercado', 'Parcerias Estrategicas', 'Representacao Institucional', 'Consultoria de Negocios'],
            socials: {
                linkedin: 'https://linkedin.com',
                email: 'mailto:caio@dialogy.com',
            },
        },
    ];

    return (
        <div className="flex min-h-screen flex-col bg-[#020617] text-white selection:bg-blue-500/30">
            <Navbar />

            <main className="relative flex-1 overflow-hidden px-6 pb-20 pt-32">
                <div className="pointer-events-none fixed inset-0 overflow-hidden">
                    <div className="absolute left-1/2 top-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/10 blur-[120px]" />
                    <div className="absolute right-0 top-0 h-[400px] w-[400px] rounded-full bg-purple-600/10 blur-[100px]" />
                </div>

                <div className="relative z-10 mx-auto max-w-6xl space-y-16">
                    <div className="mb-12 text-center">
                        <h1 className="mb-6 text-4xl font-bold tracking-tight md:text-6xl">
                            Mentes por tras do <br />
                            <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Dialogy</span>
                        </h1>
                        <p className="mx-auto max-w-2xl text-xl text-white/60">
                            Conheca as pessoas que estao ajudando a redefinir a comunicacao empresarial com IA e operacao conversacional.
                        </p>
                    </div>

                    {creators.map((creator, index) => (
                        <motion.div
                            key={creator.name}
                            initial={{ opacity: 0, y: 40 }}
                            animate={index === 0 ? { opacity: 1, y: 0 } : undefined}
                            whileInView={index !== 0 ? { opacity: 1, y: 0 } : undefined}
                            viewport={{ once: true }}
                            transition={{ duration: 0.8 }}
                            className="grid items-center gap-12 md:grid-cols-5"
                        >
                            <div className={`flex justify-center md:col-span-2 ${index % 2 === 1 ? 'md:order-2 md:justify-start' : 'md:justify-end'}`}>
                                <div className="group relative">
                                    <div className="absolute -inset-4 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 opacity-40 blur-2xl transition-opacity duration-500 group-hover:opacity-60" />
                                    <div className="relative h-64 w-64 overflow-hidden rounded-full border-4 border-white/10 bg-zinc-900 shadow-2xl md:h-80 md:w-80">
                                        <img src={creator.image} alt={creator.name} className="h-full w-full object-cover" />
                                    </div>
                                    {index === 0 && (
                                        <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-[#0f172a] p-3 shadow-xl">
                                            <div className="h-3 w-3 animate-pulse rounded-full bg-green-500" />
                                            <span className="text-xs font-medium text-white/80">Disponivel para projetos</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className={`text-center md:col-span-3 ${index % 2 === 1 ? 'md:order-1 md:text-right' : 'md:text-left'}`}>
                                <div className={`mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/60 ${index % 2 === 1 ? 'flex-row-reverse' : ''}`}>
                                    <Sparkles className="h-3 w-3 text-yellow-400" /> {creator.role}
                                </div>

                                <h2 className="mb-4 text-4xl font-bold tracking-tight text-white md:text-5xl">{creator.name}</h2>

                                <p className={`mb-8 max-w-lg text-lg leading-relaxed text-white/60 ${index % 2 === 1 ? 'mx-auto md:ml-auto md:mr-0' : 'mx-auto md:ml-0 md:mr-auto'}`}>
                                    {creator.description}
                                </p>

                                <div className={`mb-10 flex flex-wrap justify-center gap-2 ${index % 2 === 1 ? 'md:justify-end' : 'md:justify-start'}`}>
                                    {creator.skills.map((skill) => (
                                        <SkillBadge key={skill}>{skill}</SkillBadge>
                                    ))}
                                </div>

                                <div className={`mb-10 flex items-center justify-center gap-4 ${index % 2 === 1 ? 'md:justify-end' : 'md:justify-start'}`}>
                                    {creator.socials.github && <SocialLink href={creator.socials.github} icon={Github} />}
                                    {creator.socials.linkedin && <SocialLink href={creator.socials.linkedin} icon={Linkedin} />}
                                    {creator.socials.twitter && <SocialLink href={creator.socials.twitter} icon={Twitter} />}
                                    {creator.socials.email && <SocialLink href={creator.socials.email} icon={Mail} />}
                                </div>

                                {creator.stats && (
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                        {creator.stats.map((stat) => (
                                            <div key={stat.label} className="flex flex-col items-center justify-center rounded-xl border border-white/5 bg-white/5 p-4 transition-colors hover:bg-white/10">
                                                <stat.icon className="mb-2 h-5 w-5 text-blue-400" />
                                                <div className="text-xl font-bold text-white">{stat.value}</div>
                                                <div className="text-xs text-white/50">{stat.label}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ))}
                </div>
            </main>

            <Footer />
        </div>
    );
}
