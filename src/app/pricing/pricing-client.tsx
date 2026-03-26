'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';

import { Footer } from '@/components/landing/footer';
import { Navbar } from '@/components/landing/navbar';
import { ChatVolumePricingSection } from '@/components/pricing/chat-volume-pricing-section';
import { PLANS, DEFAULT_TRIAL_DAYS } from '@/lib/plans-types';

function renderValue(value: string | boolean) {
    if (value === true) {
        return <Check className="mx-auto h-5 w-5 text-emerald-500" />;
    }

    if (value === false) {
        return <div className="mx-auto h-0.5 w-4 bg-slate-200" />;
    }

    return value;
}

function ComparisonTable() {
    const features = [
        {
            category: 'Modelo comercial',
            items: [
                { name: 'Faixa de chats por mes', starter: '500 a 5.000.000', pro: '500 a 5.000.000', business: '500 a 5.000.000', enterprise: 'Acima de 5.000.000' },
                { name: 'Papel na secao principal', starter: 'Entrada', pro: 'Slider em destaque', business: 'Escala', enterprise: 'Comercial' },
                { name: 'Usuarios', starter: 'Ilimitados', pro: 'Ilimitados', business: 'Ilimitados', enterprise: 'Ilimitados' },
                { name: 'Teste gratis', starter: `${DEFAULT_TRIAL_DAYS} dias`, pro: `${DEFAULT_TRIAL_DAYS} dias`, business: `${DEFAULT_TRIAL_DAYS} dias`, enterprise: 'Sob proposta' },
            ],
        },
        {
            category: 'Operacao',
            items: [
                { name: 'Canais conectados', starter: '2', pro: '5', business: '12', enterprise: 'Sob medida' },
                { name: 'Filas e equipes', starter: false, pro: true, business: true, enterprise: true },
                { name: 'Historico de mensagens', starter: '6 meses', pro: '12 meses', business: '24 meses', enterprise: 'Sob medida' },
                { name: 'SLA e distribuicao', starter: false, pro: true, business: true, enterprise: true },
            ],
        },
        {
            category: 'Produtividade',
            items: [
                { name: 'Respostas rapidas', starter: true, pro: true, business: true, enterprise: true },
                { name: 'Transcricao de audio', starter: false, pro: true, business: true, enterprise: true },
                { name: 'Campanhas e disparos', starter: false, pro: 'Moderado', business: 'Alto volume', enterprise: 'Sob medida' },
                { name: 'API e webhooks', starter: false, pro: false, business: true, enterprise: true },
            ],
        },
    ];

    return (
        <div className="w-full overflow-x-auto">
            <table className="min-w-[860px] w-full border-collapse text-left">
                <thead>
                    <tr className="border-b border-slate-200">
                        <th className="p-4 text-sm font-medium text-slate-500">Recursos</th>
                        <th className="p-4 text-center text-sm font-semibold text-slate-900">{PLANS.starter.label}</th>
                        <th className="p-4 text-center text-sm font-semibold text-emerald-700">{PLANS.pro.label}</th>
                        <th className="p-4 text-center text-sm font-semibold text-slate-900">{PLANS.business.label}</th>
                        <th className="p-4 text-center text-sm font-semibold text-slate-900">{PLANS.enterprise.label}</th>
                    </tr>
                </thead>
                <tbody className="text-sm text-slate-700">
                    {features.map((section) => (
                        <React.Fragment key={section.category}>
                            <tr>
                                <td colSpan={5} className="bg-slate-50 p-4 text-sm font-semibold text-slate-900">{section.category}</td>
                            </tr>
                            {section.items.map((item) => (
                                <tr key={item.name} className="border-b border-slate-100">
                                    <td className="p-4">{item.name}</td>
                                    <td className="p-4 text-center">{renderValue(item.starter)}</td>
                                    <td className="p-4 text-center">{renderValue(item.pro)}</td>
                                    <td className="p-4 text-center">{renderValue(item.business)}</td>
                                    <td className="p-4 text-center">{renderValue(item.enterprise)}</td>
                                </tr>
                            ))}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function FAQ() {
    const [openIndex, setOpenIndex] = useState<number | null>(0);

    const faqs = [
        {
            q: 'O que mudou no bloco principal de pricing?',
            a: 'A secao principal foi recalibrada para a mecanica certa de mensageria: entrada mais leve, plano principal com slider em destaque e uma saida comercial separada para grandes volumes.',
        },
        {
            q: 'O teste gratis dura quanto tempo?',
            a: `Os planos self-serve entram com ${DEFAULT_TRIAL_DAYS} dias gratis antes da primeira cobranca recorrente.`,
        },
        {
            q: 'Existe limite de usuarios?',
            a: 'Nao. Toda a equipe pode entrar no mesmo workspace. O controle comercial agora fica no volume mensal de chats.',
        },
        {
            q: 'Acima de 5.000.000 chats por mes, o que acontece?',
            a: 'A Dialogy encaminha para o fluxo de grandes empresas, com negociacao comercial, desenho operacional e suporte dedicado.',
        },
        {
            q: 'WhatsApp oficial esta incluso?',
            a: 'Nao. O custo oficial da Meta ou do BSP continua separado do valor do software.',
        },
    ];

    return (
        <div className="mx-auto max-w-3xl space-y-4">
            {faqs.map((item, index) => (
                <div key={item.q} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_45px_-40px_rgba(15,23,42,0.4)]">
                    <button
                        type="button"
                        onClick={() => setOpenIndex(openIndex === index ? null : index)}
                        className="flex w-full items-center justify-between px-6 py-5 text-left"
                    >
                        <span className="font-semibold text-slate-950">{item.q}</span>
                        <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${openIndex === index ? 'rotate-180' : ''}`} />
                    </button>
                    <motion.div initial={false} animate={{ height: openIndex === index ? 'auto' : 0 }} className="overflow-hidden">
                        <div className="px-6 pb-5 text-sm leading-7 text-slate-600">{item.a}</div>
                    </motion.div>
                </div>
            ))}
        </div>
    );
}

export default function PricingClient() {
    return (
        <div className="min-h-screen bg-[#f6f7fb] text-slate-950">
            <Navbar />

            <main className="px-6 pb-24 pt-36">
                <ChatVolumePricingSection variant="page" />

                <section className="mx-auto mb-24 max-w-7xl">
                    <div className="mb-10 text-center">
                        <h2 className="text-3xl font-semibold text-slate-950">Comparativo detalhado</h2>
                        <p className="mt-3 text-slate-600">O volume mensal continua comum aos tres planos self-serve. O que muda e o papel de cada camada dentro da nova composicao publica.</p>
                    </div>
                    <div className="overflow-hidden rounded-[28px] border border-black/10 bg-white shadow-[0_30px_90px_-58px_rgba(15,23,42,0.45)]">
                        <ComparisonTable />
                    </div>
                </section>

                <section className="mx-auto max-w-3xl">
                    <div className="mb-10 text-center">
                        <h2 className="text-3xl font-semibold text-slate-950">Duvidas frequentes</h2>
                    </div>
                    <FAQ />
                </section>
            </main>

            <Footer />
        </div>
    );
}
