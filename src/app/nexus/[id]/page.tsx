import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Compatibilidade para favoritos antigos: agentes agora pertencem ao Estúdio de IA.
 * O editor visual do fluxo comum continua exclusivamente em /nexus/flows/[id].
 */
export default async function LegacyNexusAgentRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/autopilot/${encodeURIComponent(id)}`);
}
