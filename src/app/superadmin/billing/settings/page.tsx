'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, Key, CreditCard } from 'lucide-react';
import { toast } from "@/hooks/use-toast";
import { saveSystemSettingAction, getSystemSettingsAction } from '@/actions/system-settings';
import { PLANS } from '@/lib/plans-types';

export default function BillingSettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Stripe Credentials
    const [stripePublicKey, setStripePublicKey] = useState('');
    const [stripeSecretKey, setStripeSecretKey] = useState('');
    const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');

    // Plan Mappings (Plan ID -> Stripe Price ID)
    const [priceIds, setPriceIds] = useState<Record<string, string>>({});

    useEffect(() => {
        const keysToFetch = [
            'stripe_public_key',
            'stripe_secret_key',
            'stripe_webhook_secret',
            ...Object.keys(PLANS).map(p => `stripe_price_${p}`)
        ];

        getSystemSettingsAction(keysToFetch)
            .then(settings => {
                setStripePublicKey(settings['stripe_public_key'] || '');
                setStripeSecretKey(settings['stripe_secret_key'] || '');
                setStripeWebhookSecret(settings['stripe_webhook_secret'] || '');

                const loadedPrices: Record<string, string> = {};
                Object.keys(PLANS).forEach(p => {
                    loadedPrices[p] = settings[`stripe_price_${p}`] || '';
                });
                setPriceIds(loadedPrices);
            })
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            // Save Credentials
            await saveSystemSettingAction('stripe_public_key', stripePublicKey);
            await saveSystemSettingAction('stripe_secret_key', stripeSecretKey);
            await saveSystemSettingAction('stripe_webhook_secret', stripeWebhookSecret);

            // Save Price IDs
            for (const [planId, priceId] of Object.entries(priceIds)) {
                await saveSystemSettingAction(`stripe_price_${planId}`, priceId);
            }

            toast({
                title: "Configurações salvas",
                description: "As credenciais e mapeamentos do Stripe foram atualizados.",
            });
        } catch (error) {
            toast({
                title: "Erro ao salvar",
                description: "Ocorreu um erro ao salvar as configurações.",
                variant: "destructive"
            });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <header>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Key className="w-6 h-6 text-primary" />
                    Configurações de Pagamento (Stripe)
                </h1>
                <p className="text-muted-foreground">Configure as chaves da API do Stripe e mapeie os preços dos planos.</p>
            </header>

            <Tabs defaultValue="credentials">
                <TabsList>
                    <TabsTrigger value="credentials">Credenciais da API</TabsTrigger>
                    <TabsTrigger value="plans">Mapeamento de Planos</TabsTrigger>
                </TabsList>

                <TabsContent value="credentials">
                    <Card>
                        <CardHeader>
                            <CardTitle>Chaves de Acesso</CardTitle>
                            <CardDescription>
                                Encontre essas chaves no Dashboard do Stripe em Developers {'>'} API Keys.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Publishable Key (Chave Pública)</Label>
                                <Input
                                    value={stripePublicKey}
                                    onChange={e => setStripePublicKey(e.target.value)}
                                    placeholder="pk_test_..."
                                    className="font-mono"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Secret Key (Chave Secreta)</Label>
                                <Input
                                    value={stripeSecretKey}
                                    onChange={e => setStripeSecretKey(e.target.value)}
                                    type="password"
                                    placeholder="sk_test_..."
                                    className="font-mono"
                                />
                                <p className="text-xs text-muted-foreground">Esta chave é armazenada de forma segura no banco de dados.</p>
                            </div>
                            <div className="space-y-2">
                                <Label>Webhook Signing Secret</Label>
                                <Input
                                    value={stripeWebhookSecret}
                                    onChange={e => setStripeWebhookSecret(e.target.value)}
                                    type="password"
                                    placeholder="whsec_..."
                                    className="font-mono"
                                />
                                <p className="text-xs text-muted-foreground">Necessário para validar eventos de webhook (faturas pagas, etc).</p>
                            </div>
                        </CardContent>
                        <CardFooter className="justify-end">
                            <Button onClick={handleSave} disabled={saving}>
                                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                                Salvar Credenciais
                            </Button>
                        </CardFooter>
                    </Card>
                </TabsContent>

                <TabsContent value="plans">
                    <Card>
                        <CardHeader>
                            <CardTitle>IDs de Preço (Price IDs)</CardTitle>
                            <CardDescription>
                                Cole o ID do Preço (ex: price_123...) gerado no Stripe para cada plano correspondente.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {Object.entries(PLANS).filter(([key]) => key !== 'enterprise').map(([key, plan]) => (
                                <div key={key} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center p-4 border rounded-lg">
                                    <div className="font-semibold flex items-center gap-2">
                                        <CreditCard className="w-4 h-4 text-muted-foreground" />
                                        {plan.label}
                                    </div>
                                    <div className="col-span-2">
                                        <Input
                                            value={priceIds[key] || ''}
                                            onChange={e => setPriceIds(prev => ({ ...prev, [key]: e.target.value }))}
                                            placeholder={`price_... para ${plan.label}`}
                                            className="font-mono"
                                        />
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                        <CardFooter className="justify-end">
                            <Button onClick={handleSave} disabled={saving}>
                                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                                Salvar Mapeamento
                            </Button>
                        </CardFooter>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
