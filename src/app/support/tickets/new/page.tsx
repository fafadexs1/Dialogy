'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion } from 'framer-motion';
import { ArrowLeft, Send, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
            // TODO: Call server action to create ticket
            console.log('Form data:', data);

            // Simulate API call
            await new Promise(resolve => setTimeout(resolve, 1500));

            toast({
                title: "Ticket criado com sucesso!",
                description: "Nossa equipe responderá em breve.",
            });

            router.push('/support/tickets');
        } catch (error) {
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
        <div className="flex-1 p-8 overflow-y-auto bg-zinc-50/50 dark:bg-zinc-900/50">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-2xl mx-auto space-y-8"
            >
                <div className="flex items-center gap-4">
                    <Link href="/support">
                        <Button variant="ghost" size="icon" className="rounded-full">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Novo Chamado</h1>
                        <p className="text-muted-foreground">Preencha os detalhes abaixo para abrir um novo ticket.</p>
                    </div>
                </div>

                <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg">
                    <CardHeader>
                        <CardTitle>Detalhes da Solicitação</CardTitle>
                        <CardDescription>
                            Forneça o máximo de informações possível para nos ajudar a resolver seu problema mais rápido.
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
                                                <Input placeholder="Ex: Erro ao integrar WhatsApp" {...field} />
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
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Selecione..." />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="technical">Suporte Técnico</SelectItem>
                                                        <SelectItem value="billing">Financeiro</SelectItem>
                                                        <SelectItem value="feature">Sugestão de Recurso</SelectItem>
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
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Selecione..." />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="low">Baixa</SelectItem>
                                                        <SelectItem value="medium">Média</SelectItem>
                                                        <SelectItem value="high">Alta</SelectItem>
                                                        <SelectItem value="critical">Crítica</SelectItem>
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
                                                    placeholder="Descreva o problema, passos para reproduzir, etc."
                                                    className="min-h-[150px] resize-none"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="flex justify-end pt-4">
                                    <Button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white shadow-lg shadow-blue-500/20"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Enviando...
                                            </>
                                        ) : (
                                            <>
                                                <Send className="mr-2 h-4 w-4" />
                                                Abrir Ticket
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </form>
                        </Form>
                    </CardContent>
                </Card>
            </motion.div>
        </div>
    );
}
