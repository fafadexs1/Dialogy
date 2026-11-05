import { describe, expect, it } from 'vitest';
import {
  assertStudioImageKey,
  buildStudioTemplate,
  createStudioDraft,
  getBodyVariables,
  importStudioBody,
  normalizeStudioTemplates,
  previewBody,
  studioDraftSchema,
  templateSlug,
  validateStudioDraft,
} from '@/lib/whatsapp/studio';

const workspace = '10000000-0000-4000-8000-000000000001';
function carousel() {
  const draft = createStudioDraft('carousel');
  draft.title = 'Coleção com cuidado';
  draft.templateName = templateSlug(draft.title);
  draft.body = 'Olá {{1}}! Conheça nossas novidades.';
  draft.examples = { '1': 'Marina' };
  draft.cards = draft.cards.map((card, index) => ({
    ...card,
    title: 'Opção ' + (index + 1),
    body: 'Um detalhe que faz a diferença.',
    imageKey:
      'workspaces/' +
      workspace +
      '/whatsapp-studio/30000000-0000-4000-8000-00000000000' +
      (index + 1) +
      '.jpg',
  }));
  return draft;
}
describe('WhatsApp visual studio contracts', () => {
  it('imports named Meta variables with their samples and keeps repeated fields linked', () => {
    const imported = importStudioBody({
      text: 'Olá {{nome_cliente}}! O pedido {{pedido}} está pronto. Obrigado, {{nome_cliente}}.',
      example: {
        body_text_named_params: [
          { param_name: 'nome_cliente', example: 'Marina' },
          { param_name: 'pedido', example: '12345' },
        ],
      },
    });
    expect(imported).toEqual({
      body: 'Olá {{1}}! O pedido {{2}} está pronto. Obrigado, {{1}}.',
      examples: { '1': 'Marina', '2': '12345' },
      variableLabels: { '1': 'nome cliente', '2': 'pedido' },
    });
    expect(
      importStudioBody({
        text: 'Olá {{1}}, pedido {{2}}.',
        example: { body_text: [['Marina', '12345']] },
      }).examples,
    ).toEqual({ '1': 'Marina', '2': '12345' });
  });
  it('builds a native Meta carousel using media handles, uniform buttons and friendly body examples', () => {
    const draft = carousel();
    const payload = buildStudioTemplate(
      draft,
      Object.fromEntries(
        draft.cards.map((card, index) => [
          card.imageKey,
          'meta-handle-' + index,
        ]),
      ),
    );
    expect(payload).toMatchObject({
      name: 'colecao_com_cuidado',
      category: 'MARKETING',
      language: 'pt_BR',
      components: [
        {
          type: 'BODY',
          text: draft.body,
          example: { body_text: [['Marina']] },
        },
        {
          type: 'CAROUSEL',
          cards: [
            {
              components: [
                {
                  type: 'HEADER',
                  format: 'IMAGE',
                  example: { header_handle: ['meta-handle-0'] },
                },
                {
                  type: 'BODY',
                  text: 'Opção 1\nUm detalhe que faz a diferença.',
                },
                {
                  type: 'BUTTONS',
                  buttons: [{ type: 'QUICK_REPLY', text: 'Tenho interesse' }],
                },
              ],
            },
            {
              components: [
                {
                  type: 'HEADER',
                  example: { header_handle: ['meta-handle-1'] },
                },
                { type: 'BODY' },
                { type: 'BUTTONS' },
              ],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain(workspace);
    expect(() => buildStudioTemplate(draft, {})).toThrow('imagem');
  });
  it('reports missing photos, malformed destinations and inconsistent official card layouts', () => {
    const draft = carousel();
    draft.cards[0].imageKey = '';
    draft.cards[1].buttons[0] = {
      ...draft.cards[1].buttons[0],
      type: 'url',
      value: 'javascript:alert(1)',
    };
    const errors = validateStudioDraft(draft, true).join(' ');
    expect(errors).toContain('carregue uma foto');
    expect(errors).toContain('HTTPS válido');
    expect(errors).toContain('mesmos tipos de botão');
    expect(validateStudioDraft(draft, false).join(' ')).not.toContain(
      'mesmos tipos de botão',
    );
  });
  it('allows three native buttons and longer QR descriptions while guarding official limits', () => {
    const draft = carousel();
    draft.cards.forEach((card) => {
      card.body = 'Descrição '.repeat(30);
      card.buttons = [0, 1, 2].map((index) => ({
        id: card.id + index,
        type: 'reply',
        text: 'Opção ' + index,
        value: '',
      }));
    });
    expect(studioDraftSchema.safeParse(draft).success).toBe(true);
    expect(validateStudioDraft(draft, false)).toEqual([]);
    expect(validateStudioDraft(draft, true).join(' ')).toContain('dois botões');
    expect(validateStudioDraft(draft, true).join(' ')).toContain(
      '160 caracteres',
    );
    expect(
      studioDraftSchema.safeParse({
        ...draft,
        cards: Array(11).fill(draft.cards[0]),
      }).success,
    ).toBe(false);
  });
  it('orders positional variables, fills previews and rejects missing samples or invalid numbering', () => {
    const draft = carousel();
    draft.body = 'Olá {{1}}, seu pedido {{3}} está pronto.';
    expect(getBodyVariables(draft.body)).toEqual([1, 3]);
    expect(previewBody(draft)).toBe(
      'Olá Marina, seu pedido {{3}} está pronto.',
    );
    const errors = validateStudioDraft(draft, true).join(' ');
    expect(errors).toContain('sequência');
    expect(errors).toContain('personalização 3');
    draft.body = '{{1}}';
    expect(validateStudioDraft(draft, true).join(' ')).toContain(
      'texto antes e depois',
    );
  });
  it('requires workspace-owned image keys and rejects traversal or another workspace', () => {
    const key = carousel().cards[0].imageKey;
    expect(() => assertStudioImageKey(key, workspace)).not.toThrow();
    expect(() =>
      assertStudioImageKey(key, '20000000-0000-4000-8000-000000000001'),
    ).toThrow('workspace');
    expect(() =>
      assertStudioImageKey(
        'workspaces/' + workspace + '/whatsapp-studio/../secret.jpg',
        workspace,
      ),
    ).toThrow();
  });
  it('uses the actual OTP template contract and normalizes supported provider envelopes', () => {
    const draft = createStudioDraft();
    draft.title = 'Código de acesso';
    draft.templateName = 'codigo_de_acesso';
    draft.category = 'AUTHENTICATION';
    expect(buildStudioTemplate(draft, {})).toMatchObject({
      category: 'AUTHENTICATION',
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 10 },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
      ],
    });
    expect(validateStudioDraft(draft, false).join(' ')).toContain(
      'conexão oficial',
    );
    expect(
      normalizeStudioTemplates({
        data: [
          { name: 'example', status: 'APPROVED', components: [] },
          { malformed: true },
        ],
      }),
    ).toHaveLength(1);
    expect(normalizeStudioTemplates({ error: true })).toEqual([]);
  });
});
