import * as React from 'react';
import Link from 'next/link';
import { HOME_SEO_PILLARS, HOME_SEO_USE_CASES } from '@/content/home-seo';
import { DialogyLogo } from './brand';

const COLUMNS = [
    {
        title: 'Plataforma',
        links: [
            { label: 'Canais e omnichannel', href: '/#canais' },
            { label: 'Recursos da plataforma', href: '/#plataforma' },
            { label: 'Inteligência artificial', href: '/#ia' },
            { label: 'Planos e preços', href: '/pricing' },
        ],
    },
    {
        title: 'Desenvolvedores',
        links: [
            { label: 'Developer Center', href: '/developer' },
            { label: 'Documentação da API', href: '/developer' },
            { label: 'Integrações', href: '/integrations' },
            { label: 'Comunidade', href: '/developer/community' },
        ],
    },
    {
        title: 'Empresa',
        links: [
            { label: 'Sobre a Dialogy', href: '/about' },
            { label: 'Cases de sucesso', href: '/creators' },
            { label: 'Central de ajuda', href: '/support' },
            { label: 'Novidades', href: '/novidades' },
        ],
    },
    {
        title: 'Legal',
        links: [
            { label: 'Termos de uso', href: '/terms' },
            { label: 'Política de privacidade', href: '/privacy' },
            { label: 'Segurança e LGPD', href: '/privacy' },
        ],
    },
];

export function SiteFooter() {
    return (
        <footer className="border-t border-slate-100 bg-slate-50/70">
            {/* SEO content block */}
            <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
                <h2 className="max-w-3xl text-2xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-3xl">
                    Chatbot para WhatsApp, Instagram e site com atendimento omnichannel e IA
                </h2>
                <div className="mt-8 grid gap-8 md:grid-cols-3">
                    {HOME_SEO_PILLARS.map((pillar) => (
                        <div key={pillar.title}>
                            <h3 className="text-[0.95rem] font-bold text-slate-900">{pillar.title}</h3>
                            <p className="mt-2 text-[0.9rem] leading-relaxed text-slate-500">{pillar.description}</p>
                        </div>
                    ))}
                </div>
                <div className="mt-10 grid gap-8 border-t border-slate-200/70 pt-10 md:grid-cols-3">
                    {HOME_SEO_USE_CASES.map((useCase) => (
                        <div key={useCase.title}>
                            <h3 className="text-[0.95rem] font-bold text-slate-900">{useCase.title}</h3>
                            <p className="mt-2 text-[0.9rem] leading-relaxed text-slate-500">
                                {useCase.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Nav */}
            <div className="border-t border-slate-200/70">
                <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
                    <div className="grid gap-10 lg:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))]">
                        <div>
                            <DialogyLogo />
                            <p className="mt-4 max-w-xs text-[0.9rem] leading-relaxed text-slate-500">
                                Atendimento, vendas e IA em uma única plataforma. Todos os canais da sua empresa em
                                um inbox só.
                            </p>
                            <a
                                href="https://wa.me/551151994714"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-slate-900 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
                            >
                                <span className="h-2 w-2 rounded-full bg-[#25D366]" />
                                (11) 5199-4714
                            </a>
                        </div>

                        {COLUMNS.map((column) => (
                            <div key={column.title}>
                                <h3 className="text-[0.72rem] font-black uppercase tracking-[0.16em] text-slate-400">
                                    {column.title}
                                </h3>
                                <ul className="mt-4 space-y-2.5">
                                    {column.links.map((link) => (
                                        <li key={link.label}>
                                            <Link
                                                href={link.href}
                                                className="text-[0.9rem] font-medium text-slate-600 transition-colors hover:text-slate-900"
                                            >
                                                {link.label}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>

                    <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-slate-200/70 pt-8 text-center text-[0.82rem] text-slate-400 sm:flex-row sm:text-left">
                        <span>© {new Date().getFullYear()} Dialogy. Todos os direitos reservados.</span>
                        <span className="font-medium">Feito no Brasil, para times que vendem conversando.</span>
                    </div>
                </div>
            </div>
        </footer>
    );
}
