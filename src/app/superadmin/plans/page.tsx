
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { getPlans, savePlan, deletePlan, getIntegrations, savePlanIntegration } from '@/actions/plans';
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


function formatCurrency(value: number) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function PlanForm({ onSave, planToEdit }: { onSave: () => void, planToEdit?: Plan | null }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);
        const formData = new FormData(e.currentTarget);
        
        const data = {
            id: planToEdit?.id,
            name: formData.get('name') as string,
            description: formData.get('description') as string,
            price: parseFloat(formData.get('price') as string || '0'),
            is_active: formData.get('is_active') === 'on',
            is_default: formData.get('is_default') === 'on',
        };

        const result = await savePlan(data);
        if (result.success) {
            toast({ title: `Plano ${planToEdit ? 'atualizado' : 'criado'} com sucesso!`});
            setIsOpen(false);
            onSave();
        } else {
            toast({ title: 'Erro ao salvar plano', description: result.error, variant: 'destructive'});
        }
        setIsSubmitting(false);
    }
    
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
             <DialogTrigger asChild>
                {planToEdit ? (
                    <Button variant="outline" size="sm"><Edit className="mr-2 h-4 w-4"/>Editar Plano</Button>
                ) : (
                    <Button><PlusCircle className="mr-2 h-4 w-4"/>Criar Novo Plano</Button>
                )}
            </DialogTrigger>
            <DialogContent>
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{planToEdit ? 'Editar Plano' : 'Criar Novo Plano'}</DialogTitle>
                        <DialogDescription>Defina os detalhes e o preço base do plano.</DialogDescription>
                    </DialogHeader>
                     <div className="py-4 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Nome do Plano</Label>
                            <Input id="name" name="name" defaultValue={planToEdit?.name} required />
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor="description">Descrição</Label>
                            <Textarea id="description" name="description" defaultValue={planToEdit?.description} />
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor="price">Preço Base Mensal (R$)</Label>
                            <Input id="price" name="price" type="number" step="0.01" defaultValue={planToEdit?.price} required />
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch id="is_active" name="is_active" defaultChecked={planToEdit?.is_active ?? true} />
                            <Label htmlFor="is_active">Plano Ativo</Label>
                        </div>
                         <div className="flex items-center space-x-2">
                            <Switch id="is_default" name="is_default" defaultChecked={planToEdit?.is_default ?? false} />
                            <Label htmlFor="is_default">Plano Padrão para novos cadastros</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="ghost">Cancelar</Button></DialogClose>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                            Salvar
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

function PlanIntegrationsManager({ plan, allIntegrations, onUpdate }: { plan: Plan, allIntegrations: Integration[], onUpdate: () => void }) {
    const [isSubmitting, setIsSubmitting] = useState<string | null>(null);

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
            toast({ title: 'Configuração salva!'});
            onUpdate();
        } else {
            toast({ title: 'Erro ao salvar', description: result.error, variant: 'destructive'});
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
                                        <AvatarImage src={integration.icon_url} />
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
                                    {isSubmitting === integration.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
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
    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const fetchData = useCallback(async () => {
        setLoading(true);
        const [plansRes, integrationsRes] = await Promise.all([getPlans(), getIntegrations()]);
        
        if (plansRes.error) {
            toast({ title: 'Erro ao carregar planos', description: plansRes.error, variant: 'destructive'});
        } else {
            setPlans(plansRes.plans || []);
        }

        if (integrationsRes.error) {
            toast({ title: 'Erro ao carregar integrações', description: integrationsRes.error, variant: 'destructive'});
        } else {
            setIntegrations(integrationsRes.integrations || []);
        }

        setLoading(false);
    }, [toast]);
    
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleDelete = async (planId: string) => {
        const result = await deletePlan(planId);
        if (result.success) {
            toast({ title: 'Plano excluído com sucesso!'});
            fetchData();
        } else {
            toast({ title: 'Erro ao excluir plano', description: result.error, variant: 'destructive'});
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                 <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2"><FileText/>Gerenciamento de Planos</h1>
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
                                            <Button variant="destructive" size="sm"><Trash2/></Button>
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
                            <PlanIntegrationsManager plan={plan} allIntegrations={integrations} onUpdate={fetchData} />
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
