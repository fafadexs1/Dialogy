# Estúdio de Agentes de IA — implantação, operação e reversão

Este runbook cobre somente o Estúdio vertical de Agentes de IA. Ele não altera nem substitui o editor visual do fluxo normal.

## 1. Pré-implantação

1. Gere um backup verificável do PostgreSQL e registre o ponto de restauração.
2. Confirme que `WORKSPACE_CREDENTIALS_ENCRYPTION_KEY` está configurada com o mesmo valor em web e workers. Não rotacione essa chave durante o rollout.
3. Execute a auditoria de migrações e revise divergências antes de aplicar qualquer SQL.
4. Aplique `20260827130000_agent_studio_session_history` em homologação. Verifique as tabelas de sessões e revogações, seus índices, RLS, grants e triggers.
5. Rode a suíte do Estúdio, o typecheck e o build com o mesmo conjunto de variáveis da implantação.
6. Mantenha `AGENT_STUDIO_RETENTION_ENABLED=false` até confirmar consultas, métricas e restauração em homologação.

## 2. Aceite em homologação

- Crie um agente de teste sem ativá-lo. Configure coleta, API, MCP, conhecimento, regras e transferência.
- Use apenas as respostas fictícias da prévia. Ela não deve chamar integrações reais.
- Publique uma versão e confirme que novas conversas usam o Estúdio sem passar pelo canvas legado.
- Insira essa versão no bloco de agente do fluxo normal e valide entrada, espera, retomada, saída, cancelamento e erro. O visual do fluxo normal deve permanecer inalterado.
- Publique uma segunda versão. Confirme que sessões iniciadas na primeira continuam fixadas nela e que novas sessões usam a segunda.
- Revogue uma fonte e confirme que somente ela deixa de ser consultada. Revogue uma versão de teste e confirme o bloqueio também no fluxo normal.
- Execute “Voltar ao modo anterior”. Confirme que novas conversas voltam ao runtime legado, sessões já iniciadas terminam na versão fixada e o rascunho do Estúdio continua disponível.

## 3. Ativação gradual

1. Escolha um workspace interno e um agente sem tráfego crítico.
2. Publique fora do horário de pico e acompanhe por pelo menos um ciclo operacional.
3. Amplie por workspace/agente; não faça troca global automática.
4. Depois de validar a retenção manualmente, habilite no worker:
   - `AGENT_STUDIO_RETENTION_ENABLED=true`
   - `AGENT_STUDIO_HISTORY_RETENTION_DAYS=90` (intervalo aceito: 7–3650)
   - `AGENT_STUDIO_RETENTION_INTERVAL_MS=86400000`

O job usa advisory lock, não remove sessões ativas ou com resultado incerto e só limpa metadados terminais correspondentes.

## 4. Sinais e alertas mínimos

Consultar a cada 5 minutos:

```sql
SELECT status, count(*)
FROM agent_studio_sessions
WHERE started_at >= now() - interval '15 minutes'
GROUP BY status;
```

Alertar quando a proporção `failed / total` ultrapassar 5% com pelo menos 20 sessões. Alertar imediatamente se houver resultado incerto sem revisão por mais de 15 minutos:

```sql
SELECT id, workspace_id, agent_id, release_id, updated_at
FROM agent_studio_sessions
WHERE COALESCE((summary->>'outcomeUnknown')::boolean, false)
  AND updated_at < now() - interval '15 minutes';
```

Também alertar para `[AGENT_STUDIO_RETENTION] Ciclo falhou`, aumento de transferências, erro de versão revogada e falha de descriptografia. Logs e métricas nunca devem incluir valores coletados do cliente.

## 5. Resposta a incidente

- Fonte incorreta: revogue a fonte na aba Resultados, corrija o rascunho e publique uma nova versão.
- Release insegura: revogue a versão inteira. Isso interrompe novas execuções e execuções fixadas no fluxo normal sem apagar evidência.
- Resultado externo incerto: não repita a ação. Na sessão, registre se a equipe confirmou que ocorreu ou não ocorreu.
- Falha generalizada do novo runtime: use “Voltar ao modo anterior”. Essa operação é versionada e preserva releases e rascunho.
- Chave de criptografia ausente/incorreta: pare novas publicações e restaure a chave correta. Não apague estados que não podem ser abertos.

## 6. Rollback da aplicação

O rollback de código deve manter a migração de banco: as tabelas e colunas são aditivas e releases são imutáveis. Reverter o SQL apagaria histórico e não faz parte do procedimento normal. Volte a imagem da aplicação, mantenha o worker de retenção desabilitado e use a reversão por agente quando necessário.

## 7. Critério de encerramento

O rollout só termina após: zero resultado incerto sem dono, taxa de falha dentro do limite acordado, comparação visual comprovando que o fluxo normal não mudou, restauração testada e responsável operacional identificado.
