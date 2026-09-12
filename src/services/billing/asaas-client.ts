import "server-only";
import { db } from "@/lib/db";
import { decryptWithKey } from "@/lib/security/secret-box";

export type AsaasConfig = {
  environment: "sandbox" | "production";
  apiKey: string;
  webhookToken: string;
};
export async function readAsaasConfig(): Promise<AsaasConfig> {
  const res = await db.query(
    "SELECT key,value FROM system_settings WHERE key = ANY($1)",
    [["asaas_environment", "asaas_api_key", "asaas_webhook_token"]],
  );
  const settings = Object.fromEntries(res.rows.map((r) => [r.key, r.value]));
  const secret = (key: string, env: string) =>
    settings[key]
      ? decryptWithKey(
          settings[key],
          process.env.ASAAS_ENCRYPTION_KEY,
          "ASAAS_ENCRYPTION_KEY",
        )
      : process.env[env] || "";
  return {
    environment:
      (settings.asaas_environment || process.env.ASAAS_ENVIRONMENT) ===
      "production"
        ? "production"
        : "sandbox",
    apiKey: secret("asaas_api_key", "ASAAS_API_KEY"),
    webhookToken: secret("asaas_webhook_token", "ASAAS_WEBHOOK_TOKEN"),
  };
}

export class AsaasError extends Error {
  constructor(public status: number) {
    super(
      status === 401 || status === 403
        ? "Credencial ASAAS inválida ou sem permissão."
        : "O ASAAS não concluiu a operação. Verifique os dados de cobrança e tente novamente.",
    );
  }
}

export async function asaasRequest<T>(
  config: AsaasConfig,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (!config.apiKey || !config.webhookToken)
    throw new Error(
      "A cobrança ASAAS ainda está em configuração. Entre em contato com o suporte.",
    );
  const base =
    config.environment === "production"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      access_token: config.apiKey,
      "Content-Type": "application/json",
      "User-Agent": "Dialogy/1.0",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new AsaasError(response.status);
  return response.json();
}

export function safeInvoiceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["asaas.com", "www.asaas.com", "sandbox.asaas.com"].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export type AsaasPayment = {
  id: string;
  customer: string;
  subscription: string;
  value: number;
  status: string;
  billingType: string;
  dueDate: string;
  paymentDate?: string;
  confirmedDate?: string;
  invoiceUrl?: string;
  deleted?: boolean;
};
export type AsaasSubscription = {
  id: string;
  customer: string;
  status: string;
  value: number;
  nextDueDate: string;
  externalReference?: string;
};
