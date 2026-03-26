'use client';

import type { Integration } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Loader2, Save, ArrowRight, Settings2 } from 'lucide-react';
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
            toast({ title: 'Integracao atualizada!' });
            onSave();
            setIsOpen(false);
        } else {
            toast({ title: 'Erro ao atualizar', description: result.error, variant: 'destructive' });
        }
        setIsSubmitting(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="border-slate-200 bg-white text-slate-950">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Editar Integracao: {integration.name}</DialogTitle>
                        <DialogDescription className="text-slate-500">Altere os detalhes de exibicao desta integracao.</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4">
                        <div className="space-y-2">
                            <Label htmlFor="name" className="text-slate-700">Nome</Label>
                            <Input id="name" name="name" value={formData.name} onChange={handleInputChange} className="border-slate-200 bg-white text-slate-900" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="description" className="text-slate-700">Descricao</Label>
                            <Input id="description" name="description" value={formData.description} onChange={handleInputChange} className="border-slate-200 bg-white text-slate-900" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="icon_url" className="text-slate-700">URL do Icone</Label>
                            <Input id="icon_url" name="icon_url" value={formData.icon_url} onChange={handleInputChange} className="border-slate-200 bg-white text-slate-900" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="tag" className="text-slate-700">Tag</Label>
                                <Input id="tag" name="tag" value={formData.tag} onChange={handleInputChange} className="border-slate-200 bg-white text-slate-900" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="tag_type" className="text-slate-700">Tipo da Tag</Label>
                                <Select name="tag_type" value={formData.tag_type} onValueChange={(val) => handleSelectChange('tag_type', val)}>
                                    <SelectTrigger className="border-slate-200 bg-white text-slate-900"><SelectValue /></SelectTrigger>
                                    <SelectContent className="border-slate-200 bg-white text-slate-900">
                                        <SelectItem value="primary">Primaria</SelectItem>
                                        <SelectItem value="secondary">Secundaria</SelectItem>
                                        <SelectItem value="beta">Beta</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="ghost" className="text-slate-500 hover:bg-slate-100 hover:text-slate-950">Cancelar</Button></DialogClose>
                        <Button type="submit" disabled={isSubmitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            <Save className="mr-2 h-4 w-4" />
                            Salvar Alteracoes
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function IntegrationCard({ integration, isSuperAdmin, onEditSuccess = () => { } }: IntegrationCardProps) {
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

    const CardWrapper = ({ children }: { children: React.ReactNode }) => {
        if (integration.href && integration.href !== '#') {
            return (
                <Link href={integration.href} className="flex h-full flex-grow flex-col text-current no-underline">
                    {children}
                </Link>
            );
        }
        return <div className="flex h-full flex-grow flex-col">{children}</div>;
    };

    return (
        <>
            <Card className="group relative flex h-full flex-col overflow-hidden border border-slate-200/80 bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.14)] transition-all duration-300 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-[0_24px_60px_-34px_rgba(15,23,42,0.18)]">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-emerald-500/5 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

                <CardWrapper>
                    <CardHeader className="relative z-10 flex-row items-start justify-between gap-4 pb-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5 transition-all duration-300 group-hover:scale-105 group-hover:bg-emerald-50">
                            <Avatar className="h-10 w-10 rounded-xl">
                                <AvatarImage
                                    src={integration.icon_url}
                                    alt={integration.name}
                                    data-ai-hint="logo"
                                    className="object-cover"
                                    fallbackSrc={INTEGRATION_ICON_FALLBACK}
                                />
                                <AvatarFallback className="rounded-xl bg-slate-100 text-slate-600">{integration.name.slice(0, 2)}</AvatarFallback>
                            </Avatar>
                        </div>

                        {isSuperAdmin && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="absolute right-4 top-4 h-8 w-8 opacity-0 transition-opacity text-slate-500 hover:bg-slate-100 hover:text-slate-950 group-hover:opacity-100"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsEditDialogOpen(true); }}
                            >
                                <Settings2 className="h-4 w-4" />
                            </Button>
                        )}
                    </CardHeader>
                    <CardContent className="relative z-10 flex-grow">
                        <div className="mb-2 flex items-center gap-2">
                            <CardTitle className="text-lg font-semibold tracking-tight text-slate-950 transition-colors group-hover:text-emerald-600">
                                {integration.name}
                            </CardTitle>
                            {integration.status === 'active' &&
                                <div className="relative flex h-2.5 w-2.5">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                                </div>
                            }
                        </div>

                        <CardDescription className="min-h-[2.5rem] text-sm leading-relaxed text-slate-500 transition-colors group-hover:text-slate-600">
                            {integration.description}
                        </CardDescription>

                        <div className="mt-4 flex items-center gap-2">
                            {integration.tag && (
                                <Badge
                                    variant="outline"
                                    className={cn("h-6 border-0 px-2 py-0.5 text-[10px] font-medium backdrop-blur-md", {
                                        'bg-blue-500/10 text-blue-400': integration.tag_type === 'secondary',
                                        'bg-amber-500/10 text-amber-400': integration.tag_type === 'beta',
                                        'bg-emerald-500/10 text-emerald-400': integration.tag_type === 'primary',
                                    })}
                                >
                                    {integration.tag}
                                </Badge>
                            )}
                            {integration.limitStatus && (
                                <Badge variant="outline" className={cn("ml-auto h-6 border-slate-200 bg-slate-50 text-[10px]", {
                                    "border-red-500/20 bg-red-500/5 text-red-400": integration.limitStatus.reached,
                                    "text-slate-500": !integration.limitStatus.reached
                                })}>
                                    {integration.limitStatus.current} / {integration.limitStatus.max}
                                </Badge>
                            )}
                        </div>
                    </CardContent>
                    <CardFooter className='relative z-10 mt-auto pt-2'>
                        <Button
                            variant={integration.status === 'active' ? "default" : "secondary"}
                            size="sm"
                            className={cn("h-9 w-full gap-2 rounded-lg font-medium transition-all", {
                                'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-700': integration.status === 'active',
                                'bg-slate-100 text-slate-500 hover:bg-slate-200': integration.status !== 'active'
                            })}
                            disabled={(!integration.href || integration.href === '#') || !isSuperAdmin}
                            onClick={(e) => { if ((!integration.href || integration.href === '#') || !isSuperAdmin) e.preventDefault(); }}
                        >
                            {integration.status === 'active' ? (
                                <>
                                    Gerenciar <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                                </>
                            ) : (integration.status === 'coming_soon' ? 'Em breve' : 'Habilitar')}
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
