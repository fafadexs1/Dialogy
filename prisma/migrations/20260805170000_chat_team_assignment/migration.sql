-- O chat nunca guardou para qual equipe foi transferido.
--
-- Cada consulta deduzia a equipe a partir de `team_members` do agente
-- responsavel, pegando a primeira em ordem alfabetica. Com o agente em mais de
-- uma equipe, a etiqueta da lista mostrava a equipe errada — e a cor errada.
-- Pior: o broadcast em tempo real deduzia com uma regra ligeiramente diferente
-- da consulta de listagem (ele considerava tambem a equipe do atendente de IA),
-- entao a etiqueta mudava sozinha ao alternar entre "todos" e "minhas", que era
-- justamente o que forcava um refetch.
--
-- A equipe passa a ser um fato gravado na transferencia, nao um palpite feito
-- em cada leitura.

ALTER TABLE IF EXISTS public.chats
  ADD COLUMN IF NOT EXISTS team_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chats_team_id_fkey'
  ) THEN
    ALTER TABLE public.chats
      ADD CONSTRAINT chats_team_id_fkey
      FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_chats_workspace_team
  ON public.chats(workspace_id, team_id)
  WHERE team_id IS NOT NULL;

-- Backfill unico dos atendimentos abertos, usando a mesma deducao antiga. Nao e
-- uma correcao retroativa (a equipe historica real nao existe em lugar nenhum);
-- e o congelamento do palpite, para que a etiqueta pare de mudar sozinha entre
-- uma leitura e outra a partir de agora.
UPDATE public.chats c
SET team_id = (
  SELECT tm.team_id
  FROM public.team_members tm
  JOIN public.teams t
    ON t.id = tm.team_id
   AND t.workspace_id = c.workspace_id
  WHERE tm.user_id = c.agent_id
  ORDER BY t.name ASC, t.id ASC
  LIMIT 1
)
WHERE c.team_id IS NULL
  AND c.agent_id IS NOT NULL
  AND c.status <> 'encerrados';
