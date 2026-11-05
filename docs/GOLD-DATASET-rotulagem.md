# Dataset ouro: guia de rotulagem

Parte da Fase 0 do `docs/PLAN-ia-autonoma-transferir-encerrar.md`. O objetivo é medir, com conversas reais, quando a IA **deveria** continuar, transferir ou encerrar.

## Arquivos

`npx tsx scripts/export-gold-candidates.ts --export --confirm-sensitive --per-stratum=50` grava em `.gold-dataset/` (ignorada pelo git):

| Arquivo | Conversas reais de onde veio |
|---|---|
| `transferred.jsonl` | Chats que passaram por transferência |
| `closed_under_60s_after_customer.jsonl` | Encerrados menos de 60 s depois da última mensagem do cliente |
| `closed_other.jsonl` | Demais encerrados |
| `closed_by_system_agent.jsonl` | Encerrados por agente de sistema (quase não há) |

Cada linha é uma conversa: `conversationId` anônimo, `stratum`, `weakLabel` (o que aconteceu de fato), `turns[]` e um campo `gold` para você preencher.

**Cuidado com os dados.** O texto passa por mascaramento de CPF, CNPJ, telefone, e-mail, CEP, links, códigos longos (Pix, boleto, tokens) e o nome do contato. **Não é anonimização completa**: endereços, nomes de terceiros e detalhes livres continuam. Trate como dado sensível, compartilhe só com quem rotula e apague quando acabar. Se achar um dado pessoal sem máscara, anote o `conversationId` em `gold.note` e avise.

## O que rotular

Para cada turno com `role: "customer"`, responda: **o que um atendente automático ideal faria agora, depois dessa mensagem?**

| `decision` | Quando |
|---|---|
| `continue` | Responder, perguntar ou consultar algo e seguir conversando. É o padrão. |
| `handoff` | Passar para uma pessoa agora. Preencha `reason`. |
| `close` | Encerrar o atendimento agora. Preencha `closeBasis`. |

Preencha `gold.decisions` só nas **exceções ao `continue`**; turno sem registro conta como `continue`.

```json
"gold": {
  "rater": "ana",
  "decisions": [
    { "turn": 12, "decision": "handoff", "reason": "cliente_pediu" },
    { "turn": 20, "decision": "close", "closeBasis": "cliente_confirmou" }
  ],
  "note": ""
}
```

`turn` é o `idx` do turno do cliente em `turns`.

### Motivos de `handoff` (lista fechada)

| `reason` | Use quando |
|---|---|
| `cliente_pediu` | O cliente pede uma pessoa, de forma direta ou indireta. |
| `fora_de_escopo` | O assunto não é algo que a IA deve resolver (jurídico, negociação fora da regra, exceção). |
| `risco_sensivel` | Fraude, ameaça, dado sensível, decisão financeira de alto valor. |
| `falha_de_ferramenta` | A consulta ou ação necessária não funciona ou não responde. |
| `incerteza_alta` | Depois de 1 pergunta de esclarecimento, a IA ainda não sabe o que o cliente quer. |
| `limite_de_turnos` | A conversa se arrasta sem progresso. |
| `operacao_incerta` | Uma ação com efeito externo ficou sem confirmação e precisa de conferência. |
| `reclamacao_grave` | Cliente muito insatisfeito ou ameaçando cancelar. |

### Base de `close`

| `closeBasis` | Use quando |
|---|---|
| `cliente_confirmou` | O cliente disse que acabou ("era só isso", "pode fechar", despedida clara) e não há pendência. |
| `resolucao_comprovada` | O pedido foi resolvido com resultado visível e o cliente não tem mais nada aberto. |
| `inatividade_pos_followup` | O cliente sumiu **depois** de o atendente avisar e esperar um tempo razoável. |

## Regras de decisão

1. **Na dúvida entre `continue` e `close`, é `continue`.** Encerrar cedo demais é o erro mais caro: o cliente volta e conta de novo.
2. **"Obrigado" sozinho não é encerramento** se a resposta anterior deixou uma pergunta ou um passo em aberto.
3. **Pedido de humano vence tudo.** Mesmo com a IA conseguindo resolver, marque `handoff` / `cliente_pediu` no turno do pedido.
4. **Julgue pela informação que o atendente tinha naquele ponto**, não pelo que aconteceu depois. O `weakLabel` mostra o que o humano fez, que pode estar errado: é a hipótese, não a resposta.
5. **Não rotule turnos depois do `close` ou do `handoff`.**
6. **Mídia (`[MIDIA:audio]` etc.)**: se o conteúdo é essencial e não dá para saber o que foi dito, não force `handoff`; use `continue` e escreva em `gold.note` que faltava o conteúdo.
7. **Mensagens de `role: "system"`** (transferência, encerramento) mostram o que o sistema fez; não são do cliente.

## Duas pessoas por conversa

Cada conversa precisa de **duas pessoas independentes**. Copie `.gold-dataset/` para uma pasta por pessoa (`rater-a/`, `rater-b/`) e preencha só o `gold` do seu arquivo. Depois:

```bash
node scripts/gold-agreement.cjs rater-a/transferred.jsonl rater-b/transferred.jsonl
```

O script mostra a concordância e o kappa de Cohen por decisão e lista as conversas em que divergiram (só ids, sem texto). Divergências vão para uma terceira pessoa decidir. Kappa abaixo de 0,6 indica que este guia precisa de ajuste antes de seguir.

## Depois da rotulagem

O arquivo final vira a entrada do replay offline (Fase 0, passo 3 do plano): o núcleo decide turno a turno sobre as conversas e se compara com o `gold`, gerando a matriz de confusão por decisão com intervalo de confiança.
