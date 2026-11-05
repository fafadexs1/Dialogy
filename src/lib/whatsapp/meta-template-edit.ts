import type { StudioTemplate } from './studio';

export type MetaEditField = { key: string; label: string; value: string; max: number };
const allowed = new Set(['HEADER', 'BODY', 'FOOTER', 'BUTTONS', 'CAROUSEL']);
const buttonTypes = new Set(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']);

/** Only expose fields we can safely round-trip without losing provider data. */
export function metaTemplateEditFields(template: StudioTemplate): MetaEditField[] {
  if (!template.id || !/^\d+$/.test(template.id)) throw new Error('A Meta não informou o identificador deste template.');
  if (template.category === 'AUTHENTICATION') throw new Error('Templates de autenticação usam campos especiais e não podem ser editados neste editor.');
  const fields: MetaEditField[] = [];
  const componentFields = (items: Record<string, unknown>[], prefix: string) => {
    for (const [index, item] of items.entries()) {
      const type = String(item.type || '');
      if (!allowed.has(type) || (prefix && type === 'CAROUSEL')) throw new Error('Este template contém componentes especiais que ainda não podem ser editados com segurança.');
      if (type === 'HEADER' && item.format !== 'TEXT') continue;
      if (['HEADER', 'BODY', 'FOOTER'].includes(type)) {
        if (typeof item.text !== 'string') throw new Error('A Meta não retornou o texto completo deste template.');
        fields.push({ key: `${prefix}${index}.text`, label: prefix ? `Cartão ${Number(prefix.split('.')[2]) + 1} · texto` : type === 'HEADER' ? 'Cabeçalho' : type === 'FOOTER' ? 'Rodapé' : 'Mensagem', value: item.text, max: type === 'BODY' ? 1024 : 60 });
      }
      if (type === 'BUTTONS') {
        if (!Array.isArray(item.buttons)) throw new Error('A Meta não retornou os botões deste template.');
        for (const [buttonIndex, raw] of item.buttons.entries()) {
          if (!raw || typeof raw !== 'object' || !buttonTypes.has(String(raw.type)) || typeof raw.text !== 'string') throw new Error('Este template contém botões especiais que ainda não podem ser editados com segurança.');
          fields.push({ key: `${prefix}${index}.buttons.${buttonIndex}.text`, label: `${prefix ? `Cartão ${Number(prefix.split('.')[2]) + 1} · ` : ''}Botão ${buttonIndex + 1}`, value: raw.text, max: 25 });
          if (raw.type === 'URL' && typeof raw.url === 'string') fields.push({ key: `${prefix}${index}.buttons.${buttonIndex}.url`, label: `Botão ${buttonIndex + 1} · link`, value: raw.url, max: 2000 });
          if (raw.type === 'PHONE_NUMBER' && typeof raw.phone_number === 'string') fields.push({ key: `${prefix}${index}.buttons.${buttonIndex}.phone_number`, label: `Botão ${buttonIndex + 1} · telefone`, value: raw.phone_number, max: 32 });
        }
      }
      if (type === 'CAROUSEL') {
        if (!Array.isArray(item.cards)) throw new Error('A Meta não retornou os cartões deste template.');
        for (const [cardIndex, card] of item.cards.entries()) {
          if (!card || typeof card !== 'object' || !Array.isArray(card.components)) throw new Error('A Meta não retornou todos os cartões deste template.');
          componentFields(card.components, `${index}.cards.${cardIndex}.components.`);
        }
      }
    }
  };
  componentFields(template.components, '');
  if (!fields.some(field => field.key.endsWith('.text') && field.label === 'Mensagem')) throw new Error('Este template não possui uma mensagem editável.');
  return fields;
}
function variables(value: string) { return [...value.matchAll(/\{\{[^{}]+\}\}/g)].map(match => match[0]).sort(); }
export function applyMetaTemplateEdits(template: StudioTemplate, updates: Record<string, string>) {
  const fields = metaTemplateEditFields(template);
  if (Object.keys(updates).some(key => !fields.some(field => field.key === key))) throw new Error('Um campo não pertence a este template.');
  const components = structuredClone(template.components);
  let changed = false;
  for (const field of fields) {
    if (!(field.key in updates)) continue;
    const value = updates[field.key];
    if (value === field.value) continue;
    if (typeof value !== 'string' || !value.trim() || value.length > field.max) throw new Error(`Revise o campo ${field.label}.`);
    if (JSON.stringify(variables(value)) !== JSON.stringify(variables(field.value))) throw new Error(`Mantenha os campos de personalização originais em ${field.label}.`);
    if (field.key.endsWith('.url')) {
      try { const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); }
      catch { throw new Error(`Informe um link http ou https válido em ${field.label}.`); }
    }
    if (field.key.endsWith('.phone_number') && !/^\+?[0-9 ()-]{5,32}$/.test(value)) throw new Error(`Informe um telefone válido em ${field.label}.`);
    const segments = field.key.split('.');
    let target: any = components;
    for (const segment of segments.slice(0, -1)) target = target[segment];
    target[segments[segments.length - 1]] = value;
    changed = true;
  }
  if (!changed) throw new Error('Faça uma alteração antes de enviar para a Meta.');
  return components;
}
