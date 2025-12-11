'use client';

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
    Check, X, ChevronDown, Shield, Bot
} from "lucide-react";
import Link from "next/link";
import { PLANS } from "@/lib/plans";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import {
    Badge, CTAButton, GradientOrb, darkBg
} from "@/components/landing/ui";
import { getPublicPlanPricesAction } from '@/actions/public';

// --- Components ---

// --- Pricing Card ---
function PricingCard({ plan, popular = false, dynamicPriceId }: { plan: any, popular?: boolean, dynamicPriceId?: string }) {
    const isEnterprise = plan.id === 'enterprise';
    const [loading, setLoading] = useState(false);

    // Use dynamic ID from DB if available, otherwise fallback to static file
    const priceId = dynamicPriceId || plan.stripePriceId;

    const handleSubscribe = async () => {
        if (isEnterprise) return; // Custom flow for enterprise

        if (!priceId) {
            alert("Configuração de preço ausente. Contate o suporte ou verifique as configurações.");
            return;
        }

        setLoading(true);
        try {
            // Dynamically import to avoid server-side issues if any
            const { createCheckoutSessionAction } = await import('@/actions/stripe');
            const result = await createCheckoutSessionAction(priceId, plan.id);

            if (result.url) {
                window.location.href = result.url;
            } else if (result.error) {
                if (result.error.includes("logado")) {
                    // Redirect to login with return url
                    window.location.href = `/login?next=/pricing`;
                } else {
                    alert(result.error);
                }
            }
        } catch (error) {
            console.error(error);
            alert("Erro ao iniciar pagamento.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <motion.div
            whileHover={{ y: -5 }}
            className={`relative p-8 rounded-3xl border flex flex-col h-full ${popular ? 'border-blue-500/50 bg-blue-500/5 shadow-2xl shadow-blue-500/10' : 'border-white/10 bg-white/5'}`}
        >
            {popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full text-xs font-bold text-white uppercase tracking-wider shadow-lg">
                    Recomendado
                </div>
            )}

            <div className="mb-6">
                <h3 className="text-xl font-bold text-white mb-2">{plan.label}</h3>
                <div className="flex items-baseline gap-1">
                    {isEnterprise ? (
                        <span className="text-3xl font-bold text-white">Sob Consulta</span>
                    ) : (
                        <>
                            <span className="text-4xl font-bold text-white">R$ {plan.price}</span>
                            <span className="text-white/60">/mês</span>
                        </>
                    )}
                </div>
                <p className="text-white/50 text-sm mt-4 min-h-[40px]">
                    {plan.id === 'starter' && "Para quem está começando a automatizar."}
                    {plan.id === 'pro' && "Para empresas em crescimento que precisam de mais poder."}
                    {plan.id === 'business' && "Para operações robustas com múltiplas equipes."}
                    {plan.id === 'enterprise' && "Soluções customizadas para grandes organizações."}
                </p>
            </div>

            <div className="space-y-4 mb-8 flex-1">
                <FeatureItem label={isEnterprise ? 'Usuários Sob Demanda' : `${plan.limits.users} Usuário${plan.limits.users > 1 ? 's' : ''}`} />
                <FeatureItem label={isEnterprise ? 'WhatsApp Sob Demanda' : `${plan.limits.whatsapp} WhatsApp${plan.limits.whatsapp > 1 ? 's' : ''}`} />
                <FeatureItem label={isEnterprise ? 'Histórico Sob Demanda' : `${plan.limits.history_months} Meses de Histórico`} />

                <FeatureItem
                    label="Departamentos"
                    checked={plan.limits.departments}
                    dimmed={!plan.limits.departments}
                />
                <FeatureItem
                    label="Disparos em Massa"
                    checked={!!plan.limits.campaigns}
                    dimmed={!plan.limits.campaigns}
                    suffix={typeof plan.limits.campaigns === 'string' ? (plan.limits.campaigns === 'high' ? '(CSV)' : '(Contatos)') : ''}
                />
                <FeatureItem
                    label="API de Integração"
                    checked={plan.limits.api}
                    dimmed={!plan.limits.api}
                />
                <FeatureItem
                    label="Transcrição de Áudio"
                    checked={plan.limits.transcription}
                    dimmed={!plan.limits.transcription}
                />
            </div>

            <CTAButton
                onClick={handleSubscribe}
                disabled={loading}
                href={isEnterprise ? "/register" : undefined} // Keep href for enterprise or fallback
                variant={popular ? 'primary' : 'outline'}
                className="w-full"
            >
                {loading ? 'Processando...' : (isEnterprise ? 'Falar com Consultor' : 'Escolher Plano')}
            </CTAButton>
        </motion.div>
    );
}

function FeatureItem({ label, checked = true, dimmed = false, suffix = '' }: { label: string, checked?: boolean, dimmed?: boolean, suffix?: string }) {
    return (
        <div className={`flex items-center gap-3 ${dimmed ? 'text-white/30' : 'text-white/80'}`}>
            {checked ? <Check className="w-5 h-5 text-green-400 shrink-0" /> : <X className="w-5 h-5 shrink-0" />}
            <span>{label} {suffix && <span className="text-xs opacity-70 ml-1">{suffix}</span>}</span>
        </div>
    );
}

// --- Comparison Table ---
function ComparisonTable() {
    const features = [
        {
            category: "Canais & Atendimento", items: [
                { name: "Conexões WhatsApp", starter: "1", pro: "2", business: "4", enterprise: "Sob Demanda" },
                { name: "Usuários", starter: "5", pro: "15", business: "35", enterprise: "Sob Demanda" },
                { name: "Departamentos", starter: false, pro: true, business: true, enterprise: true },
                { name: "Histórico de Mensagens", starter: "3 meses", pro: "12 meses", business: "36 meses", enterprise: "Sob Demanda" },
            ]
        },
        {
            category: "Inteligência Artificial", items: [
                { name: "IA Treinável (BYOK)", starter: true, pro: true, business: true, enterprise: true },
                { name: "Transcrição de Áudio", starter: false, pro: true, business: true, enterprise: true },
                { name: "Respostas Automáticas", starter: true, pro: true, business: true, enterprise: true },
            ]
        },
        {
            category: "Recursos Avançados", items: [
                { name: "Disparos em Massa", starter: false, pro: "Moderado", business: "Alto (CSV)", enterprise: "Alto (CSV)" },
                { name: "API de Desenvolvedor", starter: false, pro: false, business: true, enterprise: true },
                { name: "Webhooks", starter: false, pro: false, business: true, enterprise: true },
            ]
        },
        {
            category: "Suporte & SLA", items: [
                { name: "SLA de Uptime", starter: "99.0%", pro: "99.9%", business: "99.9%", enterprise: "99.99%" },
                { name: "Tempo de Resposta", starter: "48h", pro: "24h", business: "12h", enterprise: "4h" },
                { name: "Gerente de Contas", starter: false, pro: false, business: false, enterprise: true },
            ]
        }
    ];

    return (
        <div className="w-full overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                    <tr>
                        <th className="p-4 text-white/40 font-medium w-1/4">Recursos</th>
                        <th className="p-4 text-white font-bold text-center w-[18%]">Starter</th>
                        <th className="p-4 text-blue-400 font-bold text-center w-[18%]">Pro</th>
                        <th className="p-4 text-white font-bold text-center w-[18%]">Business</th>
                        <th className="p-4 text-white font-bold text-center w-[18%]">Enterprise</th>
                    </tr>
                </thead>
                <tbody className="text-white/70">
                    {features.map((section, i) => (
                        <React.Fragment key={i}>
                            <tr>
                                <td colSpan={5} className="p-4 pt-8 text-white font-semibold bg-white/5">{section.category}</td>
                            </tr>
                            {section.items.map((feat, j) => (
                                <tr key={j} className="border-b border-white/5 hover:bg-white/[0.02]">
                                    <td className="p-4">{feat.name}</td>
                                    <td className="p-4 text-center">{renderValue(feat.starter)}</td>
                                    <td className="p-4 text-center font-medium text-white">{renderValue(feat.pro)}</td>
                                    <td className="p-4 text-center">{renderValue(feat.business)}</td>
                                    <td className="p-4 text-center">{renderValue(feat.enterprise)}</td>
                                </tr>
                            ))}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function renderValue(val: string | boolean) {
    if (val === true) return <Check className="w-5 h-5 text-green-400 mx-auto" />;
    if (val === false) return <div className="w-4 h-0.5 bg-white/10 mx-auto" />;
    return val;
}

// --- FAQ Component ---
function FAQ() {
    const [openIndex, setOpenIndex] = useState<number | null>(0);

    const faqs = [
        { q: "Posso cancelar a qualquer momento?", a: "Sim, sem contratos de fidelidade para os planos Starter e Pro. Você pode cancelar quando quiser através do painel." },
        { q: "O que acontece se eu ultrapassar os limites?", a: "Entraremos em contato para sugerir um upgrade. Não bloqueamos seu serviço imediatamente, respeitamos sua operação." },
        { q: "Posso trazer meu próprio número?", a: "Sim! Você conecta seu número existente através da leitura do QR Code, sem perder histórico." },
        { q: "A API é cobrada a parte?", a: "A API está inclusa no plano Business e Enterprise. Não há custos por requisição, apenas o valor fixo do plano." },
        { q: "O que é BYOK (Bring Your Own Key)?", a: "Significa que você usa sua própria chave da OpenAI ou Anthropic. Você paga diretamente a eles pelo consumo de IA, garantindo o menor custo possível." },
    ];

    return (
        <div className="space-y-4 max-w-3xl mx-auto">
            {faqs.map((item, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                    <button
                        onClick={() => setOpenIndex(openIndex === i ? null : i)}
                        className="w-full p-6 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
                    >
                        <span className="font-semibold text-white">{item.q}</span>
                        <ChevronDown className={`w-5 h-5 text-white/50 transition-transform ${openIndex === i ? 'rotate-180' : ''}`} />
                    </button>
                    <motion.div
                        initial={false}
                        animate={{ height: openIndex === i ? 'auto' : 0 }}
                        className="overflow-hidden"
                    >
                        <div className="p-6 pt-0 text-white/60 leading-relaxed">
                            {item.a}
                        </div>
                    </motion.div>
                </div>
            ))}
        </div>
    );
}

// --- Main Page ---
export default function PricingPage() {
    const [prices, setPrices] = useState<Record<string, string>>({});

    useEffect(() => {
        getPublicPlanPricesAction().then(res => {
            if (res.prices) setPrices(res.prices);
        });
    }, []);

    return (
        <div className={`min-h-screen w-full bg-[${darkBg}] selection:bg-blue-500/30 selection:text-white pb-32`}>
            {/* Background */}
            <div className="fixed inset-0 -z-10 overflow-hidden">
                <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" />
                <GradientOrb className="w-[60vw] h-[60vw] -top-[20%] left-[20%]" color="#1e3a8a" />
            </div>

            <Navbar />

            <main className="pt-40 px-6">
                {/* Hero */}
                <section className="text-center max-w-4xl mx-auto mb-24">
                    <Badge className="mb-8">Investimento que se paga</Badge>
                    <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-8 tracking-tight">
                        Preços simples para <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                            resultadas extraordinários
                        </span>
                    </h1>
                    <p className="text-xl text-white/60 max-w-2xl mx-auto">
                        Escolha o plano ideal para sua fase atual. Faça upgrade ou downgrade a qualquer momento conforme sua equipe escala.
                    </p>
                </section>

                {/* Plan Cards */}
                <section className="max-w-7xl mx-auto mb-32">
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <PricingCard plan={PLANS.starter} dynamicPriceId={prices['starter']} />
                        <PricingCard plan={PLANS.pro} popular={true} dynamicPriceId={prices['pro']} />
                        <PricingCard plan={PLANS.business} dynamicPriceId={prices['business']} />
                        <PricingCard plan={PLANS.enterprise} />
                    </div>
                </section>

                {/* Comparison Table */}
                <section className="max-w-7xl mx-auto mb-32">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold text-white mb-4">Comparativo Detalhado</h2>
                        <p className="text-white/50">Entenda cada detalhe do que cada plano oferece.</p>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-[#0f172a]/50 backdrop-blur-sm overflow-hidden p-2">
                        <ComparisonTable />
                    </div>
                </section>

                {/* FAQ */}
                <section className="max-w-3xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold text-white mb-4">Dúvidas Frequentes</h2>
                    </div>
                    <FAQ />
                </section>

                {/* Bottom CTA */}
                <section className="mt-32 text-center">
                    <div className="inline-flex p-12 rounded-3xl bg-gradient-to-b from-blue-900/20 to-transparent border border-white/10 flex-col items-center">
                        <Shield className="w-12 h-12 text-blue-400 mb-6" />
                        <h2 className="text-3xl font-bold text-white mb-4">Garantia de 7 dias</h2>
                        <p className="text-white/60 mb-8 max-w-md">
                            Teste o Dialogy sem riscos. Se não ficar satisfeito na primeira semana, devolvemos 100% do seu dinheiro.
                        </p>
                        <CTAButton href="/register" className="px-10 py-4 text-lg">Começar Teste Grátis</CTAButton>
                    </div>
                </section>
            </main>

            <Footer />
        </div>
    );
}
