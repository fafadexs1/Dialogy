'use client';

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { LogEntry } from "@/actions/logs";

interface LogsTableProps {
    data: LogEntry[];
    currentPage: number;
    totalPages: number;
}

export function LogsTable({ data, currentPage, totalPages }: LogsTableProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const handlePageChange = (newPage: number) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('page', newPage.toString());
        router.push(`?${params.toString()}`);
    };

    return (
        <div className="space-y-4">
            <div className="rounded-md border border-white/10 bg-zinc-950">
                <Table>
                    <TableHeader>
                        <TableRow className="border-white/10 hover:bg-white/5">
                            <TableHead className="text-zinc-400">Data/Hora</TableHead>
                            <TableHead className="text-zinc-400">Ação</TableHead>
                            <TableHead className="text-zinc-400">Usuário</TableHead>
                            <TableHead className="text-zinc-400 text-right">Detalhes</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.map((log) => (
                            <TableRow key={log.id} className="border-white/10 hover:bg-white/5">
                                <TableCell className="font-medium text-zinc-300">
                                    {format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                                </TableCell>
                                <TableCell className="text-zinc-300 font-mono text-sm">
                                    {log.action}
                                </TableCell>
                                <TableCell className="text-zinc-300">
                                    {log.user_name || log.user_email || 'Sistema'}
                                </TableCell>
                                <TableCell className="text-right">
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-white/10">
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent className="bg-zinc-950 border-white/10 text-white max-w-2xl">
                                            <DialogHeader>
                                                <DialogTitle>Detalhes do Log</DialogTitle>
                                            </DialogHeader>
                                            <div className="grid gap-4 py-4">
                                                <div className="grid grid-cols-4 items-center gap-4">
                                                    <span className="text-sm font-medium text-zinc-400">ID:</span>
                                                    <span className="col-span-3 text-sm font-mono">{log.id}</span>
                                                </div>
                                                <div className="grid grid-cols-4 items-center gap-4">
                                                    <span className="text-sm font-medium text-zinc-400">Ação:</span>
                                                    <span className="col-span-3 text-sm font-mono">{log.action}</span>
                                                </div>
                                                <div className="space-y-2">
                                                    <span className="text-sm font-medium text-zinc-400">Payload:</span>
                                                    <ScrollArea className="h-[300px] w-full rounded-md border border-white/10 bg-black/50 p-4">
                                                        <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap">
                                                            {JSON.stringify(log.payload, null, 2)}
                                                        </pre>
                                                    </ScrollArea>
                                                </div>
                                            </div>
                                        </DialogContent>
                                    </Dialog>
                                </TableCell>
                            </TableRow>
                        ))}
                        {data.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center text-zinc-500">
                                    Nenhum log encontrado.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <div className="flex items-center justify-end space-x-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className="bg-transparent border-white/10 text-white hover:bg-white/10"
                >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                </Button>
                <div className="text-sm text-zinc-400">
                    Página {currentPage} de {Math.max(1, totalPages)}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="bg-transparent border-white/10 text-white hover:bg-white/10"
                >
                    Próximo
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
