'use client';

import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

export default function SecurityPage() {
    const user = useAuth();
    
    if (!user) {
        return <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    }

    return (
        <div>
            <h1 className="text-2xl font-bold">Segurança</h1>
            <p className="text-muted-foreground">Em breve: altere sua senha e gerencie a autenticação de dois fatores.</p>
        </div>
    )
}