

'use client';

import React, { useState } from 'react';
import type { CustomFieldDefinition, SelectableOption, Tag } from '@/lib/types';
import { 
    mockCustomFieldDefinitions, 
    leadSources as mockLeadSources, 
    contactChannels as mockContactChannels, 
    jobTitles as mockJobTitles,
    mockTags 
} from '@/lib/mock-data';
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
import { PlusCircle, Trash2, Palette } from 'lucide-react';
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
import { HTMLInputTypeAttribute } from 'react';
import { Checkbox } from '../ui/checkbox';
import { DialogClose } from '@radix-ui/react-dialog';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';

// A generic manager for lists of selectable options (like lead sources, job titles, etc.)
function OptionsManager({ 
    title, 
    options, 
    setOptions 
}: { 
    title: string, 
    options: (SelectableOption | Tag)[], 
    setOptions: React.Dispatch<React.SetStateAction<(SelectableOption | Tag)[]>> 
}) {
    const [newItemLabel, setNewItemLabel] = useState('');
    const [newItemColor, setNewItemColor] = useState('#cccccc');
    const [isCloseReason, setIsCloseReason] = useState(false);

    const handleAddItem = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newItemLabel.trim()) return;
        
        const newItem = {
            id: newItemLabel.toLowerCase().replace(/\s+/g, '_') + Date.now(),
            value: newItemLabel.toLowerCase().replace(/\s+/g, '_'),
            label: newItemLabel,
            color: newItemColor,
            is_close_reason: title === "Etiquetas (Tags)" ? isCloseReason : undefined,
        };
        
        setOptions([...options, newItem]);
        setNewItemLabel('');
        setNewItemColor('#cccccc');
        setIsCloseReason(false);
    };

    const handleRemoveItem = (itemToRemove: SelectableOption | Tag) => {
        setOptions(options.filter(item => item.id !== itemToRemove.id));
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
                        <Button type="submit" size="sm" className='h-9'>Adicionar</Button>
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
                                    <span>{option.label}</span>
                                    {(option as Tag).is_close_reason && (
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


export function CrmSettings({ children }: { children: React.ReactNode }) {
  const [fields, setFields] = useState<CustomFieldDefinition[]>(mockCustomFieldDefinitions);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<CustomFieldDefinition['type']>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');

  const [leadSources, setLeadSources] = useState<SelectableOption[]>(mockLeadSources);
  const [contactChannels, setContactChannels] = useState<SelectableOption[]>(mockContactChannels);
  const [jobTitles, setJobTitles] = useState<SelectableOption[]>(mockJobTitles);
  const [tags, setTags] = useState<Tag[]>(mockTags);


  const handleAddField = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldLabel.trim()) return;

    let options: SelectableOption[] | undefined;
    if (newFieldType === 'select' && newFieldOptions.trim()) {
        options = newFieldOptions.split(',').map((opt, index) => {
            const trimmedOpt = opt.trim();
            const value = trimmedOpt.toLowerCase().replace(/\s+/g, '_');
            return {
                id: `${value}-${index}`,
                value: value,
                label: trimmedOpt,
                color: '#cccccc' // Default color for now
            };
        });
    }

    const newField: CustomFieldDefinition = {
      id: `custom_${newFieldLabel.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
      label: newFieldLabel,
      type: newFieldType,
      placeholder: `Insira ${newFieldLabel}...`,
      options: options,
    };

    setFields([...fields, newField]);
    setNewFieldLabel('');
    setNewFieldType('text');
    setNewFieldOptions('');
  };

  const handleRemoveField = (id: string) => {
    setFields(fields.filter(field => field.id !== id));
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
                                <div className="flex items-end gap-4">
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
                                            <SelectTrigger id="field-type" className="w-[180px] h-9">
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
                                {newFieldType === 'select' && (
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
                              <OptionsManager title="Etiquetas (Tags)" options={tags} setOptions={setTags as any} />
                              <OptionsManager title="Cargos" options={jobTitles} setOptions={setJobTitles as any} />
                              <OptionsManager title="Origem do Lead" options={leadSources} setOptions={setLeadSources as any} />
                              <OptionsManager title="Canais de Contato" options={contactChannels} setOptions={setContactChannels as any} />
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
