'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import {
    Building2,
    GraduationCap,
    HeartPulse,
    ShoppingCart,
    UtensilsCrossed,
    Wifi,
} from 'lucide-react';
import { SectionHeading, Mark } from './brand';
import { cn } from '@/lib/utils';

const CASES = [
    {
        icon: ShoppingCart,
        segment: 'E-commerce e varejo',
        headline: 'Responde “tem no tamanho M?” às 23h',
        copy: 'A IA consulta o catálogo, tira dúvida de frete e prazo, recupera carrinho abandonado e avisa quando o pedido sai.',
        tile: 'bg-amber-500',
        card: 'hover:bg-amber-50/60',
    },
    {
        icon: HeartPulse,
        segment: 'Clínicas e saúde',
        headline: 'Agenda, confirma e reduz falta',
        copy: 'Confirmação automática, lembrete um dia antes, reagendamento pela conversa e triagem antes de chegar na recepção.',
        tile: 'bg-rose-500',
        card: 'hover:bg-rose-50/60',
    },
    {
        icon: Wifi,
        segment: 'Provedores e telecom',
        headline: 'Segunda via e suporte nível 1 sozinhos',
        copy: 'Integração com o SGP: o cliente pede boleto, checa conexão e abre chamado sem ocupar um atendente.',
        tile: 'bg-blue-500',
        card: 'hover:bg-blue-50/60',
    },
    {
        icon: UtensilsCrossed,
        segment: 'Delivery e restaurantes',
        headline: 'Pedido inteiro dentro da conversa',
        copy: 'Cardápio, montagem do pedido, pagamento e status da entrega — sem taxa de marketplace no meio do caminho.',
        tile: 'bg-orange-500',
        card: 'hover:bg-orange-50/60',
    },
    {
        icon: Building2,
        segment: 'Serviços e imobiliárias',
        headline: 'Qualifica antes de ocupar o vendedor',
        copy: 'A IA descobre orçamento, região e urgência, e só então marca a visita na agenda do corretor certo.',
        tile: 'bg-violet-500',
        card: 'hover:bg-violet-50/60',
    },
    {
        icon: GraduationCap,
        segment: 'Educação e cursos',
        headline: 'Da dúvida à matrícula sem fila',
        copy: 'Responde sobre grade, valores e bolsas, envia o link de inscrição e cobra quem parou no meio do processo.',
        tile: 'bg-emerald-500',
        card: 'hover:bg-emerald-50/60',
    },
];

export function UseCases() {
    return (
        <section className="border-y border-slate-100 bg-slate-50/60 py-20 sm:py-28">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <SectionHeading
                    accent="emerald"
                    eyebrow={<>Para o seu negócio</>}
                    title={
                        <>
                            Cada setor atende de um jeito.{' '}
                            <Mark>A Dialogy se adapta ao seu.</Mark>
                        </>
                    }
                    description="O fluxo, o tom de voz e as integrações mudam conforme a sua operação. O que não muda é o cliente ser respondido na hora."
                />

                <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {CASES.map((item, index) => (
                        <motion.article
                            key={item.segment}
                            initial={{ opacity: 0, y: 18 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: '-50px' }}
                            transition={{ duration: 0.4, delay: (index % 3) * 0.07 }}
                            className={cn(
                                'group rounded-[26px] border border-slate-200/80 bg-white p-6 transition-all duration-300',
                                'hover:-translate-y-1 hover:shadow-[0_26px_55px_-30px_rgba(15,23,42,0.35)]',
                                item.card,
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <span
                                    className={cn(
                                        'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110',
                                        item.tile,
                                    )}
                                >
                                    <item.icon className="h-5 w-5" />
                                </span>
                                <span className="text-[0.72rem] font-black uppercase tracking-[0.12em] text-slate-400">
                                    {item.segment}
                                </span>
                            </div>
                            <h3 className="mt-5 text-lg font-extrabold leading-snug tracking-tight text-slate-900">
                                {item.headline}
                            </h3>
                            <p className="mt-2 text-[0.92rem] leading-relaxed text-slate-600">{item.copy}</p>
                        </motion.article>
                    ))}
                </div>
            </div>
        </section>
    );
}
