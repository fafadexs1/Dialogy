
'use client';

import { Loader2 } from "lucide-react";
import { useSettings } from "../settings-context";
import { useI18n } from '@/i18n/i18n-provider';

export default function SecurityPage() {
    const { t } = useI18n();
    const { user } = useSettings();

    if (!user) {
        return <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    }

    return (
        <div>
            <h1 className="text-2xl font-bold">{t("Seguranca")}</h1>
            <p className="text-muted-foreground">{t("Em breve: altere sua senha e gerencie a autenticacao de dois fatores.")}</p>
        </div>
    )
}
