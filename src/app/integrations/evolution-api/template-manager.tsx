
'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PlusCircle, Trash2, Loader2, Save, MessageSquarePlus, Copy, Code, RefreshCw, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { createWhatsappTemplate, findWhatsappTemplates } from '@/actions/evolution-api';
import type { EvolutionInstance } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TemplateManagerProps {
    instances: Omit<EvolutionInstance, 'status' | 'qrCode'>[];
}

type TemplateComponent = {
    type: 'BODY' | 'HEADER' | 'FOOTER' | 'BUTTONS';
    text?: string;
    format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
    buttons?: TemplateButton[];
    example?: any;
};

type TemplateButton = {
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
    text: string;
    url?: string;
    phone_number?: string;
};

export function TemplateManager({ instances }: TemplateManagerProps) {
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Form state
    const [instanceName, setInstanceName] = useState('');
    const [templateName, setTemplateName] = useState('');
    const [category, setCategory] = useState('UTILITY');
    const [language, setLanguage] = useState('pt_BR');
    const [bodyText, setBodyText] = useState('');
    const [bodyExample, setBodyExample] = useState('');
    const [buttons, setButtons] = useState<TemplateButton[]>([]);
    
    // Template list state
    const [templates, setTemplates] = useState<any[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);

    const handleAddButton = (type: 'QUICK_REPLY' | 'URL') => {
        if (buttons.length >= 3) {
            toast({ title: 'Limite de botões atingido', description: 'Você pode adicionar no máximo 3 botões.', variant: 'destructive' });
            return;
        }
        setButtons([...buttons, { type, text: '' }]);
    };

    const handleRemoveButton = (index: number) => {
        setButtons(buttons.filter((_, i) => i !== index));
    };

    const handleButtonChange = (index: number, field: keyof TemplateButton, value: string) => {
        const newButtons = [...buttons];
        newButtons[index] = { ...newButtons[index], [field]: value };
        setButtons(newButtons);
    };
    
    const resetForm = () => {
        setInstanceName('');
        setTemplateName('');
        setCategory('UTILITY');
        setLanguage('pt_BR');
        setBodyText('');
        setBodyExample('');
        setButtons([]);
    }
    
    const fetchTemplates = async (name: string) => {
        if (!name) return;
        setLoadingTemplates(true);
        const result = await findWhatsappTemplates(name);
        if(result.error) {
            toast({ title: 'Erro ao buscar templates', description: result.error, variant: 'destructive' });
            setTemplates([]);
        } else {
            setTemplates(result.templates || []);
        }
        setLoadingTemplates(false);
    }
    
    useEffect(() => {
        if (instanceName) {
            fetchTemplates(instanceName);
        } else {
            setTemplates([]);
        }
    }, [instanceName]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        
        let parsedBodyExample;
        try {
            if(bodyExample.trim()) {
                parsedBodyExample = JSON.parse(bodyExample);
            }
        } catch (error) {
            toast({ title: 'JSON inválido', description: 'O JSON no exemplo do corpo da mensagem é inválido.', variant: 'destructive' });
            setIsSubmitting(false);
            return;
        }

        const payload = {
            name: templateName,
            category: category,
            language: language,
            components: [
                { type: 'BODY', text: bodyText, example: parsedBodyExample ? { body_text: parsedBodyExample } : undefined },
                ...(buttons.length > 0 ? [{ type: 'BUTTONS', buttons: buttons }] : [])
            ]
        };

        const result = await createWhatsappTemplate(instanceName, payload);

        if (result.success) {
            toast({ title: 'Template Criado!', description: 'Seu template foi enviado para aprovação pela Meta.' });
            setIsOpen(false);
            resetForm();
            fetchTemplates(instanceName);
        } else {
            toast({ title: 'Erro ao Criar Template', description: result.error, variant: 'destructive' });
        }
        setIsSubmitting(false);
    };

    return (
        <Card>
            <CardHeader className='flex-row justify-between items-center'>
                <div>
                    <CardTitle>Gerenciador de Templates</CardTitle>
                    <CardDescription>Crie e visualize seus templates de mensagem para a Cloud API.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    <Select value={instanceName} onValueChange={setInstanceName} required>
                        <SelectTrigger className="w-[250px]"><SelectValue placeholder="Selecione uma instância..."/></SelectTrigger>
                        <SelectContent>
                            {instances.map(inst => <SelectItem key={inst.id} value={inst.instance_name}>{inst.display_name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                     <Button onClick={() => fetchTemplates(instanceName)} variant="outline" size="icon" disabled={loadingTemplates || !instanceName}>
                        <RefreshCw className={loadingTemplates ? 'animate-spin' : ''}/>
                    </Button>
                    <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if(!open) resetForm(); }}>
                        <DialogTrigger asChild>
                            <Button disabled={!instanceName}><PlusCircle className='mr-2'/> Criar Template</Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl">
                            <form onSubmit={handleSubmit}>
                                <DialogHeader>
                                    <DialogTitle>Criar Novo Template para: <span className="text-primary">{instanceName}</span></DialogTitle>
                                    <DialogDescription>
                                        Este template será enviado para a Meta para aprovação. Siga as <a href="https://developers.facebook.com/docs/whatsapp/message-templates/guidelines" target="_blank" rel="noopener noreferrer" className="underline">diretrizes</a>.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto px-1">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="name">Nome do Template</Label>
                                            <Input id="name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} required placeholder="ex: pedido_confirmado" />
                                            <p className="text-xs text-muted-foreground">Apenas letras minúsculas, números e underscores (_).</p>
                                        </div>
                                         <div className="space-y-2">
                                            <Label htmlFor="category">Categoria</Label>
                                            <Select value={category} onValueChange={setCategory} required>
                                                <SelectTrigger id="category"><SelectValue/></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="UTILITY">Utilidade</SelectItem>
                                                    <SelectItem value="MARKETING">Marketing</SelectItem>
                                                    <SelectItem value="AUTHENTICATION">Autenticação</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                       
                                        <div className="space-y-2">
                                            <Label htmlFor="language">Idioma</Label>
                                            <Select value={language} onValueChange={setLanguage} required>
                                                <SelectTrigger id="language"><SelectValue/></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="pt_BR">Português (Brasil)</SelectItem>
                                                    <SelectItem value="en_US">Inglês (EUA)</SelectItem>
                                                    <SelectItem value="es_ES">Espanhol (Espanha)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    
                                    <Accordion type="multiple" defaultValue={['body']} className="w-full">
                                        <AccordionItem value="body">
                                            <AccordionTrigger>Corpo da Mensagem (Body)</AccordionTrigger>
                                            <AccordionContent className="space-y-4 pt-2">
                                                <div className="space-y-2">
                                                    <Label htmlFor="body-text">Texto do Corpo</Label>
                                                    <Textarea id="body-text" value={bodyText} onChange={e => setBodyText(e.target.value)} placeholder="Olá {{1}}, seu pedido nº {{2}} foi confirmado." required/>
                                                    <p className="text-xs text-muted-foreground">Use variáveis como {"{{1}}"}, {"{{2}}"}, etc.</p>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="body-example">Exemplo do Corpo (JSON)</Label>
                                                    <Textarea id="body-example" value={bodyExample} onChange={e => setBodyExample(e.target.value)} className="font-mono text-xs" placeholder='[["Fulano", "XYZ-1234"]]'/>
                                                    <p className="text-xs text-muted-foreground">Forneça um array JSON de exemplos para as variáveis. Ex: `[["Maria","12345"]]`</p>
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                        <AccordionItem value="buttons">
                                            <AccordionTrigger>Botões</AccordionTrigger>
                                            <AccordionContent className="space-y-4 pt-2">
                                                <div className="space-y-2">
                                                    {buttons.map((button, index) => (
                                                        <div key={index} className="p-3 border rounded-lg space-y-2 relative">
                                                            <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7" onClick={() => handleRemoveButton(index)}><Trash2 className="h-4 w-4"/></Button>
                                                            <p className='text-sm font-medium'>Botão {index + 1} ({button.type})</p>
                                                            <Input placeholder="Texto do botão" value={button.text} onChange={e => handleButtonChange(index, 'text', e.target.value)} />
                                                            {button.type === 'URL' && (
                                                                <Input placeholder="https://exemplo.com" value={button.url || ''} onChange={e => handleButtonChange(index, 'url', e.target.value)} />
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="flex gap-2">
                                                    <Button type="button" variant="secondary" size="sm" onClick={() => handleAddButton('QUICK_REPLY')}><PlusCircle className="mr-2"/> Resposta Rápida</Button>
                                                    <Button type="button" variant="secondary" size="sm" onClick={() => handleAddButton('URL')}><PlusCircle className="mr-2"/> Botão de URL</Button>
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    </Accordion>

                                </div>
                                <DialogFooter>
                                    <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancelar</Button>
                                    <Button type="submit" disabled={isSubmitting}>
                                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <MessageSquarePlus className="mr-2 h-4 w-4"/>}
                                        Criar e Enviar para Aprovação
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </CardHeader>
             <CardContent>
                {loadingTemplates ? (
                    <div className="text-center p-8"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
                ) : !instanceName ? (
                    <div className="text-center p-8 border-2 border-dashed rounded-lg">
                        <p className="text-sm text-muted-foreground">Selecione uma instância para ver os templates existentes.</p>
                    </div>
                ) : templates.length === 0 ? (
                    <div className="text-center p-8 border-2 border-dashed rounded-lg">
                        <p className="text-sm text-muted-foreground">Nenhum template encontrado para a instância <span className="font-semibold">{instanceName}</span>.</p>
                    </div>
                ) : (
                    <ScrollArea className="h-96">
                        <div className="space-y-4 pr-4">
                            {templates.map(template => (
                                <Accordion key={template.id} type="single" collapsible>
                                    <AccordionItem value={template.id}>
                                        <AccordionTrigger className="p-3 border rounded-lg hover:bg-secondary/50">
                                            <div className="flex items-center gap-3">
                                                <FileText className="h-5 w-5 text-primary" />
                                                <div>
                                                    <p className="font-semibold text-left">{template.name}</p>
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <Badge variant={template.status === 'APPROVED' ? 'default' : 'secondary'} className={template.status === 'APPROVED' ? 'bg-green-600' : ''}>{template.status}</Badge>
                                                        <span>•</span>
                                                        <span>{template.language}</span>
                                                        <span>•</span>
                                                        <span className="capitalize">{template.category.toLowerCase()}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="p-4 border border-t-0 rounded-b-lg text-sm bg-background">
                                            {template.components.map((comp: any) => (
                                                <div key={comp.type}>
                                                    <p className="font-bold text-muted-foreground">{comp.type}</p>
                                                    <p className="mt-1 font-mono bg-muted p-2 rounded whitespace-pre-wrap">{comp.text || JSON.stringify(comp.buttons, null, 2)}</p>
                                                </div>
                                            ))}
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>
                            ))}
                        </div>
                    </ScrollArea>
                )}
            </CardContent>
        </Card>
    );
}
