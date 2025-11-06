
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function UsersPage() {
    return (
        <div>
            <div className="grid auto-rows-max items-start gap-4 md:gap-8 lg:col-span-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Gerenciamento de Usuários</CardTitle>
                        <CardDescription>
                            Visualize e gerencie todos os usuários da plataforma.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">Em breve: uma lista de todos os usuários com a capacidade de editar seus workspaces e permissões de superadmin.</p>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

    