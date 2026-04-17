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
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 min-h-[600px] h-full">
            {/* Sidebar List */}
            <div className="md:col-span-4 flex flex-col gap-4">
                <Card className="flex flex-col border-0 shadow-sm bg-white overflow-hidden h-full">
                    <CardHeader className="border-b bg-slate-50/50 py-4">
                        <CardTitle className="text-lg">Base de Documentos</CardTitle>
                        <CardDescription className="text-xs">Contexto para as respostas de IA.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col p-4 space-y-4">
                        {/* Dropzone */}
                        <div
                            className={cn(
                                "border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all bg-slate-50 hover:bg-slate-100",
                                dragActive ? "border-teal-500 bg-teal-50/50" : "border-slate-200"
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
                                <Loader2 className="h-6 w-6 text-teal-600 animate-spin mb-2" />
                            ) : (
                                <UploadCloud className="h-6 w-6 text-slate-400 mb-2" />
                            )}
                            <p className="text-xs font-bold text-slate-900">Upload de Arquivos</p>
                            <p className="text-[10px] text-slate-500 mt-1">.txt, .md, .csv, .json</p>
                        </div>

                        <Button onClick={onAddManual} variant="outline" className="w-full justify-center gap-2 rounded-xl border-slate-200 bg-white">
                            <Plus className="h-4 w-4" /> Nova Nota Manual
                        </Button>

                        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
                            {documents.map(doc => (
                                <div
                                    key={doc.id}
                                    onClick={() => setSelectedDocId(doc.id)}
                                    className={cn(
                                        "group flex items-center justify-between p-3 rounded-xl text-sm cursor-pointer border transition-all",
                                        selectedDoc?.id === doc.id 
                                            ? "bg-teal-50 border-teal-200 text-teal-900 shadow-sm" 
                                            : "border-transparent hover:bg-slate-50 text-slate-600"
                                    )}
                                >
                                    <div className="flex items-center gap-2 truncate">
                                        <FileText className={cn("h-4 w-4 shrink-0", selectedDoc?.id === doc.id ? "text-teal-600" : "text-slate-400")} />
                                        <span className="truncate font-medium">{doc.name}</span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:text-red-600"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRemove(doc.id);
                                            if (selectedDocId === doc.id) setSelectedDocId(null);
                                        }}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            ))}
                            {documents.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-10 opacity-40">
                                    <FileText className="h-8 w-8 mb-2" />
                                    <p className="text-xs">Base vazia</p>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Editor Area */}
            <div className="md:col-span-8">
                {selectedDoc ? (
                    <Card className="h-full flex flex-col border-0 shadow-sm bg-white overflow-hidden">
                        <CardHeader className="py-4 border-b bg-slate-50/30">
                            <div className="space-y-1">
                                <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Título do Documento</Label>
                                <Input
                                    value={selectedDoc.name}
                                    onChange={(e) => onUpdateName(selectedDoc.id, e.target.value)}
                                    className="font-bold text-lg border-none bg-transparent hover:bg-slate-100/50 p-0 h-auto focus-visible:ring-0"
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1 p-0 flex flex-col min-h-0">
                            <Textarea
                                className="flex-1 resize-none border-0 focus-visible:ring-0 p-8 font-mono text-sm leading-relaxed"
                                placeholder="Insira o conteúdo aqui..."
                                value={selectedDoc.content}
                                onChange={(e) => onUpdateContent(selectedDoc.id, e.target.value)}
                            />
                            <div className="px-6 py-3 bg-slate-50 border-t text-[10px] font-bold text-slate-400 flex justify-between">
                                <span>{selectedDoc.tokens?.toLocaleString() || 0} TOKENS ESTIMADOS</span>
                                <span>ID: {selectedDoc.id}</span>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 border-2 border-dashed rounded-3xl bg-slate-50">
                        <FileText className="h-12 w-12 mb-4 opacity-20" />
                        <p className="font-bold text-sm">Selecione um item para editar</p>
                        <p className="text-xs">Clique na lista lateral para ver o conteúdo</p>
                    </div>
                )}
            </div>
        </div>
    );
}

