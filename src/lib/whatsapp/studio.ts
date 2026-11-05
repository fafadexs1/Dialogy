import { z } from 'zod';

export const STUDIO_MAX_CARDS = 10;
export const STUDIO_IMAGE_LIMIT = 5 * 1024 * 1024;
export const STUDIO_LANGUAGES = [
  { value: 'pt_BR', label: 'Português (Brasil)' },
  { value: 'en_US', label: 'Inglês' },
  { value: 'es_ES', label: 'Espanhol' },
] as const;
const text = (max: number) => z.string().max(max);
const buttonSchema = z.object({
  id: text(100),
  type: z.enum(['reply', 'url', 'phone']),
  text: text(25),
  value: text(2048),
});
const cardSchema = z.object({
  id: text(100),
  title: text(80),
  body: text(900),
  imageKey: text(500),
  buttons: z.array(buttonSchema).max(3),
});
export const studioDraftSchema = z.object({
  version: z.literal(1),
  kind: z.enum(['message', 'carousel']),
  title: text(100),
  templateName: text(512),
  category: z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']),
  language: z.enum(['pt_BR', 'en_US', 'es_ES']),
  body: text(1024),
  examples: z.record(z.string().regex(/^\d+$/), text(100)),
  variableLabels: z.record(z.string().regex(/^\d+$/), text(50)).default({}),
  authenticationCode: text(15).default('123456'),
  header: text(60),
  headerImageKey: text(500),
  footer: text(60),
  buttons: z.array(buttonSchema).max(3),
  cards: z.array(cardSchema).max(STUDIO_MAX_CARDS),
});
export type StudioDraft = z.infer<typeof studioDraftSchema>;
export type StudioButton = StudioDraft['buttons'][number];
export type StudioCard = StudioDraft['cards'][number];
export type StudioLibraryEntry = {
  id: string;
  instance_id: string | null;
  title: string;
  draft: StudioDraft;
  revision: number;
  provider_name: string | null;
  publication_matches: boolean;
  updated_at: string;
};
export type StudioTemplate = {
  id?: string;
  name: string;
  status: string;
  language: string;
  category: string;
  components: Record<string, unknown>[];
  rejection?: string;
};

export function templateSlug(title: string) {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}
export function createStudioCard(id: string): StudioCard {
  return {
    id,
    title: '',
    body: '',
    imageKey: '',
    buttons: [
      { id: `${id}-reply`, type: 'reply', text: 'Tenho interesse', value: '' },
    ],
  };
}
export function createStudioDraft(
  kind: StudioDraft['kind'] = 'message',
): StudioDraft {
  return {
    version: 1,
    kind,
    title: '',
    templateName: '',
    category: kind === 'carousel' ? 'MARKETING' : 'UTILITY',
    language: 'pt_BR',
    body: '',
    examples: {},
    variableLabels: {},
    authenticationCode: '123456',
    header: '',
    headerImageKey: '',
    footer: '',
    buttons: [],
    cards:
      kind === 'carousel'
        ? [createStudioCard('card-1'), createStudioCard('card-2')]
        : [],
  };
}
export const studioStarters = [
  {
    id: 'order',
    title: 'Atualização de pedido',
    description: 'Uma boa notícia, na hora certa.',
    kind: 'message' as const,
    body: 'Olá {{1}}! Seu pedido {{2}} foi confirmado. Assim que houver uma novidade, avisaremos por aqui.',
    examples: { '1': 'Marina', '2': '12345' },
    category: 'UTILITY' as const,
  },
  {
    id: 'appointment',
    title: 'Lembrete de agendamento',
    description: 'Cuidado que começa antes do encontro.',
    kind: 'message' as const,
    body: 'Olá {{1}}! Seu atendimento está agendado para {{2}}. Podemos confirmar sua presença?',
    examples: { '1': 'Marina', '2': 'amanhã, às 14h' },
    category: 'UTILITY' as const,
  },
  {
    id: 'collection',
    title: 'Uma coleção de possibilidades',
    description: 'Produtos, serviços ou planos em cartões.',
    kind: 'carousel' as const,
    body: 'Selecionamos algumas opções que podem combinar com você. Deslize para conhecer cada uma!',
    examples: {},
    category: 'MARKETING' as const,
  },
] as const;
export function getBodyVariables(body: string): number[] {
  return [
    ...new Set(
      [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])),
    ),
  ].sort((a, b) => a - b);
}
export function previewBody(draft: StudioDraft): string {
  return draft.body.replace(
    /\{\{(\d+)\}\}/g,
    (match, position: string) => draft.examples[position] || match,
  );
}

/** Turn Meta's named or positional fields into the studio's numbered, labelled editor fields. */
export function importStudioBody(component?: Record<string, unknown>) {
  const source = String(component?.text || '');
  const example = component?.example as
    | {
        body_text?: unknown[][];
        body_text_named_params?: { param_name: string; example: unknown }[];
      }
    | undefined;
  const samples = example?.body_text?.[0] || [];
  const named = Array.isArray(example?.body_text_named_params)
    ? example.body_text_named_params
    : [];
  const fields = [
    ...new Set(
      [...source.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*|\d+)\}\}/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  const hasNamed = fields.some((field) => !/^\d+$/.test(field));
  const examples: Record<string, string> = {};
  const variableLabels: Record<string, string> = {};
  fields.forEach((field, index) => {
    const position = hasNamed ? String(index + 1) : field;
    const sample = /^\d+$/.test(field)
      ? samples[Number(field) - 1]
      : named.find((item) => item.param_name === field)?.example;
    examples[position] = String(sample ?? '').slice(0, 100);
    if (!/^\d+$/.test(field))
      variableLabels[position] = field.replace(/_/g, ' ').slice(0, 50);
  });
  const body = hasNamed
    ? source.replace(
        /\{\{([a-zA-Z_][a-zA-Z0-9_]*|\d+)\}\}/g,
        (_match, field: string) => '{{' + (fields.indexOf(field) + 1) + '}}',
      )
    : source;
  return { body, examples, variableLabels };
}
export function studioImageUrl(key: string): string {
  return key ? `/api/storage/object?key=${encodeURIComponent(key)}` : '';
}
export function studioScrollBehavior(): ScrollBehavior {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}
export function assertStudioImageKey(key: string, workspaceId: string) {
  if (
    !key.startsWith(`workspaces/${workspaceId}/whatsapp-studio/`) ||
    !/^workspaces\/[0-9a-f-]{36}\/whatsapp-studio\/[0-9a-f-]{36}\.jpg$/i.test(
      key,
    )
  )
    throw new Error(
      'A imagem não pertence a este workspace. Carregue a foto novamente.',
    );
}
export function validateStudioDraft(
  draft: StudioDraft,
  official: boolean,
): string[] {
  const errors: string[] = [];
  if (!draft.title.trim())
    errors.push('Dê um nome para encontrar esta criação depois.');
  if (official && !/^[a-z0-9_]+$/.test(draft.templateName))
    errors.push(
      'O nome de registro deve ter apenas letras minúsculas, números e sublinhados.',
    );
  if (draft.category === 'AUTHENTICATION') {
    if (!official)
      errors.push('Códigos de autenticação precisam de uma conexão oficial.');
    if (draft.kind !== 'message')
      errors.push('Um código de autenticação não pode ser um carrossel.');
    if (!draft.authenticationCode.trim())
      errors.push(
        'Preencha um código de exemplo para experimentar o template.',
      );
    return errors;
  }
  if (!draft.body.trim())
    errors.push('Escreva a mensagem que vai iniciar a conversa.');
  const variables = getBodyVariables(draft.body);
  if (/\{\{[^}]*\}\}/.test(draft.body.replace(/\{\{[1-9]\d*\}\}/g, '')))
    errors.push(
      'Use os campos de personalização para inserir variáveis válidas.',
    );
  if (official && variables.some((value, index) => value !== index + 1))
    errors.push(
      'As variáveis precisam seguir a sequência: {{1}}, {{2}}, {{3}}.',
    );
  for (const position of variables)
    if (!draft.examples[String(position)]?.trim())
      errors.push(`Preencha um exemplo para a personalização ${position}.`);
  if (
    official &&
    variables.length &&
    (/^\s*\{\{\d+\}\}/.test(draft.body) || /\{\{\d+\}\}\s*$/.test(draft.body))
  )
    errors.push('Inclua texto antes e depois das personalizações na mensagem.');
  const validateButtons = (buttons: StudioButton[], label: string) => {
    if (
      official &&
      buttons.filter((button) => button.type === 'phone').length > 1
    )
      errors.push(`${label}: use no máximo um botão de telefone.`);
    if (
      official &&
      buttons.filter((button) => button.type === 'url').length > 2
    )
      errors.push(`${label}: use no máximo dois botões de link.`);
    if (
      new Set(buttons.map((button) => button.text.trim().toLowerCase()))
        .size !== buttons.length
    )
      errors.push(`${label}: use textos diferentes para os botões.`);
    buttons.forEach((button, index) => {
      if (!button.text.trim())
        errors.push(`${label}: escreva o texto do botão ${index + 1}.`);
      if (button.type === 'url') {
        try {
          const url = new URL(button.value);
          if (url.protocol !== 'https:' || url.username || url.password)
            throw new Error();
        } catch {
          errors.push(
            `${label}: informe um link HTTPS válido para o botão ${index + 1}.`,
          );
        }
      }
      if (button.type === 'url' && /\{\{/.test(button.value))
        errors.push(
          `${label}: use um link completo, sem campos de personalização, no botão ${index + 1}.`,
        );
      if (
        button.type === 'phone' &&
        !/^\+?[1-9]\d{7,14}$/.test(button.value.replace(/[\s()-]/g, ''))
      )
        errors.push(`${label}: informe o telefone com código do país.`);
    });
  };
  if (draft.kind === 'carousel') {
    if (draft.cards.length < 2)
      errors.push('Adicione pelo menos dois cartões ao carrossel.');
    if (official && draft.category !== 'MARKETING')
      errors.push('O carrossel oficial precisa usar a categoria Marketing.');
    draft.cards.forEach((card, index) => {
      const label = `Cartão ${index + 1}`;
      if (!card.title.trim() || !card.body.trim())
        errors.push(`${label}: preencha o título e a descrição.`);
      if (!card.imageKey) errors.push(`${label}: carregue uma foto.`);
      if (!card.buttons.length)
        errors.push(`${label}: adicione pelo menos um botão.`);
      if (official && card.buttons.length > 2)
        errors.push(
          `${label}: o carrossel oficial aceita até dois botões por cartão.`,
        );
      if (/\{\{/.test(card.title + card.body))
        errors.push(
          `${label}: use as personalizações na mensagem de apresentação, não no cartão.`,
        );
      if (`${card.title}\n${card.body}`.length > 160 && official)
        errors.push(
          `${label}: título e descrição juntos devem ter até 160 caracteres.`,
        );
      if (
        official &&
        card.buttons.map((button) => button.type).join(',') !==
          draft.cards[0].buttons.map((button) => button.type).join(',')
      )
        errors.push(
          'Use os mesmos tipos de botão, na mesma ordem, em todos os cartões.',
        );
      validateButtons(card.buttons, label);
    });
  } else {
    if (/\{\{/.test(draft.header + draft.footer))
      errors.push('Use as personalizações no texto principal da mensagem.');
    validateButtons(draft.buttons, 'Mensagem');
  }
  return [...new Set(errors)];
}

function metaButtons(buttons: StudioButton[]) {
  return buttons.map((button) =>
    button.type === 'reply'
      ? { type: 'QUICK_REPLY', text: button.text.trim() }
      : button.type === 'url'
        ? { type: 'URL', text: button.text.trim(), url: button.value.trim() }
        : {
            type: 'PHONE_NUMBER',
            text: button.text.trim(),
            phone_number: button.value.replace(/[\s()-]/g, ''),
          },
  );
}
export function buildStudioTemplate(
  draft: StudioDraft,
  handles: Record<string, string>,
) {
  const errors = validateStudioDraft(draft, true);
  if (errors.length) throw new Error(errors[0]);
  if (draft.category === 'AUTHENTICATION')
    return {
      name: draft.templateName,
      category: 'AUTHENTICATION',
      language: draft.language,
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 10 },
        {
          type: 'BUTTONS',
          buttons: [
            {
              type: 'OTP',
              otp_type: 'COPY_CODE',
              text:
                draft.language === 'en_US'
                  ? 'Copy code'
                  : draft.language === 'es_ES'
                    ? 'Copiar código'
                    : 'Copiar código',
            },
          ],
        },
      ],
    };
  const body = {
    type: 'BODY',
    text: draft.body,
    ...(getBodyVariables(draft.body).length
      ? {
          example: {
            body_text: [
              getBodyVariables(draft.body).map(
                (position) => draft.examples[String(position)],
              ),
            ],
          },
        }
      : {}),
  };
  const imageHeader = (key: string) => {
    if (!handles[key])
      throw new Error(
        'Prepare a imagem novamente antes de enviar para aprovação.',
      );
    return {
      type: 'HEADER',
      format: 'IMAGE',
      example: { header_handle: [handles[key]] },
    };
  };
  const components: Record<string, unknown>[] = [];
  if (draft.kind === 'message') {
    if (draft.headerImageKey)
      components.push(imageHeader(draft.headerImageKey));
    else if (draft.header.trim())
      components.push({ type: 'HEADER', format: 'TEXT', text: draft.header });
  }
  components.push(body);
  if (draft.kind === 'carousel')
    components.push({
      type: 'CAROUSEL',
      cards: draft.cards.map((card) => ({
        components: [
          imageHeader(card.imageKey),
          { type: 'BODY', text: `${card.title}\n${card.body}` },
          { type: 'BUTTONS', buttons: metaButtons(card.buttons) },
        ],
      })),
    });
  else {
    if (draft.footer.trim())
      components.push({ type: 'FOOTER', text: draft.footer });
    if (draft.buttons.length)
      components.push({ type: 'BUTTONS', buttons: metaButtons(draft.buttons) });
  }
  return {
    name: draft.templateName,
    category: draft.category,
    language: draft.language,
    components,
  };
}
export function normalizeStudioTemplates(value: unknown): StudioTemplate[] {
  const payload = value as { data?: unknown; templates?: unknown } | null;
  const list = Array.isArray(value)
    ? value
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.templates)
        ? payload.templates
        : [];
  return list
    .filter(
      (item) =>
        item && typeof item === 'object' && typeof item.name === 'string',
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      status: String(item.status || 'UNKNOWN'),
      language: String(item.language || 'pt_BR'),
      category: String(item.category || 'UTILITY'),
      components: Array.isArray(item.components) ? item.components : [],
      rejection: item.rejected_reason || item.rejection_reason,
    }));
}
