import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { UploadCloud, FileText, Trash2, Plus, Loader2 } from 'lucide-react';
import type { KnowledgeBaseDocument } from '@/lib/types';
import { cn } from '@/lib/utils'; // Make sure cn is available or remove if not

interface AutopilotKnowledgeProps {
    documents: KnowledgeBaseDocument[];
    onUpload: (files: FileList | null) => Promise<void>;
    onRemove: (id: string) => void;
    onUpdateContent: (id: string, content: string) => void;
    onUpdateName: (id: string, name: string) => void;
    onAddManual: () => void;
    isUploading: boolean;
}

export function AutopilotKnowledge({
    documents,
    onUpload,
    onRemove,
    onUpdateContent,
    onUpdateName,
    onAddManual,
    isUploading
}: AutopilotKnowledgeProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragActive, setDragActive] = useState(false);
    const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onUpload(e.dataTransfer.files);
        }
    };

    const selectedDoc = documents.find(d => d.id === selectedDocId) || documents[0];

    return (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-[calc(100vh-200px)] min-h-[500px]">
            {/* Sidebar List */}
            <div className="md:col-span-4 flex flex-col gap-4 h-full">
                <Card className="flex flex-col flex-1 overflow-hidden">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg">Base de Conhecimento</CardTitle>
                        <CardDescription>Carregue arquivos ou escreva notas.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-y-auto min-h-0 space-y-2 p-2 mx-2">
                        {/* Dropzone */}
                        <div
                            className={cn(
                                "border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-muted/20 hover:bg-muted/40",
                                dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/20"
                            )}
                            onDragEnter={handleDrag}
                            onDragLeave={handleDrag}
                            onDragOver={handleDrag}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept=".txt,.md,.csv,.json"
                                className="hidden"
                                onChange={(e) => onUpload(e.target.files)}
                            />
                            {isUploading ? (
                                <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
                            ) : (
                                <UploadCloud className="h-8 w-8 text-muted-foreground mb-2" />
                            )}
                            <p className="text-sm font-medium">Clique ou arraste arquivos</p>
                            <p className="text-xs text-muted-foreground mt-1">.txt, .md, .csv</p>
                        </div>

                        <div className="h-px bg-border my-2" />

                        <Button onClick={onAddManual} variant="outline" className="w-full justify-start gap-2 mb-2">
                            <Plus className="h-4 w-4" /> Nova Nota Manual
                        </Button>

                        {/* List */}
                        <div className="space-y-1">
                            {documents.map(doc => (
                                <div
                                    key={doc.id}
                                    onClick={() => setSelectedDocId(doc.id)}
                                    className={cn(
                                        "group flex items-center justify-between p-2 rounded-md text-sm cursor-pointer border hover:bg-muted transition-colors",
                                        selectedDoc?.id === doc.id ? "bg-muted border-primary/50" : "border-transparent"
                                    )}
                                >
                                    <div className="flex items-center gap-2 truncate">
                                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                        <span className="truncate font-medium">{doc.name}</span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRemove(doc.id);
                                            if (selectedDocId === doc.id) setSelectedDocId(null);
                                        }}
                                    >
                                        <Trash2 className="h-3 w-3 text-destructive" />
                                    </Button>
                                </div>
                            ))}
                            {documents.length === 0 && (
                                <p className="text-center text-sm text-muted-foreground py-8">Nenhum documento na base.</p>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Editor Area */}
            <div className="md:col-span-8 h-full">
                {selectedDoc ? (
                    <Card className="h-full flex flex-col">
                        <CardHeader className="py-4 border-b">
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Nome do Arquivo / Título</Label>
                                <Input
                                    value={selectedDoc.name}
                                    onChange={(e) => onUpdateName(selectedDoc.id, e.target.value)}
                                    className="font-semibold text-lg border-none hover:bg-muted/50 px-2 h-auto"
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1 p-0 flex flex-col min-h-0">
                            <Textarea
                                className="flex-1 resize-none border-0 focus-visible:ring-0 p-4 font-mono text-sm leading-relaxed"
                                placeholder="Cole o conteúdo do documento aqui ou escreva instruções..."
                                value={selectedDoc.content}
                                onChange={(e) => onUpdateContent(selectedDoc.id, e.target.value)}
                            />
                            <div className="p-2 bg-muted/30 border-t text-xs text-muted-foreground flex justify-between px-4">
                                <span>{selectedDoc.tokens?.toLocaleString() || 0} tokens estimados</span>
                                <span>ID: {selectedDoc.id}</span>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg bg-muted/10">
                        <FileText className="h-12 w-12 mb-4 opacity-20" />
                        <p>Selecione um documento pare editar ou visualizar.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
