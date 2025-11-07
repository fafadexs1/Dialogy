
'use client';

import React, { useState, useEffect } from 'react';
import type { CustomFieldDefinition, SelectableOption, Tag, User } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, Trash2, Palette, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '../ui/checkbox';
import { DialogClose } from '@radix-ui/react-dialog';
import { ScrollArea } from '../ui/scroll-area';
import { Textarea } from '../ui/textarea';
import { getTags, createTag, deleteTag, getCustomFieldDefinitions, createCustomFieldDefinition, deleteCustomFieldDefinition } from '@/actions/crm';
import { toast } from '@/hooks/use-toast';

// A generic manager for lists of selectable options (like lead sources, job titles, etc.)
function OptionsManager({ 
    title, 
    options, 
    onAdd,
    onRemove
}: { 
    title: string, 
    options: Tag[], 
    onAdd: (label: string, color: string, isCloseReason: boolean) => Promise<any>,
    onRemove: (id: string) => Promise<any>
}) {
    const [newItemLabel, setNewItemLabel] = useState('');
    const [newItemColor, setNewItemColor] = useState('#cccccc');
    const [isCloseReason, setIsCloseReason] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleAddItem = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newItemLabel.trim()) return;
        
        setIsSubmitting(true);
        const result = await onAdd(newItemLabel, newItemColor, isCloseReason);
        if (result.success) {
            setNewItemLabel('');
            setNewItemColor('#cccccc');
            setIsCloseReason(false);
            toast({ title: 'Etiqueta Adicionada!'})
        } else {
            toast({ title: 'Erro ao Adicionar', description: result.error, variant: 'destructive'})
        }
        setIsSubmitting(false);
    };

    const handleRemoveItem = async (itemToRemove: Tag) => {
        const result = await onRemove(itemToRemove.id);
        if (result.success) {
            toast({ title: 'Etiqueta Removida!'})
        } else {
            toast({ title: 'Erro ao Remover', description: result.error, variant: 'destructive'})
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleAddItem} className="flex flex-col gap-4 mb-4">
                    <div className="flex items-end gap-2">
                        <div className='flex-1'>
                            <Label htmlFor={`new-option-${title}`} className='text-xs'>Nome da Opção</Label>
                            <Input
                                id={`new-option-${title}`} 
                                placeholder={`Nova opção...`}
                                value={newItemLabel}
                                onChange={(e) => setNewItemLabel(e.target.value)}
                                className='h-9'
                            />
                        </div>
                        <div>
                            <Label htmlFor={`new-color-${title}`} className='text-xs'>Cor</Label>
                            <div className="flex items-center gap-2 border rounded-md h-9 px-2 bg-background">
                                <Palette className="h-4 w-4 text-muted-foreground"/>
                                <input
                                    id={`new-color-${title}`}
                                    type="color"
                                    value={newItemColor}
                                    onChange={(e) => setNewItemColor(e.target.value)}
                                    className="w-5 h-5 p-0 border-none bg-transparent"
                                />
                            </div>
                        </div>
                        <Button type="submit" size="sm" className='h-9' disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className='h-4 w-4 animate-spin mr-2' />}
                            Adicionar
                        </Button>
                    </div>
                    {title === "Etiquetas (Tags)" && (
                        <div className="flex items-center space-x-2">
                            <Checkbox 
                                id={`is-close-reason-${title}`} 
                                checked={isCloseReason}
                                onCheckedChange={(checked) => setIsCloseReason(!!checked)}
                            />
                            <label
                                htmlFor={`is-close-reason-${title}`}
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                                Usar como motivo de encerramento de chat
                            </label>
                        </div>
                    )}
                </form>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                    {options.map(option => (
                        <div key={option.id} className="flex items-center justify-between p-2 border rounded-md bg-background text-sm">
                            <div className='flex items-center gap-2'>
                                <span className='h-3 w-3 rounded-full' style={{backgroundColor: option.color}}></span>
                                <div className='flex flex-col'>
                                    <span className='font-medium'>{option.label}</span>
                                    <span className="text-xs font-mono text-muted-foreground">ID: {option.id}</span>
                                    {option.is_close_reason && (
                                        <span className='text-xs text-blue-500 font-semibold'>Motivo de Encerramento</span>
                                    )}
                                </div>
                            </div>
                             <Button variant="ghost" size="icon" className='h-7 w-7' onClick={() => handleRemoveItem(option)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                                <span className="sr-only">Remover</span>
                            </Button>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}


export function CrmSettings({ children, user }: { children: React.ReactNode, user: User | null }) {
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<CustomFieldDefinition['type']>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [newFieldPlaceholder, setNewFieldPlaceholder] = useState('');

  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAllData = React.useCallback(async () => {
    if (!user?.activeWorkspaceId) return;
    setLoading(true);
    const [tagsResult, fieldsResult] = await Promise.all([
        getTags(user.activeWorkspaceId),
        getCustomFieldDefinitions(user.activeWorkspaceId)
    ]);
    
    if (!tagsResult.error) setTags(tagsResult.tags || []);
    if (!fieldsResult.error) setFields(fieldsResult.fields || []);
    
    setLoading(false);
  }, [user?.activeWorkspaceId]);

  useEffect(() => {
    if (user) {
        fetchAllData();
    }
  }, [user, fetchAllData]);

  const handleAddTag = async (label: string, color: string, isCloseReason: boolean) => {
    if (!user?.activeWorkspaceId) return { success: false, error: 'Workspace não encontrado' };
    const result = await createTag(user.activeWorkspaceId, label, color, isCloseReason);
    if (result.success) {
        fetchAllData(); // Re-fetch all data
    }
    return result;
  }
  
  const handleRemoveTag = async (tagId: string) => {
    const result = await deleteTag(tagId);
    if (result.success) {
        fetchAllData(); // Re-fetch all data
    }
    return result;
  }

  const handleAddField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldLabel.trim() || !user?.activeWorkspaceId) return;

    let options: SelectableOption[] | undefined;
    if (newFieldType === 'select' && newFieldOptions.trim()) {
        options = newFieldOptions.split(',').map((opt, index) => {
            const trimmedOpt = opt.trim();
            const value = trimmedOpt.toLowerCase().replace(/\s+/g, '_');
            return {
                id: `${value}-${index}`,
                value: value,
                label: trimmedOpt,
            };
        });
    }

    const newField: Omit<CustomFieldDefinition, 'id' | 'workspace_id'> = {
      label: newFieldLabel,
      type: newFieldType,
      placeholder: newFieldPlaceholder || `Insira ${newFieldLabel}...`,
      options: options,
    };
    
    const result = await createCustomFieldDefinition(user.activeWorkspaceId, newField);
    if (result.success) {
        toast({ title: 'Campo Criado!'})
        setNewFieldLabel('');
        setNewFieldType('text');
        setNewFieldOptions('');
        setNewFieldPlaceholder('');
        fetchAllData();
    } else {
        toast({ title: 'Erro ao Criar Campo', description: result.error, variant: 'destructive' })
    }
  };

  const handleRemoveField = async (id: string) => {
    const result = await deleteCustomFieldDefinition(id);
    if (result.success) {
        toast({ title: 'Campo Removido!'})
        fetchAllData();
    } else {
        toast({ title: 'Erro ao Remover Campo', description: result.error, variant: 'destructive' })
    }
  };


  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Configurações do CRM</DialogTitle>
          <DialogDescription>
            Gerencie os campos e opções que aparecerão nos formulários e perfis. Adapte o CRM às necessidades do seu negócio.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto p-1">
            <Tabs defaultValue="fields">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="fields">Campos Personalizados</TabsTrigger>
                    <TabsTrigger value="options">Etiquetas e Opções</TabsTrigger>
                </TabsList>
                <TabsContent value="fields">
                    <Card className='border-0 shadow-none'>
                    <CardHeader>
                        <CardTitle>Gerenciador de Campos</CardTitle>
                         <CardDescription>Crie campos únicos para capturar informações essenciais para o seu negócio.</CardDescription>
                    </CardHeader>
                    <CardContent>
                            <form onSubmit={handleAddField} className="flex flex-col gap-4 mb-6 p-4 border rounded-lg bg-secondary/30">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                                    <div className="flex-1 space-y-2">
                                        <Label htmlFor="field-label">Nome do Campo</Label>
                                        <Input 
                                            id="field-label"
                                            placeholder="Ex: Orçamento Anual"
                                            value={newFieldLabel}
                                            onChange={(e) => setNewFieldLabel(e.target.value)}
                                            className="h-9"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="field-type">Tipo do Campo</Label>
                                        <Select value={newFieldType} onValueChange={(val) => setNewFieldType(val as CustomFieldDefinition['type'])}>
                                            <SelectTrigger id="field-type" className="h-9">
                                                <SelectValue placeholder="Selecione o tipo" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="text">Texto</SelectItem>
                                                <SelectItem value="number">Número</SelectItem>
                                                <SelectItem value="date">Data</SelectItem>
                                                <SelectItem value="email">Email</SelectItem>
                                                <SelectItem value="tel">Telefone</SelectItem>
                                                <SelectItem value="select">Dropdown</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <Button type="submit" className="h-9">
                                        <PlusCircle className="mr-2 h-4 w-4" />
                                        Adicionar
                                    </Button>
                                </div>
                                {newFieldType === 'select' ? (
                                     <div className="space-y-2 animate-in fade-in-50">
                                        <Label htmlFor="field-options">Opções do Dropdown</Label>
                                        <Textarea
                                            id="field-options"
                                            placeholder="Opção 1, Opção 2, Opção 3"
                                            value={newFieldOptions}
                                            onChange={(e) => setNewFieldOptions(e.target.value)}
                                        />
                                        <p className="text-xs text-muted-foreground">Separe cada opção com uma vírgula.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2 animate-in fade-in-50">
                                        <Label htmlFor="field-placeholder">Texto de Exemplo (Placeholder)</Label>
                                        <Input
                                            id="field-placeholder"
                                            placeholder="Ex: R$ 50.000"
                                            value={newFieldPlaceholder}
                                            onChange={(e) => setNewFieldPlaceholder(e.target.value)}
                                        />
                                    </div>
                                )}
                            </form>

                            <div className="space-y-4">
                                <h3 className="font-semibold text-muted-foreground">Campos Atuais</h3>
                                {fields.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {fields.map(field => (
                                        <div key={field.id} className="flex items-center justify-between p-3 border rounded-md bg-background">
                                            <div>
                                                <p className="font-medium">{field.label}</p>
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="outline" className="capitalize">{field.type}</Badge>
                                                    {field.type === 'select' && field.options && (
                                                        <p className="text-xs text-muted-foreground truncate">
                                                            Opções: {field.options.map(o => o.label).join(', ')}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemoveField(field.id)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                                <span className="sr-only">Remover</span>
                                            </Button>
                                        </div>
                                    ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground p-4 text-center border-dashed border rounded-md">
                                        Nenhum campo personalizado criado.
                                    </p>
                                )}
                            </div>
                    </CardContent>
                    </Card>
                </TabsContent>
                 <TabsContent value="options">
                     <Card className='border-0 shadow-none'>
                        <CardHeader>
                            <CardTitle>Gerenciador de Etiquetas e Opções</CardTitle>
                            <CardDescription>Personalize as etiquetas e as opções disponíveis nos campos de seleção do CRM.</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="h-[55vh]">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-1">
                              {loading ? <Loader2 className="h-6 w-6 animate-spin"/> : (
                                 <OptionsManager 
                                    title="Etiquetas (Tags)" 
                                    options={tags} 
                                    onAdd={handleAddTag}
                                    onRemove={handleRemoveTag}
                                />
                              )}
                            </div>
                          </ScrollArea>
                        </CardContent>
                     </Card>
                </TabsContent>
            </Tabs>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Fechar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
