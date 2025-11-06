
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function BillingPage() {
    return (
        <div>
            <div className="grid auto-rows-max items-start gap-4 md:gap-8 lg:col-span-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Gerenciamento de Cobranças</CardTitle>
                        <CardDescription>
                            Visualize e gerencie os planos e faturas dos workspaces.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">Em breve: um painel para gerenciar assinaturas, faturas e limites de uso para cada workspace.</p>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

    