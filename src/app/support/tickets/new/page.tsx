'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion } from 'framer-motion';
import { ArrowLeft, Send, Loader2, Info, Lightbulb, FileText, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createTicket } from '@/actions/support';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const ticketSchema = z.object({
    subject: z.string().min(5, 'O assunto deve ter pelo menos 5 caracteres.'),
    category: z.string().min(1, 'Selecione uma categoria.'),
    priority: z.string().min(1, 'Selecione uma prioridade.'),
    description: z.string().min(10, 'A descrição deve ter pelo menos 10 caracteres.'),
});

type TicketFormValues = z.infer<typeof ticketSchema>;

export default function NewTicketPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const form = useForm<TicketFormValues>({
        resolver: zodResolver(ticketSchema),
        defaultValues: {
            subject: '',
            category: '',
            priority: 'medium',
            description: '',
        },
    });

    async function onSubmit(data: TicketFormValues) {
        setIsSubmitting(true);
        try {
            await createTicket(data);

            toast({
                title: "Ticket criado com sucesso!",
                description: "Sua solicitação foi registrada e nossa equipe responderá em breve.",
            });

            router.push('/support/tickets');
        } catch (error) {
            console.error(error);
            toast({
                title: "Erro ao criar ticket",
                description: "Tente novamente mais tarde.",
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div className="relative flex min-h-screen flex-col overflow-hidden bg-background selection:bg-emerald-500/30">
            {/* Background Effects */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-[20%] left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full bg-emerald-500/5 blur-[120px]" />
                <div className="absolute top-[10%] left-[10%] h-[500px] w-[500px] rounded-full bg-blue-500/5 blur-[100px]" />
                <div className="absolute bottom-[10%] right-[10%] h-[600px] w-[600px] rounded-full bg-violet-500/5 blur-[120px]" />
            </div>

            <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="mb-8 flex items-center gap-4">
                    <Link href="/support">
                        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-white">Novo Chamado</h1>
                        <p className="text-zinc-400">Descreva seu problema para nossa equipe de especialistas.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Form */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="lg:col-span-2"
                    >
                        <Card className="border-white/10 bg-zinc-950/50 backdrop-blur-md shadow-xl">
                            <CardHeader>
                                <CardTitle className="text-xl font-semibold text-white">Detalhes da Solicitação</CardTitle>
                                <CardDescription className="text-zinc-400">
                                    As informações fornecidas aqui nos ajudarão a categorizar e resolver seu problema mais rapidamente.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Form {...form}>
                                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                                        <FormField
                                            control={form.control}
                                            name="subject"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-zinc-300">Assunto</FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            placeholder="Resumo curto do problema"
                                                            className="h-11 border-white/10 bg-black/50 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30"
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <FormField
                                                control={form.control}
                                                name="category"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-zinc-300">Categoria</FormLabel>
                                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                            <FormControl>
                                                                <SelectTrigger className="h-11 border-white/10 bg-black/50 text-zinc-100 placeholder:text-zinc-600 focus:ring-emerald-500/30">
                                                                    <SelectValue placeholder="Selecione..." />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent className="border-white/10 bg-zinc-950 text-zinc-100">
                                                                <SelectItem value="technical" className="focus:bg-emerald-500/10 focus:text-emerald-400">Suporte Técnico</SelectItem>
                                                                <SelectItem value="billing" className="focus:bg-emerald-500/10 focus:text-emerald-400">Financeiro</SelectItem>
                                                                <SelectItem value="feature" className="focus:bg-emerald-500/10 focus:text-emerald-400">Sugestão de Recurso</SelectItem>
                                                                <SelectItem value="access" className="focus:bg-emerald-500/10 focus:text-emerald-400">Problemas de Acesso</SelectItem>
                                                                <SelectItem value="other" className="focus:bg-emerald-500/10 focus:text-emerald-400">Outro</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="priority"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-zinc-300">Prioridade</FormLabel>
                                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                            <FormControl>
                                                                <SelectTrigger className="h-11 border-white/10 bg-black/50 text-zinc-100 placeholder:text-zinc-600 focus:ring-emerald-500/30">
                                                                    <SelectValue placeholder="Selecione..." />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent className="border-white/10 bg-zinc-950 text-zinc-100">
                                                                <SelectItem value="low" className="focus:bg-emerald-500/10 focus:text-emerald-400">Baixa - Dúvidas gerais</SelectItem>
                                                                <SelectItem value="medium" className="focus:bg-emerald-500/10 focus:text-emerald-400">Média - Recurso com falha parcial</SelectItem>
                                                                <SelectItem value="high" className="focus:bg-emerald-500/10 focus:text-emerald-400">Alta - Recurso crítico indisponível</SelectItem>
                                                                <SelectItem value="critical" className="focus:bg-emerald-500/10 focus:text-emerald-400">Crítica - Sistema parado</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>

                                        <FormField
                                            control={form.control}
                                            name="description"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-zinc-300">Descrição Detalhada</FormLabel>
                                                    <FormControl>
                                                        <Textarea
                                                            placeholder="Descreva o que aconteceu, passos para reproduzir o erro, e qualquer outra informação relevante..."
                                                            className="min-h-[200px] resize-none border-white/10 bg-black/50 font-mono text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30"
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormDescription className="text-zinc-500">
                                                        Você pode usar Markdown básico para formatar seu texto.
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <div className="flex justify-end pt-4 border-t border-white/10">
                                            <Button
                                                type="submit"
                                                disabled={isSubmitting}
                                                className="min-w-[180px] rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20 transition-all hover:scale-[1.02] hover:from-emerald-400 hover:to-emerald-500 hover:shadow-emerald-500/40"
                                            >
                                                {isSubmitting ? (
                                                    <>
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                        Enviando...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Send className="mr-2 h-4 w-4" />
                                                        Enviar Solicitação
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    </form>
                                </Form>
                            </CardContent>
                        </Card>
                    </motion.div>

                    {/* Sidebar Context */}
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1 }}
                        className="space-y-6"
                    >
                        <Alert className="border-blue-500/20 bg-blue-500/10 text-blue-400">
                            <Info className="h-4 w-4 text-blue-400" />
                            <AlertTitle className="text-blue-300">Antes de enviar</AlertTitle>
                            <AlertDescription className="text-blue-400/80">
                                Verifique nossa <Link href="#" className="font-medium underline hover:text-blue-300">Base de Conhecimento</Link>. Muitas dúvidas comuns já estão respondidas lá.
                            </AlertDescription>
                        </Alert>

                        <Card className="border-white/10 bg-zinc-950/30 backdrop-blur-md">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-lg text-white">
                                    <Lightbulb className="h-5 w-5 text-amber-500" />
                                    Dicas para um bom ticket
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4 text-sm text-zinc-400">
                                <div className="flex gap-3">
                                    <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-500/80" />
                                    <p>Seja específico no assunto (ex: "Erro 500 ao salvar contato" em vez de "Erro no sistema").</p>
                                </div>
                                <div className="flex gap-3">
                                    <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-500/80" />
                                    <p>Inclua passos para reproduzir o problema.</p>
                                </div>
                                <div className="flex gap-3">
                                    <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-500/80" />
                                    <p>Se possível, inclua IDs ou nomes dos recursos afetados.</p>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-white/10 bg-zinc-950/30 backdrop-blur-md">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-lg text-white">
                                    <FileText className="h-5 w-5 text-emerald-500" />
                                    Artigos Relacionados
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {[
                                    "Como integrar WhatsApp",
                                    "Gerenciando permissões de equipe",
                                    "Configurando webhooks",
                                    "Entendendo sua fatura"
                                ].map((article, i) => (
                                    <Link key={i} href="#" className="block rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white">
                                        {article}
                                    </Link>
                                ))}
                            </CardContent>
                        </Card>
                    </motion.div>
                </div>
            </div>
        </div>
    );
}
