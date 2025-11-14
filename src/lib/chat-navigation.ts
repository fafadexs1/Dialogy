/**
 * Atualiza o pathname do chat selecionado sem disparar uma navegação do Next.js.
 * Mantemos a lógica isolada para evitar regressões quando a tela principal é editada.
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

  const historyProto = Object.getPrototypeOf(window.history);
  const nativeReplaceState = historyProto?.replaceState?.bind(window.history);

  if (nativeReplaceState) {
    nativeReplaceState({ chatId }, '', nextUrl);
  } else {
    window.history.replaceState({ chatId }, '', nextUrl);
  }
}
