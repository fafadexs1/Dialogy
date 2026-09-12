"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ShieldCheck,
  PlugZap,
  Loader2,
  CheckCircle2,
  Circle,
} from "lucide-react";
import {
  getAsaasSettingsAction,
  saveAsaasSettingsAction,
  connectAsaasWebhookAction,
} from "@/actions/asaas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
export default function BillingSettingsPage() {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof getAsaasSettingsAction>
  > | null>(null);
  const [environment, setEnvironment] = useState<"sandbox" | "production">(
    "sandbox",
  );
  const [apiKey, setApiKey] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    try {
      const d = await getAsaasSettingsAction();
      setData(d);
      setEnvironment(d.environment);
    } catch {
      setError(
        "Não foi possível carregar as configurações ASAAS. Verifique a migração de cobrança.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function run(
    action: () => Promise<{ success: boolean; error?: string }>,
    success: string,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await action();
      if (!r.success) {
        setError(r.error || "Falha na operação.");
        return;
      }
      setNotice(success);
      setApiKey("");
      setWebhookToken("");
      await load();
    } catch {
      setError("A operação não foi confirmada. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <Link
        href="/superadmin/billing"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft size={15} /> Voltar para cobranças
      </Link>
      <header>
        <span className="text-xs font-semibold uppercase tracking-widest text-primary">
          Integração de pagamentos
        </span>
        <h1 className="mt-2 text-3xl font-semibold">Conecte sua conta ASAAS</h1>
        <p className="mt-2 text-muted-foreground">
          Do primeiro pagamento à renovação, mantenha a assinatura e o acesso do
          cliente sincronizados.
        </p>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm"
        >
          {notice}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck size={20} /> Acesso seguro
            </CardTitle>
            <CardDescription>
              As chaves salvas são criptografadas e não retornam ao navegador.
              Deixe em branco para manter uma chave existente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () =>
                    saveAsaasSettingsAction({
                      environment,
                      apiKey,
                      webhookToken,
                    }),
                  "Configurações salvas. Agora conecte o webhook.",
                );
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="asaas-environment">Ambiente</Label>
                <select
                  id="asaas-environment"
                  value={environment}
                  onChange={(e) =>
                    setEnvironment(e.target.value as typeof environment)
                  }
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="sandbox">Sandbox · pagamentos de teste</option>
                  <option value="production">
                    Produção · pagamentos reais
                  </option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="asaas-key">Chave de API</Label>
                <Input
                  id="asaas-key"
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    data?.apiKeyConfigured
                      ? "Chave configurada · preencha para substituir"
                      : "Cole a chave da conta ASAAS"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="asaas-token">
                  Token de autenticação do webhook
                </Label>
                <Input
                  id="asaas-token"
                  type="password"
                  autoComplete="new-password"
                  value={webhookToken}
                  onChange={(e) => setWebhookToken(e.target.value)}
                  placeholder={
                    data?.webhookConfigured
                      ? "Token configurado"
                      : "Gerado automaticamente ao salvar"
                  }
                />
              </div>
              {data && !data.encryptionReady && (
                <p className="text-xs text-amber-600">
                  Para salvar chaves nesta tela, configure ASAAS_ENCRYPTION_KEY
                  no servidor com ao menos 32 caracteres. Credenciais via
                  variáveis de ambiente também são aceitas.
                </p>
              )}
              <Button type="submit" disabled={busy || !data?.encryptionReady}>
                {busy && <Loader2 className="animate-spin" size={16} />} Salvar
                configuração
              </Button>
            </form>
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Pronto para automatizar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                [data?.apiKeyConfigured, "Chave de API configurada"],
                [data?.webhookConfigured, "Autenticação do webhook"],
                [!!data?.lastEvent, "Primeiro evento recebido"],
              ].map(([ok, label]) => (
                <div
                  key={String(label)}
                  className="flex items-center gap-3 text-sm"
                >
                  {ok ? (
                    <CheckCircle2 size={18} className="text-primary" />
                  ) : (
                    <Circle size={18} className="text-muted-foreground" />
                  )}
                  {label}
                </div>
              ))}
              <div className="border-t pt-4">
                <p className="mb-2 text-xs text-muted-foreground">
                  Endereço de notificação
                </p>
                <p className="break-all rounded-lg bg-muted p-3 font-mono text-xs">
                  {data?.webhookUrl ||
                    "Configure NEXT_PUBLIC_APP_URL no servidor"}
                </p>
                {data?.lastEvent && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Último evento:{" "}
                    {new Date(data.lastEvent).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                className="w-full"
                disabled={
                  busy || !data?.apiKeyConfigured || !data?.webhookConfigured
                }
                onClick={() =>
                  run(
                    connectAsaasWebhookAction,
                    "Webhook conectado no ASAAS. A integração aguarda o primeiro evento.",
                  )
                }
              >
                <PlugZap size={16} /> Conectar webhook no ASAAS
              </Button>
            </CardContent>
          </Card>
          <div className="rounded-xl border p-5 text-sm leading-relaxed text-muted-foreground">
            Os valores vêm do catálogo de planos da Dialogy. Não é necessário
            cadastrar IDs de preço no ASAAS. Cobranças emitidas e contratos
            existentes mantêm o valor contratado.
          </div>
        </div>
      </div>
    </div>
  );
}
