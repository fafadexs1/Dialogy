
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

const clusterTypes = [
    {
        name: "Evolution API",
        description: "Gerencie os servidores da Evolution API que distribuem as instâncias de WhatsApp não-oficiais.",
        icon: "https://raw.githubusercontent.com/EvolutionAPI/evolution-api/main/public/icon.png",
        href: "/superadmin/clusters/evolution",
        status: "active"
    }
]

export default function ClustersGatewayPage() {
    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold">Gerenciamento de Clusters</h1>
                <p className="text-muted-foreground">Selecione o tipo de cluster que você deseja gerenciar.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {clusterTypes.map(cluster => (
                    <Card key={cluster.name} className="flex flex-col">
                        <CardHeader className="flex-row items-start gap-4">
                             <Image src={cluster.icon} alt={`${cluster.name} logo`} width={48} height={48} className="rounded-lg border p-1" />
                            <div>
                                <CardTitle>{cluster.name}</CardTitle>
                                <CardDescription>{cluster.description}</CardDescription>
                            </div>
                        </CardHeader>
                        <CardFooter className="mt-auto">
                            <Button asChild className="w-full" disabled={cluster.status !== 'active'}>
                                <Link href={cluster.href}>
                                    Gerenciar <ArrowRight className="ml-2 h-4 w-4" />
                                </Link>
                            </Button>
                        </CardFooter>
                    </Card>
                ))}
            </div>
        </div>
    )
}
