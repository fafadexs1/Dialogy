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
        <div className="flex-1 overflow-y-auto bg-muted/30 p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                {/* Header */}
                <div className="flex items-center gap-4">
                    <Link href="/support">
                        <Button variant="ghost" size="icon" className="rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">Novo Chamado</h1>
                        <p className="text-muted-foreground">Descreva seu problema para nossa equipe de especialistas.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Form */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="lg:col-span-2"
                    >
                        <Card className="border-border bg-card shadow-sm">
                            <CardHeader>
                                <CardTitle>Detalhes da Solicitação</CardTitle>
                                <CardDescription>
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
                                                    <FormLabel>Assunto</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Resumo curto do problema" className="bg-background" {...field} />
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
                                                        <FormLabel>Categoria</FormLabel>
                                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                            <FormControl>
                                                                <SelectTrigger className="bg-background">
                                                                    <SelectValue placeholder="Selecione..." />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                <SelectItem value="technical">Suporte Técnico</SelectItem>
                                                                <SelectItem value="billing">Financeiro</SelectItem>
                                                                <SelectItem value="feature">Sugestão de Recurso</SelectItem>
                                                                <SelectItem value="access">Problemas de Acesso</SelectItem>
                                                                <SelectItem value="other">Outro</SelectItem>
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
                                                        <FormLabel>Prioridade</FormLabel>
                                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                            <FormControl>
                                                                <SelectTrigger className="bg-background">
                                                                    <SelectValue placeholder="Selecione..." />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                <SelectItem value="low">Baixa - Dúvidas gerais</SelectItem>
                                                                <SelectItem value="medium">Média - Recurso com falha parcial</SelectItem>
                                                                <SelectItem value="high">Alta - Recurso crítico indisponível</SelectItem>
                                                                <SelectItem value="critical">Crítica - Sistema parado</SelectItem>
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
                                                    <FormLabel>Descrição Detalhada</FormLabel>
                                                    <FormControl>
                                                        <Textarea
                                                            placeholder="Descreva o que aconteceu, passos para reproduzir o erro, e qualquer outra informação relevante..."
                                                            className="min-h-[200px] resize-none bg-background font-mono text-sm leading-relaxed"
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormDescription>
                                                        Você pode usar Markdown básico para formatar seu texto.
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <div className="flex justify-end pt-4 border-t">
                                            <Button
                                                type="submit"
                                                disabled={isSubmitting}
                                                className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[150px]"
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
                        <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400">
                            <Info className="h-4 w-4" />
                            <AlertTitle>Antes de enviar</AlertTitle>
                            <AlertDescription>
                                Verifique nossa <Link href="#" className="underline font-medium hover:text-primary">Base de Conhecimento</Link>. Muitas dúvidas comuns já estão respondidas lá.
                            </AlertDescription>
                        </Alert>

                        <Card className="bg-card/50 border-border">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Lightbulb className="h-5 w-5 text-amber-500" />
                                    Dicas para um bom ticket
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4 text-sm text-muted-foreground">
                                <div className="flex gap-3">
                                    <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                                    <p>Seja específico no assunto (ex: "Erro 500 ao salvar contato" em vez de "Erro no sistema").</p>
                                </div>
                                <div className="flex gap-3">
                                    <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                                    <p>Inclua passos para reproduzir o problema.</p>
                                </div>
                                <div className="flex gap-3">
                                    <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                                    <p>Se possível, inclua IDs ou nomes dos recursos afetados.</p>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="bg-card/50 border-border">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <FileText className="h-5 w-5 text-primary" />
                                    Artigos Relacionados
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {[
                                    "Como integrar WhatsApp",
                                    "Gerenciando permissões de equipe",
                                    "Configurando webhooks",
                                    "Entendendo sua fatura"
                                ].map((article, i) => (
                                    <Link key={i} href="#" className="block p-3 rounded-lg hover:bg-accent transition-colors text-sm font-medium text-foreground">
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
