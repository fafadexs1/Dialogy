import { z } from 'zod';

const money = z.number().finite().min(0).max(1_000_000);
export const PlatformAiModelSchema = z.object({
  id: z.string().trim().min(3).max(180).regex(/^(googleai|openai|codex|deepseek|lmstudio)\/.+/),
  label: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  enabled: z.boolean(),
  supportedMediaTypes: z.array(z.enum(['image', 'pdf'])).max(2).optional(),
  inputCost: money,
  outputCost: money,
  inputMarkup: z.number().finite().min(0).max(10000),
  outputMarkup: z.number().finite().min(0).max(10000),
});
export const PlatformAiConfigSchema = z.object({
  defaultModel: z.string().trim().min(1),
  models: z.array(PlatformAiModelSchema).min(1).max(100),
  creditValueBrl: z.number().finite().min(0.000001).max(10000),
  costCurrency: z.enum(['BRL', 'USD']),
  usdToBrl: z.number().finite().min(0.01).max(1000),
  billingEnabled: z.boolean(),
}).superRefine((value, ctx) => {
  if (!value.models.some(m => m.id === value.defaultModel && m.enabled)) {
    ctx.addIssue({ code: 'custom', message: 'Selecione um modelo padrao ativo.' });
  }
  if (new Set(value.models.map(m => m.id)).size !== value.models.length) {
    ctx.addIssue({ code: 'custom', message: 'Existem modelos duplicados.' });
  }
});
export type PlatformAiConfig = z.infer<typeof PlatformAiConfigSchema>;
export type PlatformAiModel = z.infer<typeof PlatformAiModelSchema>;

export function quoteAiCredits(config: PlatformAiConfig, model: PlatformAiModel, inputTokens: number, outputTokens: number) {
  for (const count of [inputTokens, outputTokens]) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Contagem de tokens invalida.');
  }
  const exchange = config.costCurrency === 'USD' ? config.usdToBrl : 1;
  const inputBrl = inputTokens * model.inputCost * (1 + model.inputMarkup / 100) * exchange / 1_000_000;
  const outputBrl = outputTokens * model.outputCost * (1 + model.outputMarkup / 100) * exchange / 1_000_000;
  // Round once per provider call, preserving six decimal places of a credit.
  const microcredits = Math.ceil((inputBrl + outputBrl) / config.creditValueBrl * 1_000_000);
  if (!Number.isSafeInteger(microcredits)) throw new Error('Consumo excede o limite financeiro.');
  return microcredits / 1_000_000;
}
