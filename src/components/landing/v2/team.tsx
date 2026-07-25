'use client';

import * as React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowRight, MessageCircle, Users } from 'lucide-react';
import { SectionHeading, Mark, CtaSecondary } from './brand';

const PEOPLE = [
    {
        name: 'Fabricio de Sousa Soares',
        role: 'Criador e idealizador',
        image: '/fabricio.jpg',
        bio: 'Arquiteto do produto e da operação técnica da Dialogy, com foco em IA aplicada e sistemas que aguentam escala.',
        accent: 'from-brand-green/70 to-emerald-400/70',
    },
    {
        name: 'Helton Pereira Barbosa',
        role: 'Co-diretor de relações institucionais',
        image: '/helton.jpg',
        bio: 'Conduz a expansão institucional da Dialogy, conectando posicionamento, mercado e parcerias de alto valor.',
        accent: 'from-violet-400/70 to-indigo-400/70',
    },
    {
        name: 'Caio Silva Alixandre da Costa',
        role: 'Co-diretor de relações institucionais',
        image: '/caio.png',
        bio: 'Atua no direcionamento estratégico da plataforma, com foco em expansão de mercado e representação institucional.',
        accent: 'from-blue-400/70 to-sky-400/70',
    },
];

export function Team() {
    return (
        <section className="border-y border-slate-100 bg-slate-50/60 py-20 sm:py-28">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <SectionHeading
                    accent="violet"
                    eyebrow={
                        <>
                            <Users className="h-3.5 w-3.5" />
                            Quem está por trás
                        </>
                    }
                    title={
                        <>
                            Um produto brasileiro, com gente de verdade{' '}
                            <Mark tone="violet">do outro lado.</Mark>
                        </>
                    }
                    description="Nada de suporte em fuso horário estranho ou robô te empurrando artigo de ajuda. Você fala com o time que constrói a plataforma."
                />

                <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {PEOPLE.map((person, index) => (
                        <motion.article
                            key={person.name}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-50px' }}
                            transition={{ duration: 0.45, delay: index * 0.08 }}
                            className="group overflow-hidden rounded-[28px] border border-slate-200/80 bg-white transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_30px_60px_-32px_rgba(15,23,42,0.4)]"
                        >
                            <div className={`bg-gradient-to-br ${person.accent} p-1.5`}>
                                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[22px] bg-slate-100">
                                    <Image
                                        src={person.image}
                                        alt={person.name}
                                        fill
                                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                                    />
                                </div>
                            </div>
                            <div className="p-6">
                                <h3 className="text-lg font-extrabold leading-tight tracking-tight text-slate-900">
                                    {person.name}
                                </h3>
                                <p className="mt-1 text-[0.78rem] font-black uppercase tracking-[0.12em] text-slate-400">
                                    {person.role}
                                </p>
                                <p className="mt-3 text-[0.9rem] leading-relaxed text-slate-600">{person.bio}</p>
                            </div>
                        </motion.article>
                    ))}
                </div>

                <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <a
                        href="https://wa.me/551151994714"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-14 w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-slate-900 px-7 text-base font-bold text-white shadow-[0_16px_38px_-16px_rgba(15,23,42,0.65)] transition-all hover:-translate-y-0.5 hover:bg-slate-800 sm:w-auto sm:text-lg"
                    >
                        <MessageCircle className="h-5 w-5" />
                        Falar com o time agora
                    </a>
                    <CtaSecondary href="/creators" size="lg" className="w-full sm:w-auto">
                        Conhecer a história
                        <ArrowRight className="h-5 w-5" />
                    </CtaSecondary>
                </div>
            </div>
        </section>
    );
}
