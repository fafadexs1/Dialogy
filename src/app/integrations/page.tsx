
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import type { User, Integration } from '@/lib/types';
import { IntegrationCard } from '@/components/integrations/integration-card';
import { Loader2, Save } from 'lucide-react';
import { getIntegrations, updateIntegration } from '@/actions/integrations';
import { toast } from '@/hooks/use-toast';
import { Card, CardDescription, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function EditIntegrationDialog({ integration, onSave }: { integration: Integration, onSave: () => void }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState(integration);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSelectChange = (name: string, value: string) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        const result = await updateIntegration(formData);
        if (result.success) {
            toast({ title: 'Integração atualizada!' });
            onSave();
            setIsOpen(false);
        } else {
            toast({ title: 'Erro ao atualizar', description: result.error, variant: 'destructive' });
        }
        setIsSubmitting(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent>
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Editar Integração: {integration.name}</DialogTitle>
                        <DialogDescription>Altere os detalhes de exibição desta integração.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Nome</Label>
                            <Input id="name" name="name" value={formData.name} onChange={handleInputChange} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="description">Descrição</Label>
                            <Input id="description" name="description" value={formData.description} onChange={handleInputChange} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="icon_url">URL do Ícone</Label>
                            <Input id="icon_url" name="icon_url" value={formData.icon_url} onChange={handleInputChange} />
                        </div>
                         <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="tag">Tag</Label>
                                <Input id="tag" name="tag" value={formData.tag} onChange={handleInputChange} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="tag_type">Tipo da Tag</Label>
                                <Select name="tag_type" value={formData.tag_type} onValueChange={(val) => handleSelectChange('tag_type', val)}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="primary">Primária</SelectItem>
                                        <SelectItem value="secondary">Secundária</SelectItem>
                                        <SelectItem value="beta">Beta</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="ghost">Cancelar</Button></DialogClose>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                            <Save className="mr-2 h-4 w-4"/>
                            Salvar Alterações
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default function IntegrationsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [userRes, integrationsRes] = await Promise.all([
                fetch('/api/user'),
                getIntegrations()
            ]);

            if (userRes.ok) {
                setUser(await userRes.json());
            }

            if (integrationsRes.integrations) {
                setIntegrations(integrationsRes.integrations);
            } else {
                toast({ title: 'Erro de Rede', description: 'Não foi possível carregar as integrações.', variant: 'destructive'});
            }
        } catch (error: any) {
             toast({ title: 'Erro de Rede', description: 'Não foi possível se conectar ao servidor.', variant: 'destructive'});
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    if (loading || !user) {
         return (
              <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-primary"/>
              </div>
        )
    }

    return (
        <div className="flex flex-col flex-1 h-full">
            <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
                <h1 className="text-2xl font-bold">Extensões</h1>
                <p className="text-muted-foreground">Conecte o Dialogy a outras ferramentas para automatizar e aprimorar seus fluxos de trabalho.</p>
            </header>
            <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                {integrations.length === 0 && !loading ? (
                    <Card>
                        <CardHeader>
                            <CardTitle>Nenhuma Integração Encontrada</CardTitle>
                            <CardDescription>
                                O administrador ainda não configurou nenhuma integração.
                            </CardDescription>
                        </CardHeader>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                        {integrations.map(integration => 
                            <IntegrationCard 
                                key={integration.id} 
                                integration={integration}
                                isSuperAdmin={user.is_superadmin}
                                onEditSuccess={fetchData}
                            />
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
