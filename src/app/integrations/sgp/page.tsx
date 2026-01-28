
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { SGPConfigForm } from "@/plugins/sgp/components/config-form";

export default function SGPIntegrationPage() {
    return (
        <div className="flex flex-col flex-1 h-full bg-muted/10 p-4 sm:p-8">
            <div className="max-w-4xl mx-auto w-full space-y-6">
                <div className="flex items-center gap-4">
                    <Link href="/integrations">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Configuração SGP</h1>
                        <p className="text-muted-foreground">
                            Configure a integração com o Sistema de Gestão SGP.
                        </p>
                    </div>
                </div>

                <SGPConfigForm />
            </div>
        </div>
    );
}
