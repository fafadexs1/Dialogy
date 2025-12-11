'use client';

import { motion } from 'framer-motion';
import { Ticket, BookOpen, MessageCircle, Search, ArrowRight, LifeBuoy, ShieldCheck, Mail, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
            opacity: 1,
            transition: { type: 'spring', stiffness: 100 }
        }
    };

    return (
        <div className="flex-1 overflow-y-auto bg-muted/30">
            <motion.div
                className="max-w-6xl mx-auto p-8 space-y-12"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
            >
                {/* Header Section */}
                <motion.div variants={itemVariants} className="text-center space-y-6 py-10">
                    <Badge variant="secondary" className="px-4 py-1.5 rounded-full text-foreground text-sm font-medium mb-4 shadow-sm border">
                        <Sparkles className="w-3 h-3 mr-2" /> Central de Suporte Premium
                    </Badge>
                    <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground">
                        Como podemos <span className="text-primary">ajudar você?</span>
                    </h1>
                    <p className="text-muted-foreground text-xl max-w-2xl mx-auto leading-relaxed">
                        Encontre respostas rápidas, explore nossa documentação detalhada ou fale diretamente com nossos especialistas.
                    </p>

                    {/* Search Bar */}
                    <div className="max-w-2xl mx-auto relative group">
                        <div className="relative">
                            <Search className="absolute left-6 top-1/2 transform -translate-y-1/2 h-6 w-6 text-muted-foreground group-focus-within:text-primary transition-colors" />
                            <Input
                                placeholder="Busque por dúvidas, tutoriais ou tópicos..."
                                className="pl-16 h-16 text-lg rounded-2xl border-input bg-background shadow-lg shadow-black/5 focus-visible:ring-primary/20 transition-all"
                            />
                        </div>
                    </div>
                </motion.div>

                {/* Main Action Cards */}
                <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Link href="/support/tickets/new" className="group">
                        <Card className="h-full border-border bg-card hover:bg-accent/50 hover:border-primary/50 transition-all duration-300 shadow-sm hover:shadow-lg rounded-3xl overflow-hidden relative group-hover:-translate-y-1">
                            <CardHeader>
                                <div className="h-14 w-14 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-4 text-blue-600 transition-transform duration-300 group-hover:scale-110">
                                    <Ticket className="h-7 w-7" />
                                </div>
                                <CardTitle className="text-2xl font-bold group-hover:text-primary transition-colors">Abrir Chamado</CardTitle>
                                <CardDescription className="text-muted-foreground text-base leading-relaxed">
                                    Relate problemas técnicos, solicite recursos ou tire dúvidas complexas com nossa equipe.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center text-sm font-semibold text-primary bg-primary/10 w-fit px-4 py-2 rounded-full group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                                    Iniciar Atendimento <ArrowRight className="ml-2 h-4 w-4" />
                                </div>
                            </CardContent>
                        </Card>
                    </Link>

                    <Link href="/support/tickets" className="group">
                        <Card className="h-full border-border bg-card hover:bg-accent/50 hover:border-primary/50 transition-all duration-300 shadow-sm hover:shadow-lg rounded-3xl overflow-hidden relative group-hover:-translate-y-1">
                            <CardHeader>
                                <div className="h-14 w-14 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-4 text-violet-600 transition-transform duration-300 group-hover:scale-110">
                                    <MessageCircle className="h-7 w-7" />
                                </div>
                                <CardTitle className="text-2xl font-bold group-hover:text-primary transition-colors">Meus Tickets</CardTitle>
                                <CardDescription className="text-muted-foreground text-base leading-relaxed">
                                    Acompanhe o status e histórico de todas as suas solicitações em tempo real.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center text-sm font-semibold text-primary bg-primary/10 w-fit px-4 py-2 rounded-full group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                                    Ver Histórico <ArrowRight className="ml-2 h-4 w-4" />
                                </div>
                            </CardContent>
                        </Card>
                    </Link>

                    <Link href="https://docs.dialogy.app" target="_blank" className="group">
                        <Card className="h-full border-border bg-card hover:bg-accent/50 hover:border-primary/50 transition-all duration-300 shadow-sm hover:shadow-lg rounded-3xl overflow-hidden relative group-hover:-translate-y-1">
                            <CardHeader>
                                <div className="h-14 w-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-4 text-emerald-600 transition-transform duration-300 group-hover:scale-110">
                                    <BookOpen className="h-7 w-7" />
                                </div>
                                <CardTitle className="text-2xl font-bold group-hover:text-primary transition-colors">Documentação</CardTitle>
                                <CardDescription className="text-muted-foreground text-base leading-relaxed">
                                    Acesse guias passo-a-passo, tutoriais em vídeo e referências da API.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center text-sm font-semibold text-primary bg-primary/10 w-fit px-4 py-2 rounded-full group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                                    Ler Tutoriais <ArrowRight className="ml-2 h-4 w-4" />
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                </motion.div>

                {/* FAQ & Contact Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* FAQ */}
                    <motion.div variants={itemVariants} className="lg:col-span-2 space-y-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold flex items-center gap-2 text-foreground">
                                <LifeBuoy className="h-6 w-6 text-primary" />
                                Perguntas Frequentes
                            </h2>
                            <Button variant="ghost" className="text-muted-foreground hover:text-primary">Ver todas</Button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[
                                { q: "Como configurar o WhatsApp?", a: "Guia completo de conexão QR Code" },
                                { q: "Onde vejo minhas faturas?", a: "Configurações > Cobrança" },
                                { q: "Como criar um Agente de IA?", a: "Automações > Agentes Inteligentes" },
                                { q: "Integração via Webhooks", a: "Documentação de API para devs" },
                            ].map((item, index) => (
                                <div key={index} className="p-5 rounded-2xl border border-border bg-card hover:bg-accent hover:border-primary/30 transition-all cursor-pointer group shadow-sm">
                                    <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors mb-2 text-lg">{item.q}</h4>
                                    <p className="text-sm text-muted-foreground">{item.a}</p>
                                </div>
                            ))}
                        </div>
                    </motion.div>

                    {/* Contact Info */}
                    <motion.div variants={itemVariants} className="lg:col-span-1">
                        <div className="h-full p-8 rounded-3xl bg-zinc-950 text-white relative overflow-hidden flex flex-col justify-between border border-zinc-800 shadow-xl">
                            {/* Subtle glow effect */}
                            <div className="absolute top-0 right-0 w-48 h-48 bg-blue-600/20 blur-[60px] rounded-full -mr-12 -mt-12 pointer-events-none" />

                            <div className="space-y-6 relative z-10">
                                <h3 className="text-2xl font-bold flex items-center gap-2">
                                    <ShieldCheck className="h-6 w-6 text-emerald-400" />
                                    Suporte Enterprise
                                </h3>
                                <p className="text-zinc-400 text-base leading-relaxed">
                                    Clientes do plano Enterprise possuem atendimento prioritário exclusivo via WhatsApp e Telefone com tempo de resposta garantido.
                                </p>
                            </div>

                            <div className="mt-8 space-y-4 relative z-10">
                                <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                                    <Mail className="h-5 w-5 text-zinc-300" />
                                    <span className="text-base font-medium">enterprise@dialogy.app</span>
                                </div>
                                <Button className="w-full bg-white text-black hover:bg-zinc-200 font-bold h-12 text-base rounded-xl" variant="default">
                                    Falar com Gerente de Contas
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </motion.div>
        </div>
    );
}
