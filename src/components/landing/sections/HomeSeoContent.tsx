import Link from 'next/link';

import {
    HOME_FAQ_ITEMS,
    HOME_SEO_PILLARS,
    HOME_SEO_USE_CASES,
} from '@/content/home-seo';

export function HomeSeoContent() {
    return (
        <section
            id="crm-whatsapp"
            aria-labelledby="home-seo-heading"
            className="border-t border-black/5 bg-[#f3f5f7] px-4 py-20 sm:px-6 md:py-28"
        >
            <div className="mx-auto max-w-[1280px]">
                <div className="grid gap-12 rounded-[32px] border border-black/10 bg-white p-8 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.25)] lg:grid-cols-[1.1fr_0.9fr] lg:p-12">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
                            Conteudo estrategico
                        </p>
                        <h2
                            id="home-seo-heading"
                            className="mt-4 max-w-3xl text-4xl font-extrabold tracking-tight text-zinc-950 md:text-5xl"
                        >
                            CRM para WhatsApp, Instagram e atendimento omnichannel em uma unica operacao.
                        </h2>
                        <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-600">
                            A Dialogy foi criada para empresas que precisam de um CRM para WhatsApp com inbox
                            unificado, automacao de atendimento, inteligencia artificial e visibilidade comercial em
                            tempo real.
                        </p>
                        <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-600">
                            Se o seu time procura um sistema de atendimento WhatsApp, um software omnichannel para
                            suporte ou uma plataforma para qualificar leads via conversas, a Dialogy conecta canais,
                            processos, equipes e dados sem friccao.
                        </p>

                        <div className="mt-8 flex flex-wrap gap-3 text-sm font-semibold">
                            <Link
                                href="/pricing"
                                className="rounded-full border border-zinc-300 px-4 py-2 text-zinc-900 transition-colors hover:border-zinc-900 hover:bg-zinc-900 hover:text-white"
                            >
                                Ver planos
                            </Link>
                            <Link
                                href="/developer"
                                className="rounded-full border border-zinc-300 px-4 py-2 text-zinc-900 transition-colors hover:border-zinc-900 hover:bg-zinc-900 hover:text-white"
                            >
                                Explorar integracoes
                            </Link>
                            <Link
                                href="/about"
                                className="rounded-full border border-zinc-300 px-4 py-2 text-zinc-900 transition-colors hover:border-zinc-900 hover:bg-zinc-900 hover:text-white"
                            >
                                Conhecer a plataforma
                            </Link>
                        </div>
                    </div>

                    <div className="grid gap-4">
                        {HOME_SEO_PILLARS.map((pillar) => (
                            <article
                                key={pillar.title}
                                className="rounded-[24px] border border-zinc-200 bg-zinc-50/80 p-6"
                            >
                                <h3 className="text-xl font-bold tracking-tight text-zinc-950">{pillar.title}</h3>
                                <p className="mt-3 text-sm leading-7 text-zinc-600">{pillar.description}</p>
                            </article>
                        ))}
                    </div>
                </div>

                <div className="mt-10 grid gap-6 lg:grid-cols-3">
                    {HOME_SEO_USE_CASES.map((item) => (
                        <article
                            key={item.title}
                            className="rounded-[28px] border border-black/10 bg-white px-6 py-7 shadow-[0_18px_60px_-40px_rgba(15,23,42,0.35)]"
                        >
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                                Caso de uso
                            </p>
                            <h3 className="mt-4 text-2xl font-bold tracking-tight text-zinc-950">{item.title}</h3>
                            <p className="mt-4 text-sm leading-7 text-zinc-600">{item.description}</p>
                        </article>
                    ))}
                </div>

                <div className="mt-16 grid gap-10 lg:grid-cols-[0.92fr_1.08fr]">
                    <article className="rounded-[32px] border border-black/10 bg-[#101828] px-8 py-10 text-white">
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">
                            Busca de alta intencao
                        </p>
                        <h3 className="mt-4 text-3xl font-extrabold tracking-tight">
                            Um software para vender mais e atender melhor no WhatsApp.
                        </h3>
                        <p className="mt-5 text-sm leading-7 text-white/75">
                            Empresas que pesquisam por CRM para WhatsApp, plataforma omnichannel, automacao de
                            atendimento ou sistema de atendimento ao cliente normalmente precisam da mesma resposta:
                            concentrar canais, reduzir tempo de resposta e transformar conversa em receita.
                        </p>
                        <p className="mt-4 text-sm leading-7 text-white/75">
                            A Dialogy entrega essa estrutura em uma unica base operacional, com filas, roteamento,
                            historico, analytics e apoio de IA para que o crescimento do volume nao destrua a
                            experiencia do cliente.
                        </p>
                    </article>

                    <div>
                        <div className="max-w-3xl">
                            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
                                Perguntas frequentes
                            </p>
                            <h3 className="mt-4 text-3xl font-extrabold tracking-tight text-zinc-950 md:text-4xl">
                                FAQ sobre CRM para WhatsApp e atendimento omnichannel
                            </h3>
                        </div>

                        <div className="mt-8 grid gap-4 md:grid-cols-2">
                            {HOME_FAQ_ITEMS.map((item) => (
                                <article
                                    key={item.question}
                                    className="rounded-[24px] border border-zinc-200 bg-white p-6"
                                >
                                    <h4 className="text-lg font-bold tracking-tight text-zinc-950">{item.question}</h4>
                                    <p className="mt-3 text-sm leading-7 text-zinc-600">{item.answer}</p>
                                </article>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
