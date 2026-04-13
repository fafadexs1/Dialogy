"use client";

import { MessageSquare, Route, ShoppingCart, Sparkles, Users, Workflow } from 'lucide-react';
import { motion } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';

const features = [
    {
        title: 'API Oficial do WhatsApp',
        description: 'Vincule seu número oficial e escale com disparos em massa sem risco de banimentos. Compliance total com a Meta.',
        icon: <MessageSquare className="h-6 w-6 text-emerald-600" />,
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/20',
        span: 'md:col-span-2', // Large feature
    },
    {
        title: 'Inbox Compartilhado',
        description: 'Múltiplos atendentes em uma única tela fluida e colaborativa.',
        icon: <Users className="h-6 w-6 text-blue-600" />,
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/20',
        span: 'md:col-span-1',
    },
    {
        title: 'Copiloto de IA',
        description: 'Treine a IA com o conteúdo do seu negócio para resumir conversas longas e sugerir respostas imediatas.',
        icon: <Sparkles className="h-6 w-6 text-indigo-600" />,
        bg: 'bg-indigo-500/10',
        border: 'border-indigo-500/20',
        span: 'md:col-span-1',
    },
    {
        title: 'Roteamento Inteligente',
        description: 'Crie regras visuais (arrastar e soltar) para distribuir o atendimento entre setores.',
        icon: <Route className="h-6 w-6 text-rose-600" />,
        bg: 'bg-rose-500/10',
        border: 'border-rose-500/20',
        span: 'md:col-span-2', // Large feature
    },
    {
        title: 'Catálogo e Pagamentos',
        description: 'Integre integrações de estoque e envie links de pagamento diretos no chat.',
        icon: <ShoppingCart className="h-6 w-6 text-amber-600" />,
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20',
        span: 'md:col-span-2 lg:col-span-1',
    },
    {
        title: 'Automações de CRM',
        description: 'Atualize funis e acione campanhas comerciais no piloto automático com webhooks.',
        icon: <Workflow className="h-6 w-6 text-teal-600" />,
        bg: 'bg-teal-500/10',
        border: 'border-teal-500/20',
        span: 'md:col-span-2 lg:col-span-2', // Extra large
    },
];

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1,
            delayChildren: 0.2,
        },
    },
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

export const AsymmetricFeatures = () => {
    const isMobile = useIsMobile();
    const headerMotionProps = {
        initial: { opacity: 0, y: 20 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: "-100px" },
        transition: { duration: 0.7 },
    };
    const gridMotionProps = {
        variants: containerVariants,
        initial: 'hidden' as const,
        whileInView: 'visible' as const,
        viewport: { once: true, margin: "-50px" },
    };
    const itemMotionProps = { variants: itemVariants };

    return (
        <section id="features" className="relative overflow-hidden border-b border-zinc-200/50 bg-[#FAFAFA] py-32">
            <div className="pointer-events-none absolute left-1/2 top-0 hidden h-[600px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-50/60 blur-[120px] md:block" />

            <div className="relative z-10 mx-auto max-w-7xl px-6">
                <motion.div 
                    {...headerMotionProps}
                    className="mx-auto mb-20 max-w-3xl text-center"
                >
                    <h2 className="mb-6 text-4xl font-extrabold leading-tight tracking-tight text-zinc-900 md:text-5xl lg:text-6xl">
                        Poder absoluto para orquestrar <br className="hidden md:block" />
                        operações <span className="text-zinc-500">inteiras.</span>
                    </h2>

                    <p className="text-lg font-medium leading-relaxed text-zinc-600 md:text-xl">
                        Tudo o que sua empresa precisa para escalar vendas e suporte, do roteamento ao pagamento, dentro das principais redes sociais do mundo.
                    </p>
                </motion.div>

                <motion.div 
                    {...gridMotionProps}
                    className="grid grid-cols-1 gap-6 md:grid-cols-3"
                >
                    {features.map((feature) => (
                        <motion.div
                            {...itemMotionProps}
                            key={feature.title}
                            className={`group relative flex cursor-default flex-col items-start overflow-hidden rounded-[2rem] border border-zinc-200/60 bg-white p-8 transition-colors duration-500 ease-out md:transition-all md:hover:-translate-y-1 md:hover:border-zinc-300 md:hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] ${feature.span}`}
                        >
                            <div className="absolute -right-12 -top-12 hidden h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100 dark:opacity-20 bg-current mix-blend-multiply md:block" />
                            
                            <div className={`mb-8 flex h-14 w-14 items-center justify-center rounded-2xl border md:transition-transform md:duration-500 md:group-hover:scale-110 md:group-hover:shadow-md ${feature.bg} ${feature.border}`}>
                                {feature.icon}
                            </div>

                            <h3 className="mb-3 text-2xl font-bold tracking-tight text-zinc-900">
                                {feature.title}
                            </h3>

                            <p className="font-medium leading-relaxed text-zinc-600 line-clamp-3">
                                {feature.description}
                            </p>
                        </motion.div>
                    ))}
                </motion.div>
            </div>
        </section>
    );
};
