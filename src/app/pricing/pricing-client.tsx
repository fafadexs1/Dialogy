'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronDown, X } from 'lucide-react';

import { Footer } from '@/components/landing/footer';
import { Navbar } from '@/components/landing/navbar';
import { PlanOffers } from '@/components/pricing/plan-offers';
import type { OfferedPlan } from '@/lib/billing-catalog';
import { DEFAULT_TRIAL_DAYS } from '@/lib/plans-types';

function renderValue(value: string | boolean) {
    if (value === true) {
        return <Check className="mx-auto h-5 w-5 text-emerald-500" />;
    }

    if (value === false) {
        return <X className="mx-auto h-4 w-4 text-white/20" />;
    }

    return <span className="text-sm text-white/80 font-medium">{value}</span>;
}

function ComparisonTable({ plans }: { plans: OfferedPlan[] }) {
 const fields = [['Conversas por mês','monthly_chats'],['Usuários','users'],['WhatsApp QR Code','whatsapp_baileys'],['WhatsApp oficial','whatsapp_cloud'],['Instagram','instagram'],['Telegram','telegram'],['Agentes de IA','autopilot_agents'],['Base de conhecimento','knowledge_docs'],['Transcrição','transcription'],['CRM com funil','pipeline'],['NexusFlow','nexusflow'],['API','api'],['Histórico em meses','history_months']] as const;
 return <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr><th className="p-4 text-left">Recursos</th>{plans.map(p=><th key={p.id} className="p-4">{p.label}</th>)}</tr></thead><tbody>{fields.map(([label,key])=><tr key={key} className="border-t border-white/10"><td className="p-4">{label}</td>{plans.map(p=>{const value=p.limits[key];return <td key={p.id} className="p-4 text-center">{renderValue(typeof value==='number'?((value>=999999 || value===9999)?'Ilimitado':value.toLocaleString('pt-BR')):value)}</td>;})}</tr>)}</tbody></table></div>;
}
function FAQ() {
    const [openIndex, setOpenIndex] = useState<number | null>(0);

    const faqs = [
        {
            q: 'Qual a diferenca entre os planos?',
            a: 'Cada plano libera mais canais, recursos de IA, CRM e automacoes. O Essencial e para quem esta comecando, o Profissional adiciona IA e Instagram, e o Operacao inclui API, NexusFlow e analytics completo.',
        },
        {
            q: 'O teste gratis dura quanto tempo?',
            a: `Todos os planos self-serve incluem ${DEFAULT_TRIAL_DAYS} dias gratis antes da primeira cobranca.`,
        },
        {
            q: 'Existe limite de usuarios?',
            a: 'Nao. Toda a equipe pode entrar no mesmo workspace sem custo adicional. O controle comercial fica no volume mensal de chats e features de cada plano.',
        },
        {
            q: 'Posso trocar de plano a qualquer momento?',
            a: 'Entre em contato com o suporte para ajustar sua assinatura. A troca deve respeitar o período já contratado e as cobranças existentes.',
        },
        {
            q: 'WhatsApp oficial esta incluso?',
            a: 'O WhatsApp Cloud API (oficial da Meta) esta disponivel a partir do plano Profissional. O custo das conversas cobradas pela Meta continua separado.',
        },
        {
            q: 'E se eu precisar de mais de 15.000 chats por mes?',
            a: 'Entre em contato pelo WhatsApp para uma proposta Enterprise com volume negociavel, canais ilimitados e suporte dedicado.',
        },
    ];

    return (
        <div className="mx-auto max-w-3xl space-y-4">
            {faqs.map((item, index) => (
                <div key={item.q} className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/50 backdrop-blur-xl">
                    <button
                        type="button"
                        onClick={() => setOpenIndex(openIndex === index ? null : index)}
                        className="flex w-full items-center justify-between px-6 py-5 text-left"
                    >
                        <span className="font-semibold text-white">{item.q}</span>
                        <ChevronDown className={`h-5 w-5 text-white/40 transition-transform ${openIndex === index ? 'rotate-180' : ''}`} />
                    </button>
                    <motion.div initial={false} animate={{ height: openIndex === index ? 'auto' : 0 }} className="overflow-hidden">
                        <div className="px-6 pb-5 text-sm leading-7 text-white/50">{item.a}</div>
                    </motion.div>
                </div>
            ))}
        </div>
    );
}

export default function PricingClient({ plans }: { plans: OfferedPlan[] }) {
    return (
        <div className="min-h-screen bg-black text-white">
            <Navbar />

            <main className="px-6 pb-24 pt-36">
                <PlanOffers plans={plans} />

                <section className="mx-auto mb-24 max-w-7xl">
                    <div className="mb-10 text-center">
                        <h2 className="text-3xl font-bold text-white">Comparativo detalhado</h2>
                        <p className="mt-3 text-white/40">Veja exatamente o que cada plano inclui.</p>
                    </div>
                    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-900/50 backdrop-blur-xl">
                        <ComparisonTable plans={plans} />
                    </div>
                </section>

                <section className="mx-auto max-w-3xl">
                    <div className="mb-10 text-center">
                        <h2 className="text-3xl font-bold text-white">Duvidas frequentes</h2>
                    </div>
                    <FAQ />
                </section>
            </main>

            <Footer />
        </div>
    );
}
