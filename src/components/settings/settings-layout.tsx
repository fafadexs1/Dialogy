'use client';

import React, { useState } from 'react';
import { type CustomFieldDefinition } from '@/lib/types';
import { mockCustomFieldDefinitions } from '@/lib/mock-data';
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
import { PlusCircle, Trash2 } from 'lucide-react';
import { HTMLInputTypeAttribute } from 'react';

export default function SettingsLayout() {
  const [fields, setFields] = useState<CustomFieldDefinition[]>(mockCustomFieldDefinitions);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<HTMLInputTypeAttribute>('text');

  const handleAddField = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldLabel.trim()) return;

    const newField: CustomFieldDefinition = {
      id: newFieldLabel.toLowerCase().replace(/\s+/g, '_'),
      label: newFieldLabel,
      type: newFieldType,
      placeholder: `Insira ${newFieldLabel}...`,
    };

    setFields([...fields, newField]);
    setNewFieldLabel('');
    setNewFieldType('text');
  };

  const handleRemoveField = (id: string) => {
    setFields(fields.filter(field => field.id !== id));
  };


  return (
    <main className="flex-1 flex-col bg-secondary/10 p-6">
       <div className="mx-auto max-w-4xl">
         <h1 className="text-3xl font-bold mb-2">Configurações</h1>
         <p className="text-muted-foreground mb-8">Gerencie as configurações da sua plataforma Dialogy.</p>

         <Card>
           <CardHeader>
             <CardTitle>Gerenciador de Campos Personalizados</CardTitle>
             <CardDescription>
                Crie e gerencie os campos que aparecerão nos formulários de contato e empresa.
                Isso permite adaptar o CRM às necessidades específicas do seu negócio.
             </CardDescription>
           </CardHeader>
           <CardContent>
                <form onSubmit={handleAddField} className="flex items-end gap-4 mb-6 p-4 border rounded-lg bg-background">
                    <div className="flex-1 space-y-2">
                        <Label htmlFor="field-label">Nome do Campo</Label>
                        <Input 
                            id="field-label"
                            placeholder="Ex: Orçamento Anual"
                            value={newFieldLabel}
                            onChange={(e) => setNewFieldLabel(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="field-type">Tipo do Campo</Label>
                         <Select value={newFieldType} onValueChange={(val) => setNewFieldType(val as HTMLInputTypeAttribute)}>
                            <SelectTrigger id="field-type" className="w-[180px]">
                                <SelectValue placeholder="Selecione o tipo" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="text">Texto</SelectItem>
                                <SelectItem value="number">Número</SelectItem>
                                <SelectItem value="date">Data</SelectItem>
                                <SelectItem value="email">Email</SelectItem>
                                <SelectItem value="tel">Telefone</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Button type="submit">
                        <PlusCircle className="mr-2" />
                        Adicionar Campo
                    </Button>
                </form>

                <div className="space-y-4">
                    <h3 className="font-semibold text-lg text-muted-foreground">Campos Atuais</h3>
                    {fields.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {fields.map(field => (
                            <div key={field.id} className="flex items-center justify-between p-3 border rounded-md bg-background">
                                <div>
                                    <p className="font-medium">{field.label}</p>
                                    <p className="text-xs text-muted-foreground capitalize bg-secondary px-2 py-0.5 rounded-full inline-block mt-1">{field.type}</p>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => handleRemoveField(field.id)}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                    <span className="sr-only">Remover</span>
                                </Button>
                            </div>
                        ))}
                        </div>
                    ) : (
                         <p className="text-sm text-muted-foreground p-4 text-center border-dashed border rounded-md">
                            Nenhum campo personalizado criado. Adicione um acima para começar.
                        </p>
                    )}
                </div>
           </CardContent>
         </Card>
       </div>
    </main>
  );
}
