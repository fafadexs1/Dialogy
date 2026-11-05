# Aurora Work · vendas fictícias

Rascunho criado no workspace **Dialogy**, sem publicação e sem alterar outros workflows.

- Nome: **Aurora Work · Vendas fictícias com DeepSeek**.
- ID: `79962002-b803-4bac-b549-98fb5607f19f`.
- Editor: https://dialogy.klyraai.com.br/nexus/flows/79962002-b803-4bac-b549-98fb5607f19f
- 46 blocos em sete seções. Palavra de entrada: `demo aurora`.
- `workflow.json` contém a definição exportável; `workspace-draft.json` registra a confirmação de salvamento.

## O que ele faz

A Nina recebe o visitante, oferece uma compra consultiva ou acesso direto ao catálogo, pergunta nome, necessidade, orçamento e urgência, recomenda um produto e calcula a pontuação do lead. O DeepSeek escreve uma introdução curta e classifica dúvidas livres. Preços, condições, catálogo e cálculo da proposta ficam em dados e código controlados pelo fluxo.

O cliente pode comparar os produtos, esclarecer preço, entrega e garantia, escolher um item, aceitar ou recusar um apoio para os pés, selecionar PIX ou cartão e revisar o total antes de confirmar. Uma confirmação gera somente um pedido fictício e um registro local da demonstração. O caminho humano exibe um resumo simulado, sem transferir atendimento. O follow-up só acontece com consentimento explícito e para quando chega uma mensagem; o limite é de um lembrete após dez minutos.

Há rotas para cancelamento, expiração, erro técnico, baixa confiança e IA indisponível. Retornos às dúvidas e à escolha são limitados. Nenhum bloco cobra, cria pedido real, modifica CRM real, chama fornecedor, envia e-mail ou atribui uma equipe.

## Catálogo e condições fictícias

| Produto | Preço |
|---|---:|
| Cadeira Aurora Fit | R$ 699,00 |
| Mesa Aurora Lift | R$ 1.299,00 |
| Kit Aurora Pro: cadeira + mesa | R$ 1.799,00 |
| Apoio para os pés opcional | R$ 99,00 |

PIX: 5% sobre produtos, sem desconto sobre frete. Frete: R$ 49,00; grátis quando o subtotal de produtos atingir R$ 1.000,00 antes do desconto. Cartão: três parcelas sem juros, distribuindo os centavos restantes nas últimas parcelas. A comparação do kit considera os preços separados. Os sete dias para devolução, doze meses de garantia e cinco a dez dias úteis de entrega são exemplos inventados desta loja fictícia.

Exemplo verificado: kit + apoio = R$ 1.898,00; desconto PIX = R$ 94,90; frete grátis; total = **R$ 1.803,10**. O fluxo nunca pede cartão, CPF ou documento.

## DeepSeek depois

Cadastre a credencial protegida do DeepSeek no workspace e confirme a seleção no bloco **DeepSeek · vincular credencial**. O modelo já indicado é `deepseek/deepseek-flash`; a mesma conexão atende a introdução comercial e o classificador de dúvidas. As instruções estão nos respectivos inspetores e podem ser editadas.

O teste/publicação do aplicativo exige uma credencial ativa para validar o bloco de modelo. Os testes locais também verificaram falhas do provedor e respostas inadequadas: o fluxo usa uma introdução fixa e um menu de dúvidas. Isso é contingência em execução, não homologação com o provedor real.

O código e o worker da caixa de ferramentas precisam estar disponibilizados no ambiente antes de publicar, incluindo a infraestrutura de esperas duráveis. O follow-up utiliza essa infraestrutura; seu teste aqui usa o motor com persistência em memória. Nenhum deploy, migração de produção, publicação ou envio real foi realizado.

## Evidências

`conversa-de-teste.md` mostra uma jornada completa produzida pelo executor real com IA e transporte simulados. `conversa-de-teste.json` inclui o pedido fictício e contadores. Os testes também cobrem compra direta, parcelas e frete, cancelamento, objeções, ausência de modelo, texto inseguro, produto inexistente, encaminhamento simulado, consentimento, recebimento antes do prazo, limite do lembrete e limite de repetições.

Para reproduzir: `CAPTURE_AURORA_DEMO=1` com `npx vitest run tests/aurora-sales-demo.spec.ts`. Para gerar outro arquivo local: `npx tsx scripts/prepare-aurora-sales-demo.ts`. A opção `--save-draft` é restrita ao workspace Dialogy e preserva um exemplo existente com a mesma chave, sem sobrescrever edições.
