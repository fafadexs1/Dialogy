import { fetchEvolutionAPI, type EvolutionApiClientConfig } from '@/lib/whatsapp/evolution-api-client';
import { preserveWhatsappRecipient } from '@/lib/whatsapp/bsuid';
import { whatsappCatalogSchema, type WhatsappCatalog } from '@/lib/whatsapp/catalog';
import { requireProviderMessageId } from './template-send-contract';

export async function sendCatalogMessage(
  apiConfig: EvolutionApiClientConfig,
  instanceName: string,
  number: string,
  input: WhatsappCatalog,
): Promise<string> {
  const catalog = whatsappCatalogSchema.parse(input);
  const recipient = preserveWhatsappRecipient(number);
  if (!recipient) throw new Error('Contato sem número de WhatsApp válido.');

  const response = await fetchEvolutionAPI(`/message/sendCarousel/${encodeURIComponent(instanceName)}`, apiConfig, {
    method: 'POST',
    body: JSON.stringify({
      number: recipient,
      body: catalog.body,
      // Evolution's carousel renderer reads body, not title.
      cards: catalog.cards.map((card) => ({ ...card, body: `*${card.title}*\n\n${card.body}` })),
    }),
  });
  return requireProviderMessageId(response);
}
