'use client';

import React, { useEffect, useState } from 'react';
import { createWhatsappTemplate, findWhatsappTemplates } from '@/actions/evolution-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/i18n/i18n-provider';
import type { EvolutionInstance } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Eye, FileText, Loader2, MessageSquarePlus, PlusCircle, RefreshCw, Search, Trash2 } from 'lucide-react';

interface TemplateManagerProps {
  instances: Omit<EvolutionInstance, 'status' | 'qrCode'>[];
}

type TemplateButton = {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  url?: string;
  phone_number?: string;
};

export function TemplateManager({ instances }: TemplateManagerProps) {
  const { toast } = useToast();
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [instanceName, setInstanceName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [category, setCategory] = useState('UTILITY');
  const [language, setLanguage] = useState('pt_BR');
  const [bodyText, setBodyText] = useState('');
  const [bodyExample, setBodyExample] = useState('');
  const [buttons, setButtons] = useState<TemplateButton[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);

  const resetForm = () => {
    setTemplateName('');
    setCategory('UTILITY');
    setLanguage('pt_BR');
    setBodyText('');
    setBodyExample('');
    setButtons([]);
  };

  const handleAddButton = (type: TemplateButton['type']) => {
    if (buttons.length >= 3) {
      toast({
        title: t('Limite de botoes atingido'),
        description: t('Voce pode adicionar no maximo 3 botoes.'),
        variant: 'destructive',
      });
      return;
    }

    setButtons((current) => [...current, { type, text: '' }]);
  };

  const handleRemoveButton = (index: number) => {
    setButtons((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleButtonChange = (index: number, field: keyof TemplateButton, value: string) => {
    setButtons((current) => {
      const next = [...current];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const fetchTemplates = async (name: string) => {
    if (!name) return;

    setLoadingTemplates(true);
    const result = await findWhatsappTemplates(name);

    if (result.error) {
      toast({
        title: t('Erro ao buscar templates'),
        description: result.error,
        variant: 'destructive',
      });
      setTemplates([]);
    } else {
      setTemplates(result.templates || []);
    }

    setLoadingTemplates(false);
  };

  useEffect(() => {
    if (!instanceName) {
      setTemplates([]);
      return;
    }

    fetchTemplates(instanceName);
  }, [instanceName]);

  useEffect(() => {
    if (!instanceName && instances.length > 0) {
      setInstanceName(instances[0].instance_name);
    }
  }, [instanceName, instances]);

  const normalizedTemplates = templates.map((template) => {
    const body = template.components?.find((component: any) => component.type === 'BODY')?.text || '';
    return { ...template, body };
  });

  const filteredTemplates = normalizedTemplates.filter((template) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch = !query || [template.name, template.body, template.language, template.category]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
    const matchesStatus = statusFilter === 'ALL'
      || template.status === statusFilter
      || (statusFilter === 'PENDING' && template.status === 'PENDING_REVIEW');
    const matchesCategory = categoryFilter === 'ALL' || template.category === categoryFilter;
    return matchesSearch && matchesStatus && matchesCategory;
  });

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(filteredTemplates.length / pageSize));
  const paginatedTemplates = filteredTemplates.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [instanceName, searchQuery, statusFilter, categoryFilter]);

  const formatTemplateStatus = (status: string) => ({
    APPROVED: 'Aprovado',
    PENDING: 'Em análise',
    PENDING_REVIEW: 'Em análise',
    REJECTED: 'Rejeitado',
    PAUSED: 'Pausado',
    DISABLED: 'Desativado',
  }[status] || status);

  const formatCategory = (value: string) => ({
    UTILITY: 'Utilidade',
    MARKETING: 'Marketing',
    AUTHENTICATION: 'Autenticação',
  }[value] || value);

  const formatUpdatedAt = (template: any) => {
    const rawDate = template.updated_time || template.updated_at || template.last_updated_time;
    if (!rawDate) return 'Sem data';
    const date = new Date(rawDate);
    return Number.isNaN(date.getTime()) ? 'Sem data' : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    let parsedBodyExample: unknown;
    try {
      if (bodyExample.trim()) {
        parsedBodyExample = JSON.parse(bodyExample);
      }
    } catch {
      toast({
        title: t('JSON invalido'),
        description: t('O JSON no exemplo do corpo da mensagem e invalido.'),
        variant: 'destructive',
      });
      setIsSubmitting(false);
      return;
    }

    const payload = {
      name: templateName,
      category,
      language,
      components: [
        {
          type: 'BODY',
          text: bodyText,
          example: parsedBodyExample ? { body_text: parsedBodyExample } : undefined,
        },
        ...(buttons.length > 0 ? [{ type: 'BUTTONS', buttons }] : []),
      ],
    };

    const result = await createWhatsappTemplate(instanceName, payload);

    if (result.success) {
      toast({
        title: t('Template Criado!'),
        description: t('Seu template foi enviado para aprovacao pela Meta.'),
      });
      setIsOpen(false);
      resetForm();
      fetchTemplates(instanceName);
    } else {
      toast({
        title: t('Erro ao Criar Template'),
        description: result.error,
        variant: 'destructive',
      });
    }

    setIsSubmitting(false);
  };

  return (
    <section className="overflow-hidden rounded-xl border bg-background">
      <div className="flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-base font-semibold">Templates de mensagem</h2>
          <p className="mt-1 text-sm text-muted-foreground">Encontre, acompanhe e crie templates para a Cloud API.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="template-instance" className="text-xs text-muted-foreground">Instância</Label>
          <Select value={instanceName} onValueChange={setInstanceName} required>
            <SelectTrigger id="template-instance" className="h-10 w-[260px]">
              <SelectValue placeholder="Selecione uma instância" />
            </SelectTrigger>
            <SelectContent>
              {instances.map((instance) => (
                <SelectItem key={instance.id} value={instance.instance_name}>
                  {instance.display_name}{instance.display_phone_number ? ` · ${instance.display_phone_number}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={() => fetchTemplates(instanceName)} variant="outline" size="icon" disabled={loadingTemplates || !instanceName} aria-label="Atualizar templates">
            <RefreshCw className={loadingTemplates ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>

          <Dialog
            open={isOpen}
            onOpenChange={(open) => {
              setIsOpen(open);
              if (!open) resetForm();
            }}
          >
            <DialogTrigger asChild>
              <Button disabled={!instanceName}>
                <PlusCircle className="mr-2" />
                {t('Criar Template')}
              </Button>
            </DialogTrigger>

            <DialogContent className="max-w-3xl">
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>
                    {t('Criar Novo Template para:')} <span className="text-primary">{instanceName}</span>
                  </DialogTitle>
                  <DialogDescription>
                    {t('Este template sera enviado para a Meta para aprovacao. Siga as')}{' '}
                    <a
                      href="https://developers.facebook.com/docs/whatsapp/message-templates/guidelines"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {t('diretrizes')}
                    </a>
                    .
                  </DialogDescription>
                </DialogHeader>

                <div className="max-h-[60vh] space-y-4 overflow-y-auto px-1 py-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">{t('Nome do Template')}</Label>
                      <Input
                        id="name"
                        value={templateName}
                        onChange={(event) => setTemplateName(event.target.value)}
                        required
                        placeholder={t('ex: pedido_confirmado')}
                      />
                      <p className="text-xs text-muted-foreground">{t('Apenas letras minusculas, numeros e underscores (_).')}</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">{t('Categoria')}</Label>
                      <Select value={category} onValueChange={setCategory} required>
                        <SelectTrigger id="category">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="UTILITY">{t('Utilidade')}</SelectItem>
                          <SelectItem value="MARKETING">{t('Marketing')}</SelectItem>
                          <SelectItem value="AUTHENTICATION">{t('Autenticacao')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="language">{t('Idioma')}</Label>
                      <Select value={language} onValueChange={setLanguage} required>
                        <SelectTrigger id="language">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pt_BR">{t('Portugues (Brasil)')}</SelectItem>
                          <SelectItem value="en_US">{t('Ingles (EUA)')}</SelectItem>
                          <SelectItem value="es_ES">{t('Espanhol (Espanha)')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Accordion type="multiple" defaultValue={['body']} className="w-full">
                    <AccordionItem value="body">
                      <AccordionTrigger>{t('Corpo da Mensagem (Body)')}</AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-2">
                        <div className="space-y-2">
                          <Label htmlFor="body-text">{t('Texto do Corpo')}</Label>
                          <Textarea
                            id="body-text"
                            value={bodyText}
                            onChange={(event) => setBodyText(event.target.value)}
                            placeholder={t('Ola {{1}}, seu pedido no {{2}} foi confirmado.')}
                            required
                          />
                          <p className="text-xs text-muted-foreground">{t('Use variaveis como {{1}}, {{2}}, etc.')}</p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="body-example">{t('Exemplo do Corpo (JSON)')}</Label>
                          <Textarea
                            id="body-example"
                            value={bodyExample}
                            onChange={(event) => setBodyExample(event.target.value)}
                            className="font-mono text-xs"
                            placeholder='[["Fulano", "XYZ-1234"]]'
                          />
                          <p className="text-xs text-muted-foreground">{t('Forneca um array JSON de exemplos para as variaveis. Ex: [["Maria","12345"]]')}</p>
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="buttons">
                      <AccordionTrigger>{t('Botoes')}</AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-2">
                        <div className="space-y-2">
                          {buttons.map((button, index) => (
                            <div key={`${button.type}-${index}`} className="relative space-y-2 rounded-lg border p-3">
                              <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-7 w-7" onClick={() => handleRemoveButton(index)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>

                              <p className="text-sm font-medium">
                                {t('Botao {index}', { index: index + 1 })} ({button.type})
                              </p>

                              <Input
                                placeholder={t('Texto do botao')}
                                value={button.text}
                                onChange={(event) => handleButtonChange(index, 'text', event.target.value)}
                              />

                              {button.type === 'URL' && (
                                <Input
                                  placeholder="https://exemplo.com"
                                  value={button.url || ''}
                                  onChange={(event) => handleButtonChange(index, 'url', event.target.value)}
                                />
                              )}

                              {button.type === 'PHONE_NUMBER' && (
                                <Input
                                  placeholder="5511999998888"
                                  value={button.phone_number || ''}
                                  onChange={(event) => handleButtonChange(index, 'phone_number', event.target.value)}
                                />
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="flex gap-2">
                          <Button type="button" variant="secondary" size="sm" onClick={() => handleAddButton('QUICK_REPLY')}>
                            <PlusCircle className="mr-2" />
                            {t('Resposta Rapida')}
                          </Button>
                          <Button type="button" variant="secondary" size="sm" onClick={() => handleAddButton('URL')}>
                            <PlusCircle className="mr-2" />
                            {t('Botao de URL')}
                          </Button>
                          <Button type="button" variant="secondary" size="sm" onClick={() => handleAddButton('PHONE_NUMBER')}>
                            <PlusCircle className="mr-2" />
                            {t('Botao de Telefone')}
                          </Button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>

                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
                    {t('Cancelar')}
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquarePlus className="mr-2 h-4 w-4" />}
                    {t('Criar e Enviar para Aprovacao')}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="border-b px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full xl:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar templates por nome ou conteúdo..."
              className="h-10 pl-9"
              aria-label="Buscar templates"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { value: 'ALL', label: 'Todos' },
              { value: 'APPROVED', label: 'Aprovados' },
              { value: 'PENDING', label: 'Em análise' },
              { value: 'REJECTED', label: 'Rejeitados' },
            ].map((filter) => (
              <Button
                key={filter.value}
                type="button"
                size="sm"
                variant={statusFilter === filter.value ? 'default' : 'outline'}
                onClick={() => setStatusFilter(filter.value)}
                className={statusFilter === filter.value ? 'shadow-none' : ''}
              >
                {filter.label}
              </Button>
            ))}

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-9 w-[180px]" aria-label="Filtrar por categoria">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas as categorias</SelectItem>
                <SelectItem value="UTILITY">Utilidade</SelectItem>
                <SelectItem value="MARKETING">Marketing</SelectItem>
                <SelectItem value="AUTHENTICATION">Autenticação</SelectItem>
              </SelectContent>
            </Select>

            <span className="ml-1 text-xs font-medium text-muted-foreground">{filteredTemplates.length} {filteredTemplates.length === 1 ? 'template' : 'templates'}</span>
          </div>
        </div>
      </div>

      <div>
        {loadingTemplates ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          </div>
        ) : !instanceName ? (
          <div className="rounded-lg border-2 border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">{t('Selecione uma instancia para ver os templates existentes.')}</p>
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">{t('Nenhum template encontrado para a instancia {instance}.', { instance: instanceName })}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div className="grid min-w-[900px] grid-cols-[1.15fr_1.55fr_.65fr_.7fr_.75fr_auto] gap-4 border-b bg-muted/20 px-6 py-3 text-xs font-medium text-muted-foreground">
                <span>Nome do template</span>
                <span>Mensagem</span>
                <span>Idioma / Categoria</span>
                <span>Status</span>
                <span>Atualizado em</span>
                <span className="pr-12 text-right">Ações</span>
              </div>

              <div className="min-w-[900px]">
                {paginatedTemplates.map((template) => (
                  <Dialog key={template.id}>
                    <div className="grid min-h-[78px] grid-cols-[1.15fr_1.55fr_.65fr_.7fr_.75fr_auto] items-center gap-4 border-b px-6 py-4 last:border-b-0 hover:bg-muted/20">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{template.name}</p>
                        <Badge variant="secondary" className="mt-1 border bg-background text-[11px] font-medium">{formatCategory(template.category)}</Badge>
                      </div>

                      <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{template.body || 'Template sem texto de corpo.'}</p>

                      <div className="text-xs">
                        <p className="font-medium text-foreground">{template.language}</p>
                        <p className="mt-1 text-muted-foreground">{formatCategory(template.category)}</p>
                      </div>

                      <Badge
                        variant="secondary"
                        className={cn(
                          'w-fit border font-medium',
                          template.status === 'APPROVED' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
                          ['PENDING', 'PENDING_REVIEW'].includes(template.status) && 'border-amber-200 bg-amber-50 text-amber-700',
                          template.status === 'REJECTED' && 'border-red-200 bg-red-50 text-red-700',
                        )}
                      >
                        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
                        {formatTemplateStatus(template.status)}
                      </Badge>

                      <div className="text-xs">
                        <p className="font-medium text-foreground">{formatUpdatedAt(template)}</p>
                        <p className="mt-1 text-muted-foreground">Meta</p>
                      </div>

                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm"><Eye className="mr-2 h-4 w-4" />Ver detalhes</Button>
                      </DialogTrigger>
                    </div>

                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>{template.name}</DialogTitle>
                        <DialogDescription>{template.language} · {formatCategory(template.category)} · {formatTemplateStatus(template.status)}</DialogDescription>
                      </DialogHeader>
                      <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
                        {template.components.map((component: any) => (
                          <div key={component.type} className="rounded-lg border bg-muted/20 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{component.type}</p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{component.text || JSON.stringify(component.buttons, null, 2)}</p>
                          </div>
                        ))}
                      </div>
                    </DialogContent>
                  </Dialog>
                ))}
              </div>

              <div className="flex min-w-[900px] items-center justify-between border-t px-6 py-3">
                <p className="text-xs text-muted-foreground">
                  Mostrando {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredTemplates.length)} de {filteredTemplates.length} templates
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Página {currentPage} de {totalPages}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                    aria-label="Página anterior"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage === totalPages}
                    aria-label="Próxima página"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

          <ScrollArea className="hidden">
            <div className="space-y-4 pr-4">
              {templates.slice(0, 0).map((template) => (
                <Accordion key={template.id} type="single" collapsible>
                  <AccordionItem value={template.id}>
                    <AccordionTrigger className="rounded-lg border p-3 hover:bg-secondary/50">
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-primary" />
                        <div>
                          <p className="text-left font-semibold">{template.name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge
                              variant={template.status === 'APPROVED' ? 'default' : 'secondary'}
                              className={template.status === 'APPROVED' ? 'bg-green-600' : ''}
                            >
                              {template.status}
                            </Badge>
                            <span>•</span>
                            <span>{template.language}</span>
                            <span>•</span>
                            <span className="capitalize">{template.category.toLowerCase()}</span>
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent className="rounded-b-lg border border-t-0 bg-background p-4 text-sm">
                      {template.components.map((component: any) => (
                        <div key={component.type}>
                          <p className="font-bold text-muted-foreground">{component.type}</p>
                          <p className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 font-mono">
                            {component.text || JSON.stringify(component.buttons, null, 2)}
                          </p>
                        </div>
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              ))}
            </div>
          </ScrollArea>
          </>
        )}
      </div>
    </section>
  );
}
