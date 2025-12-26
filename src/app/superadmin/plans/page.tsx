
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, PlusCircle, Loader2, Edit, Trash2, Save, MoreVertical, Settings, DollarSign, ToggleRight, Info } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogClose
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { getPlans, savePlan, deletePlan, savePlanIntegration } from '@/actions/plans';
import { getIntegrations } from '@/actions/integrations';
import type { Plan, Integration } from '@/lib/types';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertDialogTrigger } from '@radix-ui/react-alert-dialog';

const INTEGRATION_ICON_FALLBACK = '/integration-fallback.svg';


function formatCurrency(value: number) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}


function PlanForm({ onSave, planToEdit }: { onSave: () => void, planToEdit?: Plan | null }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { toast } = useToast();

    // Reset state when dialog opens
    useEffect(() => {
        if (isOpen) {
            // Optional: reset form or other local states if needed
        }
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);
        const formData = new FormData(e.currentTarget);

        // Extract limits
        const limits: any = {
            users: parseInt(formData.get('limit_users') as string || '1'),
            whatsapp: parseInt(formData.get('limit_whatsapp') as string || '1'),
            history_months: parseInt(formData.get('limit_history') as string || '1'),
            departments: formData.get('limit_departments') === 'on',
            campaigns: formData.get('limit_campaigns') === 'on',
            api: formData.get('limit_api') === 'on',
            transcription: formData.get('limit_transcription') === 'on',
            ai_byok: formData.get('limit_ai_byok') === 'on',
        };

        // Handle campaign value more specifically if it was a select
        const campaignValue = formData.get('limit_campaigns_select') as string | null;
        if (campaignValue) {
            if (campaignValue === 'true') limits.campaigns = true;
            else if (campaignValue === 'false') limits.campaigns = false;
            else limits.campaigns = campaignValue; // 'moderate', 'high'
        }

        const data = {
            id: planToEdit?.id,
            name: formData.get('name') as string,
            slug: formData.get('slug') as string,
            description: formData.get('description') as string,
            price: parseFloat(formData.get('price') as string || '0'),
            is_active: formData.get('is_active') === 'on',
            is_default: formData.get('is_default') === 'on',
            limits: limits
        };

        const result = await savePlan(data);
        if (result.success) {
            toast({ title: `Plano ${planToEdit ? 'atualizado' : 'criado'} com sucesso!` });
            setIsOpen(false);
            onSave();
        } else {
            toast({ title: 'Erro ao salvar plano', description: result.error, variant: 'destructive' });
        }
        setIsSubmitting(false);
    }

    // Default limit values
    const limits = (planToEdit?.limits as any) || {
        users: 5,
        whatsapp: 1,
        history_months: 3,
        departments: false,
        campaigns: false,
        api: false,
        transcription: false,
        ai_byok: true
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                {planToEdit ? (
                    <Button variant="outline" size="sm"><Edit className="mr-2 h-4 w-4" />Editar</Button>
                ) : (
                    <Button><PlusCircle className="mr-2 h-4 w-4" />Criar Novo Plano</Button>
                )}
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{planToEdit ? 'Editar Plano' : 'Criar Novo Plano'}</DialogTitle>
                        <DialogDescription>Configure os detalhes, preços e limites do plano.</DialogDescription>
                    </DialogHeader>

                    <Tabs defaultValue="general" className="mt-4">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="general">Geral & Preço</TabsTrigger>
                            <TabsTrigger value="limits">Limites & Recursos</TabsTrigger>
                        </TabsList>

                        <TabsContent value="general" className="py-4 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Nome do Plano</Label>
                                    <Input id="name" name="name" defaultValue={planToEdit?.name} placeholder="Ex: Starter" required />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="slug">Slug (Identificador)</Label>
                                    <Input id="slug" name="slug" defaultValue={planToEdit?.slug} placeholder="Ex: starter" />
                                    <p className="text-[10px] text-muted-foreground">Deixe em branco para gerar automaticamente.</p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="description">Descrição</Label>
                                <Textarea id="description" name="description" defaultValue={planToEdit?.description || ''} placeholder="Descrição curta para o cliente..." />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="price">Preço Mensal (R$)</Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-muted-foreground">R$</span>
                                    <Input className="pl-9" id="price" name="price" type="number" step="0.01" defaultValue={planToEdit?.price} required />
                                </div>
                            </div>

                            <div className="flex flex-col gap-3 pt-2 border-t">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label htmlFor="is_active">Plano Ativo</Label>
                                        <p className="text-xs text-muted-foreground">Se desativado, não aparecerá para compra.</p>
                                    </div>
                                    <Switch id="is_active" name="is_active" defaultChecked={planToEdit?.is_active ?? true} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label htmlFor="is_default">Plano Padrão</Label>
                                        <p className="text-xs text-muted-foreground">Atribuído automaticamente a novos cadastros.</p>
                                    </div>
                                    <Switch id="is_default" name="is_default" defaultChecked={planToEdit?.is_default ?? false} />
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="limits" className="py-4 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Numeric Limits */}
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Usuários Permitidos</Label>
                                        <Input type="number" name="limit_users" defaultValue={limits.users} min="1" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Conexões WhatsApp</Label>
                                        <Input type="number" name="limit_whatsapp" defaultValue={limits.whatsapp} min="0" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Histórico de Mensagens (Meses)</Label>
                                        <Input type="number" name="limit_history" defaultValue={limits.history_months} min="1" />
                                    </div>
                                </div>

                                {/* Feature Toggles */}
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-3 border rounded-lg">
                                        <Label htmlFor="limit_departments" className="cursor-pointer flex-1">Departamentos</Label>
                                        <Switch id="limit_departments" name="limit_departments" defaultChecked={limits.departments} />
                                    </div>
                                    <div className="flex items-center justify-between p-3 border rounded-lg">
                                        <Label htmlFor="limit_transcription" className="cursor-pointer flex-1">Transcrição de Áudio</Label>
                                        <Switch id="limit_transcription" name="limit_transcription" defaultChecked={limits.transcription} />
                                    </div>
                                    <div className="flex items-center justify-between p-3 border rounded-lg">
                                        <Label htmlFor="limit_api" className="cursor-pointer flex-1">Acesso à API</Label>
                                        <Switch id="limit_api" name="limit_api" defaultChecked={limits.api} />
                                    </div>
                                    <div className="flex items-center justify-between p-3 border rounded-lg">
                                        <Label htmlFor="limit_ai_byok" className="cursor-pointer flex-1">AI BYOK (Chave Própria)</Label>
                                        <Switch id="limit_ai_byok" name="limit_ai_byok" defaultChecked={limits.ai_byok} />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2 pt-2 border-t">
                                <Label>Campanhas de Disparo</Label>
                                <select
                                    name="limit_campaigns_select"
                                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    defaultValue={limits.campaigns === true ? 'true' : limits.campaigns === false ? 'false' : limits.campaigns}
                                >
                                    <option value="false">Desativado</option>
                                    <option value="true">Ativo (Ilimitado/Padrão)</option>
                                    <option value="moderate">Moderado</option>
                                    <option value="high">Alto Volume</option>
                                </select>
                            </div>
                        </TabsContent>
                    </Tabs>

                    <DialogFooter className="mt-6">
                        <DialogClose asChild><Button variant="ghost">Cancelar</Button></DialogClose>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Salvar Plano
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}


function PlanIntegrationsManager({ plan, allIntegrations, onUpdate }: { plan: Plan, allIntegrations: Integration[], onUpdate: () => void }) {
    const [isSubmitting, setIsSubmitting] = useState<string | null>(null);
    const { toast } = useToast();

    const handleIntegrationConfigChange = async (integrationId: string, enabled: boolean, included: number, cost: number) => {
        setIsSubmitting(integrationId);
        const result = await savePlanIntegration({
            planId: plan.id,
            integrationId: integrationId,
            isEnabled: enabled,
            includedQuantity: included,
            additionalCost: cost,
        });

        if (result.success) {
            toast({ title: 'Configuração salva!' });
            onUpdate();
        } else {
            toast({ title: 'Erro ao salvar', description: result.error, variant: 'destructive' });
        }
        setIsSubmitting(null);
    }

    // Merge all integrations with the ones already configured for the plan
    const configurations = allIntegrations.map(integration => {
        const existingConfig = plan.integrations.find(pi => pi.integration_id === integration.id);
        return {
            integration: integration,
            config: {
                is_enabled: existingConfig?.is_enabled ?? false,
                included_quantity: existingConfig?.included_quantity ?? 0,
                additional_cost: existingConfig?.additional_cost ?? 0,
            }
        }
    });

    return (
        <Card className="mt-4 col-span-1 md:col-span-2">
            <CardHeader>
                <CardTitle className="text-base">Configuração de Integrações</CardTitle>
                <CardDescription>Habilite e defina os limites e custos para cada integração neste plano.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {configurations.map(({ integration, config }) => {
                    const [enabled, setEnabled] = useState(config.is_enabled);
                    const [included, setIncluded] = useState(config.included_quantity);
                    const [cost, setCost] = useState(config.additional_cost);

                    return (
                        <div key={integration.id} className="p-4 border rounded-lg">
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-10 w-10 border rounded-md">
                                        <AvatarImage
                                            src={integration.icon_url}
                                            alt={integration.name}
                                            fallbackSrc={INTEGRATION_ICON_FALLBACK}
                                        />
                                        <AvatarFallback>{integration.name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <h4 className="font-semibold">{integration.name}</h4>
                                        <p className="text-xs text-muted-foreground">{integration.description}</p>
                                    </div>
                                </div>
                                <Switch checked={enabled} onCheckedChange={setEnabled} />
                            </div>
                            <div className={cn("mt-4 grid grid-cols-2 gap-4 transition-all duration-300", !enabled && "opacity-50 pointer-events-none")}>
                                <div className="space-y-1">
                                    <Label className="text-xs">Quantidade Inclusa</Label>
                                    <Input type="number" value={included} onChange={e => setIncluded(Number(e.target.value))} />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Custo Adicional (R$)</Label>
                                    <Input type="number" step="0.01" value={cost} onChange={e => setCost(Number(e.target.value))} />
                                </div>
                            </div>
                            <div className="mt-4 flex justify-end">
                                <Button size="sm" onClick={() => handleIntegrationConfigChange(integration.id, enabled, included, cost)} disabled={isSubmitting === integration.id}>
                                    {isSubmitting === integration.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Salvar Configuração
                                </Button>
                            </div>
                        </div>
                    )
                })}
            </CardContent>
        </Card>
    );
}

export default function PlansPage() {
    const [plans, setPlans] = useState<Plan[]>([]);
    const [allIntegrations, setAllIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const fetchData = useCallback(async () => {
        setLoading(true);
        const [plansRes, integrationsRes] = await Promise.all([
            getPlans(),
            getIntegrations()
        ]);

        if (plansRes.error) {
            toast({ title: 'Erro ao carregar planos', description: plansRes.error, variant: 'destructive' });
        } else {
            setPlans(plansRes.plans || []);
        }

        if (integrationsRes.error) {
            toast({ title: 'Erro ao carregar integrações', description: integrationsRes.error, variant: 'destructive' });
        } else {
            setAllIntegrations(integrationsRes.integrations || []);
        }

        setLoading(false);
    }, [toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleDelete = async (planId: string) => {
        const result = await deletePlan(planId);
        if (result.success) {
            toast({ title: 'Plano excluído com sucesso!' });
            fetchData();
        } else {
            toast({ title: 'Erro ao excluir plano', description: result.error, variant: 'destructive' });
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2"><FileText />Gerenciamento de Planos</h1>
                    <p className="text-muted-foreground">Crie, edite e gerencie os planos de assinatura disponíveis para seus clientes.</p>
                </div>
                <PlanForm onSave={fetchData} />
            </div>

            {loading ? (
                <div className="text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>
            ) : plans.length === 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Nenhum Plano Criado</CardTitle>
                        <CardDescription>Clique em "Criar Novo Plano" para começar.</CardDescription>
                    </CardHeader>
                </Card>
            ) : (
                <div className="space-y-8">
                    {plans.map(plan => (
                        <Card key={plan.id} className="grid grid-cols-1 md:grid-cols-3 gap-0 overflow-hidden">
                            <div className="p-6 flex flex-col border-r">
                                <div className="flex justify-between items-start mb-4">
                                    <CardTitle className="text-xl">{plan.name}</CardTitle>
                                    <Badge variant={plan.is_active ? 'default' : 'secondary'} className={plan.is_active ? 'bg-green-600' : ''}>
                                        {plan.is_active ? 'Ativo' : 'Inativo'}
                                    </Badge>
                                </div>
                                <p className="text-muted-foreground text-sm flex-grow">{plan.description}</p>
                                <div className="mt-4">
                                    <p className="text-3xl font-bold">{formatCurrency(plan.price)}<span className="text-sm font-normal text-muted-foreground">/mês</span></p>
                                    {plan.is_default && <Badge variant="outline" className="mt-2">Plano Padrão</Badge>}
                                </div>
                                <div className="mt-6 flex gap-2">
                                    <PlanForm onSave={fetchData} planToEdit={plan} />
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="destructive" size="sm"><Trash2 /></Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Excluir o plano "{plan.name}"?</AlertDialogTitle>
                                                <AlertDialogDescription>Esta ação não pode ser desfeita. Todos os workspaces neste plano precisarão ser movidos para outro.</AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => handleDelete(plan.id)}>Excluir</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            </div>
                            <PlanIntegrationsManager plan={plan} allIntegrations={allIntegrations} onUpdate={fetchData} />
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
