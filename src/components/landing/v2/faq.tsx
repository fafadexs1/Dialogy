'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, Minus, Plus } from 'lucide-react';
import { HOME_FAQ_ITEMS } from '@/content/home-seo';
import { SectionHeading, Mark, CtaSecondary } from './brand';
import { cn } from '@/lib/utils';

export function Faq() {
    const [open, setOpen] = React.useState<number | null>(0);

    return (
        <section id="faq" className="bg-white py-20 sm:py-28">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <SectionHeading
                    accent="blue"
                    eyebrow={
                        <>
                            <HelpCircle className="h-3.5 w-3.5" />
                            Perguntas frequentes
                        </>
                    }
                    title={
                        <>
                            Antes de testar, <Mark tone="blue">tire suas dúvidas.</Mark>
                        </>
                    }
                    description="Se ficar faltando alguma coisa, é só chamar no WhatsApp — respondemos usando a própria Dialogy."
                />

                <div className="mx-auto mt-14 max-w-3xl divide-y divide-slate-100 overflow-hidden rounded-[28px] border border-slate-200/80 bg-white">
                    {HOME_FAQ_ITEMS.map((item, index) => {
                        const isOpen = open === index;
                        return (
                            <div key={item.question}>
                                <button
                                    type="button"
                                    onClick={() => setOpen(isOpen ? null : index)}
                                    aria-expanded={isOpen}
                                    className="flex w-full items-center gap-4 px-6 py-5 text-left transition-colors hover:bg-slate-50/80 sm:px-7"
                                >
                                    <span className="flex-1 text-[1.02rem] font-bold leading-snug text-slate-900">
                                        {item.question}
                                    </span>
                                    <span
                                        className={cn(
                                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
                                            isOpen ? 'bg-brand-green text-slate-900' : 'bg-slate-100 text-slate-500',
                                        )}
                                    >
                                        {isOpen ? (
                                            <Minus className="h-4 w-4" strokeWidth={3} />
                                        ) : (
                                            <Plus className="h-4 w-4" strokeWidth={3} />
                                        )}
                                    </span>
                                </button>
                                <AnimatePresence initial={false}>
                                    {isOpen ? (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.25, ease: 'easeInOut' }}
                                            className="overflow-hidden"
                                        >
                                            <p className="px-6 pb-6 pr-16 text-[0.95rem] leading-relaxed text-slate-600 sm:px-7 sm:pr-20">
                                                {item.answer}
                                            </p>
                                        </motion.div>
                                    ) : null}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                </div>

                <div className="mt-8 flex justify-center">
                    <CtaSecondary href="https://wa.me/551151994714">
                        Ainda tenho dúvidas — falar com alguém
                    </CtaSecondary>
                </div>
            </div>
        </section>
    );
}
