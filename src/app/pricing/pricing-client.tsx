'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronDown, X } from 'lucide-react';

import { Footer } from '@/components/landing/footer';
import { Navbar } from '@/components/landing/navbar';
import { ChatVolumePricingSection } from '@/components/pricing/chat-volume-pricing-section';
import { PLANS, DEFAULT_TRIAL_DAYS } from '@/lib/plans-types';

function renderValue(value: string | boolean) {
    if (value === true) {
        return <Check className="mx-auto h-5 w-5 text-emerald-500" />;
    }

    if (value === false) {
        return <X className="mx-auto h-4 w-4 text-white/20" />;
    }

    return <span className="text-sm text-white/80 font-medium">{value}</span>;
}

function ComparisonTable() {
    const features = [
        {
            category: 'Capacidade',
            items: [
                { name: 'Chats por mes', starter: '1.000', pro: '5.000', business: '15.000', enterprise: 'Negociavel' },
                { name: 'Usuarios', starter: 'Ilimitados', pro: 'Ilimitados', business: 'Ilimitados', enterprise: 'Ilimitados' },
                { name: 'Teste gratis', starter: `${DEFAULT_TRIAL_DAYS} dias`, pro: `${DEFAULT_TRIAL_DAYS} dias`, business: `${DEFAULT_TRIAL_DAYS} dias`, enterprise: 'Demo' },
            ],
        },
        {
            category: 'Canais',
            items: [
                { name: 'WhatsApp (QR Code)', starter: '2 numeros', pro: '5 numeros', business: '10 numeros', enterprise: 'Ilimitado' },
                { name: 'WhatsApp Cloud API', starter: false, pro: '2 numeros', business: '5 numeros', enterprise: 'Ilimitado' },
                { name: 'Instagram Direct', starter: false, pro: '1 conta', business: '3 contas', enterprise: 'Ilimitado' },
                { name: 'Facebook Messenger', starter: false, pro: '1 pagina', business: '3 paginas', enterprise: 'Ilimitado' },
                { name: 'Telegram', starter: '1 bot', pro: '3 bots', business: '5 bots', enterprise: 'Ilimitado' },
            ],
        },
        {
            category: 'Inteligencia Artificial',
            items: [
                { name: 'Transcricao de audios via IA', starter: false, pro: true, business: true, enterprise: true },
                { name: 'Autopilot (agentes de IA)', starter: false, pro: '1 agente', business: '5 agentes', enterprise: 'Ilimitados' },
                { name: 'Base de conhecimento (RAG)', starter: false, pro: '5 docs', business: '50 docs', enterprise: 'Ilimitado' },
                { name: 'IA Copilot (sugestoes)', starter: false, pro: false, business: true, enterprise: true },
                { name: 'BYOK (chave propria)', starter: false, pro: true, business: true, enterprise: true },
                { name: 'Case Memory', starter: false, pro: false, business: true, enterprise: true },
            ],
        },
        {
            category: 'Equipes e Operacao',
            items: [
                { name: 'Departamentos', starter: '2', pro: '10', business: 'Ilimitados', enterprise: 'Ilimitados' },
                { name: 'Distribuicao automatica', starter: false, pro: true, business: true, enterprise: true },
                { name: 'Horario comercial por equipe', starter: false, pro: true, business: true, enterprise: true },
                { name: 'Papeis personalizados (RBAC)', starter: false, pro: true, business: true, enterprise: true },
                { name: 'Historico de mensagens', starter: '6 meses', pro: '12 meses', business: '24 meses', enterprise: '60 meses' },
            ],
        },
        {
            category: 'CRM e Campanhas',
            items: [
                { name: 'Campos customizados', starter: '3', pro: 'Ilimitados', business: 'Ilimitados', enterprise: 'Ilimitados' },
                { name: 'Pipeline de negocios (Kanban)', starter: false, pro: true, business: true, enterprise: true },
                { name: 'Lead Scoring', starter: false, pro: false, business: true, enterprise: true },
                { name: 'Campanhas de disparo', starter: false, pro: '2/mes', business: 'Ilimitadas', enterprise: 'Ilimitadas' },
            ],
        },
        {
            category: 'Avancado',
            items: [
                { name: 'NexusFlow (automacoes)', starter: false, pro: false, business: true, enterprise: true },
                { name: 'API publica e Developer Portal', starter: false, pro: false, business: true, enterprise: true },
                { name: 'Analytics completo + export', starter: false, pro: false, business: true, enterprise: true },
                { name: 'Webhook dispatcher', starter: false, pro: false, business: true, enterprise: true },
            ],
        },
    ];

    return (
        <div className="w-full overflow-x-auto">
            <table className="min-w-[860px] w-full border-collapse text-left">
                <thead>
                    <tr className="border-b border-white/10">
                        <th className="p-4 text-sm font-medium text-white/40">Recursos</th>
                        <th className="p-4 text-center text-sm font-semibold text-white">{PLANS.starter.label}</th>
                        <th className="p-4 text-center text-sm font-semibold text-emerald-400">{PLANS.pro.label}</th>
                        <th className="p-4 text-center text-sm font-semibold text-white">{PLANS.business.label}</th>
                        <th className="p-4 text-center text-sm font-semibold text-white/60">{PLANS.enterprise.label}</th>
                    </tr>
                </thead>
                <tbody className="text-sm text-white/60">
                    {features.map((section) => (
                        <React.Fragment key={section.category}>
                            <tr>
                                <td colSpan={5} className="bg-white/5 p-4 text-sm font-semibold text-white">{section.category}</td>
                            </tr>
                            {section.items.map((item) => (
                                <tr key={item.name} className="border-b border-white/5">
                                    <td className="p-4 text-white/70">{item.name}</td>
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
            a: 'Sim. Ao fazer upgrade, os novos recursos sao liberados imediatamente e a diferenca proporcional e cobrada na proxima fatura. Downgrades aplicam credito proporcional.',
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

export default function PricingClient() {
    return (
        <div className="min-h-screen bg-black text-white">
            <Navbar />

            <main className="px-6 pb-24 pt-36">
                <ChatVolumePricingSection variant="page" />

                <section className="mx-auto mb-24 max-w-7xl">
                    <div className="mb-10 text-center">
                        <h2 className="text-3xl font-bold text-white">Comparativo detalhado</h2>
                        <p className="mt-3 text-white/40">Veja exatamente o que cada plano inclui.</p>
                    </div>
                    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-900/50 backdrop-blur-xl">
                        <ComparisonTable />
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
