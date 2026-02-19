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

const INTEGRATION_ICON_FALLBACK = '/integration-fallback.svg';


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
            <DialogContent className="bg-zinc-950 border-white/10 text-white">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Editar Integração: {integration.name}</DialogTitle>
                        <DialogDescription className="text-zinc-400">Altere os detalhes de exibição desta integração.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                        <div className="space-y-2">
                            <Label htmlFor="name" className="text-zinc-300">Nome</Label>
                            <Input id="name" name="name" value={formData.name} onChange={handleInputChange} className="bg-white/5 border-white/10 text-white" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="description" className="text-zinc-300">Descrição</Label>
                            <Input id="description" name="description" value={formData.description} onChange={handleInputChange} className="bg-white/5 border-white/10 text-white" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="icon_url" className="text-zinc-300">URL do Ícone</Label>
                            <Input id="icon_url" name="icon_url" value={formData.icon_url} onChange={handleInputChange} className="bg-white/5 border-white/10 text-white" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="tag" className="text-zinc-300">Tag</Label>
                                <Input id="tag" name="tag" value={formData.tag} onChange={handleInputChange} className="bg-white/5 border-white/10 text-white" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="tag_type" className="text-zinc-300">Tipo da Tag</Label>
                                <Select name="tag_type" value={formData.tag_type} onValueChange={(val) => handleSelectChange('tag_type', val)}>
                                    <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
                                    <SelectContent className="bg-zinc-900 border-white/10 text-white">
                                        <SelectItem value="primary">Primária</SelectItem>
                                        <SelectItem value="secondary">Secundária</SelectItem>
                                        <SelectItem value="beta">Beta</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="ghost" className="text-zinc-400 hover:text-white hover:bg-white/10">Cancelar</Button></DialogClose>
                        <Button type="submit" disabled={isSubmitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
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
            <Card className="flex flex-col h-full border-white/5 bg-zinc-950/40 backdrop-blur-sm transition-all duration-300 hover:bg-zinc-950/60 hover:border-emerald-500/20 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-1 group overflow-hidden relative">
                {/* Background gradient hint */}
                <div className="absolute inset-0 bg-gradient-to-br from-transparent via-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                <CardWrapper>
                    <CardHeader className="flex-row items-start justify-between gap-4 pb-2 z-10 relative">
                        <div className="p-2.5 bg-white/5 rounded-2xl border border-white/5 group-hover:bg-white/10 group-hover:scale-105 transition-all duration-300">
                            <Avatar className="w-10 h-10 rounded-xl">
                                <AvatarImage
                                    src={integration.icon_url}
                                    alt={integration.name}
                                    data-ai-hint="logo"
                                    className="object-cover"
                                    fallbackSrc={INTEGRATION_ICON_FALLBACK}
                                />
                                <AvatarFallback className="rounded-xl bg-zinc-800 text-zinc-400">{integration.name.slice(0, 2)}</AvatarFallback>
                            </Avatar>
                        </div>

                        {isSuperAdmin && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity absolute right-4 top-4 hover:bg-white/10 text-zinc-400 hover:text-white"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsEditDialogOpen(true); }}
                            >
                                <Settings2 className="h-4 w-4" />
                            </Button>
                        )}
                    </CardHeader>
                    <CardContent className="flex-grow z-10 relative">
                        <div className="flex items-center gap-2 mb-2">
                            <CardTitle className="text-lg font-semibold tracking-tight text-white group-hover:text-emerald-400 transition-colors">
                                {integration.name}
                            </CardTitle>
                            {integration.status === 'active' &&
                                <div className="relative flex h-2.5 w-2.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                </div>
                            }
                        </div>

                        <CardDescription className="text-sm leading-relaxed line-clamp-2 min-h-[2.5rem] text-zinc-400 group-hover:text-zinc-300 transition-colors">
                            {integration.description}
                        </CardDescription>

                        <div className="flex items-center gap-2 mt-4">
                            {integration.tag && (
                                <Badge
                                    variant="outline"
                                    className={cn("text-[10px] px-2 py-0.5 h-6 font-medium border-0 backdrop-blur-md", {
                                        'bg-blue-500/10 text-blue-400': integration.tag_type === 'secondary',
                                        'bg-amber-500/10 text-amber-400': integration.tag_type === 'beta',
                                        'bg-emerald-500/10 text-emerald-400': integration.tag_type === 'primary',
                                    })}
                                >
                                    {integration.tag}
                                </Badge>
                            )}
                            {integration.limitStatus && (
                                <Badge variant="outline" className={cn("text-[10px] h-6 ml-auto border-white/10 bg-white/5", {
                                    "text-red-400 border-red-500/20 bg-red-500/5": integration.limitStatus.reached,
                                    "text-zinc-400": !integration.limitStatus.reached
                                })}>
                                    {integration.limitStatus.current} / {integration.limitStatus.max}
                                </Badge>
                            )}
                        </div>
                    </CardContent>
                    <CardFooter className='mt-auto pt-2 z-10 relative'>
                        <Button
                            variant={integration.status === 'active' ? "default" : "secondary"}
                            size="sm"
                            className={cn("w-full gap-2 transition-all font-medium rounded-lg h-9", {
                                'bg-white/5 hover:bg-emerald-500/20 hover:text-emerald-400 text-zinc-300 border border-white/5 hover:border-emerald-500/30': integration.status === 'active',
                                'bg-white/5 text-zinc-500 hover:bg-white/10': integration.status !== 'active'
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
