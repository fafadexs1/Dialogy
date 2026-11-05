/**
 * Atualiza o pathname do chat selecionado sem recarregar a página.
 *
 * O App Router intercepta `window.history.replaceState` para manter o pathname e
 * o estado interno da rota sincronizados. Não devemos chamar o método do
 * prototype diretamente: isso pula a integração do Next.js e remove os dados
 * privados usados nas próximas navegações/revalidações.
 */
export function replaceChatPath(chatId?: string | null) {
  if (typeof window === 'undefined') return;

  const segments = window.location.pathname.split('/').filter(Boolean);
  const inboxIndex = segments.indexOf('inbox');
  const baseSegments = inboxIndex === -1 ? ['inbox'] : segments.slice(0, inboxIndex + 1);
  const basePath = `/${baseSegments.join('/')}`;
  const nextPathname = chatId ? `${basePath}/${chatId}` : basePath;

  if (window.location.pathname === nextPathname) {
    return;
  }

  const search = window.location.search || '';
  const hash = window.location.hash || '';
  const nextUrl = `${nextPathname}${search}${hash}`;

  window.history.replaceState(null, '', nextUrl);
}

export function resolveHydratedChatSelection(
  serverSelectedChatId: string | null,
  clientSelectedChatId: string | null,
  preserveClientSelection: boolean,
) {
  return preserveClientSelection ? clientSelectedChatId : serverSelectedChatId;
}
