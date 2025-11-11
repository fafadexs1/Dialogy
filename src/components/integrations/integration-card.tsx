

'use client';

import type { Integration } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { CheckCircle2, Edit, Loader2, Save } from 'lucide-react';
import { Button } from '../ui/button';
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState } from 'react';
import { updateIntegration } from '@/actions/integrations';
import { toast } from '@/hooks/use-toast';

interface IntegrationCardProps {
  integration: Integration;
  isSuperAdmin?: boolean;
  onEditSuccess?: () => void;
}


function EditIntegrationDialog({ integration, onSave, isOpen, setIsOpen }: { integration: Integration, onSave: () => void, isOpen: boolean, setIsOpen: (open: boolean) => void }) {
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


export function IntegrationCard({ integration, isSuperAdmin, onEditSuccess = () => {} }: IntegrationCardProps) {
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
      <Card className="flex flex-col h-full hover:shadow-lg transition-shadow group">
          <CardWrapper>
              <CardHeader className="flex-row items-start justify-between gap-4">
                  <Avatar className="w-12 h-12 rounded-lg border">
                  <AvatarImage src={integration.icon_url} alt={integration.name} data-ai-hint="logo" />
                  <AvatarFallback>{integration.name.slice(0, 2)}</AvatarFallback>
                  </Avatar>
                   {isSuperAdmin && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={(e) => { e.preventDefault(); setIsEditDialogOpen(true); }}>
                        <Edit className="h-4 w-4"/>
                      </Button>
                    )}
              </CardHeader>
              <CardContent className="flex-grow">
                  <div className="flex items-center gap-2">
                    {integration.tag && (
                      <Badge 
                      variant={getTagVariant(integration.tag_type)}
                      className={cn({
                          'bg-secondary/80 border-transparent': integration.tag_type === 'secondary',
                          'bg-transparent border-foreground/80': integration.tag_type === 'beta',
                      })}
                      >
                      {integration.tag}
                      </Badge>
                    )}
                    {integration.status === 'active' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                  </div>
                  <CardTitle className="text-base font-bold mt-2">
                  {integration.name}
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs leading-5">
                  {integration.description}
                  </CardDescription>
              </CardContent>
              <CardFooter className='mt-auto'>
                  <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      disabled={!integration.href || integration.href === '#'}
                      onClick={(e) => { if(!integration.href || integration.href === '#') e.preventDefault(); }}
                  >
                      {integration.status === 'active' ? 'Gerenciar' : (integration.status === 'coming_soon' ? 'Em Breve' : 'Habilitar')}
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
