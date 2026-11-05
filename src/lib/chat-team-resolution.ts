/**
 * Resolução da equipe de um atendimento — uma definição, usada por todas as
 * leituras.
 *
 * Existia uma cópia desta lateral em cinco consultas de `actions/chats.ts` e uma
 * sexta, divergente, no broadcast em tempo real. Todas deduziam a equipe a
 * partir de `team_members` do agente, e a do broadcast ainda considerava a
 * equipe do atendente de IA. O resultado aparecia na interface como etiqueta
 * trocando de nome e de cor conforme a origem do dado — realtime dizia uma
 * coisa, o refetch do filtro dizia outra.
 *
 * Agora a fonte primária é `chats.team_id`, gravado na transferência. A dedução
 * antiga sobrevive apenas como fallback para linhas anteriores à coluna.
 */
export function buildChatTeamLateralSql(options: {
  /** Alias da tabela `chats` na consulta externa. */
  chatAlias: string;
  /** Alias que a lateral recebe (as consultas existentes usam `t`). */
  alias?: string;
}): string {
  const chat = options.chatAlias;
  const alias = options.alias ?? 't';

  return `LEFT JOIN LATERAL (
            SELECT t.id, t.name, t.color
            FROM teams t
            WHERE t.workspace_id = ${chat}.workspace_id
              AND t.id = COALESCE(
                ${chat}.team_id,
                (
                  SELECT tm.team_id
                  FROM team_members tm
                  JOIN teams legacy_team
                    ON legacy_team.id = tm.team_id
                   AND legacy_team.workspace_id = ${chat}.workspace_id
                  WHERE tm.user_id = ${chat}.agent_id
                  ORDER BY legacy_team.name ASC, legacy_team.id ASC
                  LIMIT 1
                )
              )
            LIMIT 1
        ) ${alias} ON true`;
}
