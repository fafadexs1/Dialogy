'use client';

import { motion } from 'framer-motion';
import { Ticket, BookOpen, MessageCircle, Search, ArrowRight, LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function SupportPage() {
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1
            }
        }
    };

    const itemVariants = {
        hidden: { y: 20, opacity: 0 },
        visible: {
            y: 0,
            opacity: 1
        }
    };

    return (
        <div className="flex-1 p-8 overflow-y-auto bg-zinc-50/50 dark:bg-zinc-900/50">
            <motion.div
                className="max-w-5xl mx-auto space-y-8"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
            >
                {/* Header */}
                <motion.div variants={itemVariants} className="space-y-4 text-center md:text-left">
                    <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
                        Central de Ajuda
                    </h1>
                    <p className="text-muted-foreground text-lg max-w-2xl">
                        Como podemos ajudar você hoje? Encontre respostas, documentação ou entre em contato com nosso suporte.
                    </p>
                </motion.div>

                {/* Search */}
                <motion.div variants={itemVariants} className="relative max-w-2xl">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                            placeholder="Busque por dúvidas frequentes..."
                            className="pl-12 h-14 text-lg rounded-2xl shadow-sm border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 focus-visible:ring-blue-500"
                        />
                    </div>
                </motion.div>

                {/* Quick Actions */}
                <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Link href="/support/tickets/new">
                        <Card className="h-full hover:shadow-lg transition-all duration-300 border-zinc-200 dark:border-zinc-800 group cursor-pointer bg-white dark:bg-zinc-950">
                            <CardHeader>
                                <div className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                                    <Ticket className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                                </div>
                                <CardTitle>Abrir Chamado</CardTitle>
                                <CardDescription>
                                    Relate um problema ou solicite ajuda técnica.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center text-sm font-medium text-blue-600 dark:text-blue-400">
                                    Iniciar atendimento <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </CardContent>
                        </Card>
                    </Link>

                    <Link href="/support/tickets">
                        <Card className="h-full hover:shadow-lg transition-all duration-300 border-zinc-200 dark:border-zinc-800 group cursor-pointer bg-white dark:bg-zinc-950">
                            <CardHeader>
                                <div className="h-12 w-12 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                                    <MessageCircle className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                                </div>
                                <CardTitle>Meus Tickets</CardTitle>
                                <CardDescription>
                                    Acompanhe o status dos seus atendimentos.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center text-sm font-medium text-violet-600 dark:text-violet-400">
                                    Ver histórico <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </CardContent>
                        </Card>
                    </Link>

                    <Link href="https://docs.dialogy.app" target="_blank">
                        <Card className="h-full hover:shadow-lg transition-all duration-300 border-zinc-200 dark:border-zinc-800 group cursor-pointer bg-white dark:bg-zinc-950">
                            <CardHeader>
                                <div className="h-12 w-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                                    <BookOpen className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <CardTitle>Documentação</CardTitle>
                                <CardDescription>
                                    Tutoriais e guias para usar a plataforma.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                    Acessar base de conhecimento <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                </motion.div>

                {/* FAQ Section */}
                <motion.div variants={itemVariants} className="space-y-6">
                    <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                        <LifeBuoy className="h-6 w-6 text-muted-foreground" />
                        Dúvidas Frequentes
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                            "Como configurar o WhatsApp?",
                            "Como criar um Agente de IA?",
                            "Integração com Webhooks",
                            "Planos e Faturamento"
                        ].map((faq, index) => (
                            <Card key={index} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors cursor-pointer border-zinc-200 dark:border-zinc-800">
                                <CardContent className="p-4 flex items-center justify-between">
                                    <span className="font-medium">{faq}</span>
                                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </motion.div>
            </motion.div>
        </div>
    );
}
