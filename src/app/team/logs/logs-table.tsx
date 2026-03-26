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
            <div className="rounded-xl border border-slate-200/80 bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.14)]">
                <Table>
                    <TableHeader className="bg-slate-50">
                        <TableRow className="border-slate-200 hover:bg-slate-50">
                            <TableHead className="text-slate-500">Data/Hora</TableHead>
                            <TableHead className="text-slate-500">Acao</TableHead>
                            <TableHead className="text-slate-500">Usuario</TableHead>
                            <TableHead className="text-right text-slate-500">Detalhes</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.map((log) => (
                            <TableRow key={log.id} className="border-slate-200 hover:bg-slate-50">
                                <TableCell className="font-medium text-slate-700">
                                    {format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                                </TableCell>
                                <TableCell className="font-mono text-sm text-slate-700">
                                    {log.action}
                                </TableCell>
                                <TableCell className="text-slate-700">
                                    {log.user_name || log.user_email || 'Sistema'}
                                </TableCell>
                                <TableCell className="text-right">
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-950">
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent className="max-w-2xl border-slate-200 bg-white text-slate-950">
                                            <DialogHeader>
                                                <DialogTitle>Detalhes do Log</DialogTitle>
                                            </DialogHeader>
                                            <div className="grid gap-4 py-4">
                                                <div className="grid grid-cols-4 items-center gap-4">
                                                    <span className="text-sm font-medium text-slate-500">ID:</span>
                                                    <span className="col-span-3 text-sm font-mono">{log.id}</span>
                                                </div>
                                                <div className="grid grid-cols-4 items-center gap-4">
                                                    <span className="text-sm font-medium text-slate-500">Acao:</span>
                                                    <span className="col-span-3 text-sm font-mono">{log.action}</span>
                                                </div>
                                                <div className="space-y-2">
                                                    <span className="text-sm font-medium text-slate-500">Payload:</span>
                                                    <ScrollArea className="h-[300px] w-full rounded-md border border-slate-200 bg-slate-50 p-4">
                                                        <pre className="whitespace-pre-wrap font-mono text-xs text-slate-700">
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
                                <TableCell colSpan={4} className="h-24 text-center text-slate-500">
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
                    className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                </Button>
                <div className="text-sm text-slate-500">
                    Pagina {currentPage} de {Math.max(1, totalPages)}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                >
                    Proximo
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
