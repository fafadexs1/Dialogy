
'use client';

import type { Integration } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { CheckCircle2, Edit, Loader2, Save, ArrowRight, Settings2 } from 'lucide-react';
import { Button } from '../ui/button';
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState } from 'react';
import { updateIntegration } from '@/actions/integrations';
import { useToast } from '@/hooks/use-toast';

interface IntegrationCardProps {
    integration: Integration;
    isSuperAdmin?: boolean;
    onEditSuccess?: () => void;
}


function EditIntegrationDialog({ integration, onSave, isOpen, setIsOpen }: { integration: Integration, onSave: () => void, isOpen: boolean, setIsOpen: (open: boolean) => void }) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState(integration);
    const { toast } = useToast();

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
                    <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
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
                                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            <Save className="mr-2 h-4 w-4" />
                            Salvar Alterações
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}


export function IntegrationCard({ integration, isSuperAdmin, onEditSuccess = () => { } }: IntegrationCardProps) {
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

    const getTagVariant = (tagType: Integration['tag_type']) => {
        switch (tagType) {
            case 'primary': return 'default';
            case 'secondary': return 'secondary';
            case 'beta': return 'outline';
            default: return 'secondary';
        }
    }

    const CardWrapper = ({ children }: { children: React.ReactNode }) => {
        if (integration.href && integration.href !== '#') {
            return (
                <Link href={integration.href} className="flex flex-col flex-grow h-full no-underline text-current">
                    {children}
                </Link>
            );
        }
        return <div className="flex flex-col flex-grow h-full">{children}</div>;
    };


    return (
        <>
            <Card className="flex flex-col h-full hover:shadow-xl hover:border-primary/20 transition-all duration-300 group overflow-hidden bg-background relative">
                {/* Background gradient hint */}
                <div className="absolute inset-0 bg-gradient-to-br from-transparent to-muted/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                <CardWrapper>
                    <CardHeader className="flex-row items-start justify-between gap-4 pb-2 z-10 relative">
                        <div className="p-2 bg-muted/30 rounded-xl border border-border/50 group-hover:bg-background group-hover:shadow-sm transition-all duration-300">
                            <Avatar className="w-10 h-10 rounded-lg">
                                <AvatarImage src={integration.icon_url} alt={integration.name} data-ai-hint="logo" className="object-cover" />
                                <AvatarFallback className="rounded-lg">{integration.name.slice(0, 2)}</AvatarFallback>
                            </Avatar>
                        </div>

                        {isSuperAdmin && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity absolute right-4 top-4"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsEditDialogOpen(true); }}
                            >
                                <Settings2 className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </Button>
                        )}
                    </CardHeader>
                    <CardContent className="flex-grow z-10 relative">
                        <div className="flex items-center gap-2 mb-2">
                            <CardTitle className="text-lg font-semibold tracking-tight">
                                {integration.name}
                            </CardTitle>
                            {integration.status === 'active' && <CheckCircle2 className="h-4 w-4 text-green-500 fill-green-500/10" />}
                        </div>

                        <CardDescription className="text-sm leading-relaxed line-clamp-2 min-h-[2.5rem]">
                            {integration.description}
                        </CardDescription>

                        <div className="flex items-center gap-2 mt-4">
                            {integration.tag && (
                                <Badge
                                    variant={getTagVariant(integration.tag_type)}
                                    className={cn("text-[10px] px-2 py-0.5 h-5 font-normal", {
                                        'bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 border-blue-200': integration.tag_type === 'secondary',
                                        'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-amber-200': integration.tag_type === 'beta',
                                        'bg-primary/10 text-primary hover:bg-primary/20 border-primary/20': integration.tag_type === 'primary',
                                    })}
                                >
                                    {integration.tag}
                                </Badge>
                            )}
                        </div>
                    </CardContent>
                    <CardFooter className='mt-auto pt-2 z-10 relative'>
                        <Button
                            variant={integration.status === 'active' ? "default" : "secondary"}
                            size="sm"
                            className={cn("w-full gap-2 transition-all", {
                                'opacity-80 group-hover:opacity-100': integration.status === 'active'
                            })}
                            disabled={(!integration.href || integration.href === '#') || !isSuperAdmin}
                            onClick={(e) => { if ((!integration.href || integration.href === '#') || !isSuperAdmin) e.preventDefault(); }}
                        >
                            {integration.status === 'active' ? (
                                <>
                                    Gerenciar <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                                </>
                            ) : (integration.status === 'coming_soon' ? 'Em Breve' : 'Habilitar')}
                        </Button>
                    </CardFooter>
                </CardWrapper>
            </Card>
            {isSuperAdmin && (
                <EditIntegrationDialog
                    integration={integration}
                    onSave={onEditSuccess}
                    isOpen={isEditDialogOpen}
                    setIsOpen={setIsEditDialogOpen}
                />
            )}
        </>
    );
}
