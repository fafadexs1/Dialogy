# Validação do núcleo conversacional — 05/09/2026

Mudanças locais, sem deploy nem alteração de publicação. Nenhuma mensagem enviada a clientes e nenhuma ação de negócio executada.

Fechamento: 423 testes automatizados passaram; os 18 testes conectados, desativados na suíte padrão, passaram em execução explícita separada. TypeScript, compilação do worker de IA e verificação de whitespace do diff aprovados. A última repetição conectada também passou integralmente.

## Evidência real

Avaliação sintética com o modelo publicado `deepseek/deepseek-v4-flash`, versão 20, release `26fde51c-827e-4e76-b7e2-a85ee791b084`.

- Rodada inicial: 12/12 classificações e preservação do identificador passaram.
- Segunda rodada: 11/12 classificações. Uma escolha ambígua foi classificada como dúvida; nenhuma opção foi escolhida. A distinção foi explicitada no prompt, sem flexibilizar o teste.
- Rodada ampliada após o ajuste: 15/15 classificações, preservação de identificador, leitura real do histórico e conversa completa no runtime compartilhado passaram (18 testes).
- Corpus: comércio, hotelaria, agendamento, software, educação, referência por preço, condicionais, indecisão, dúvida indireta, mudança de solicitação, antecedente ausente e campos de texto/número/data.
- O modelo e o provedor são reais. Os dados são sintéticos; efeitos de negócio são desativados e o gravador de uso é substituído. O teste de histórico faz apenas SELECT e não imprime conteúdo de clientes.

## Reprodução

```powershell
npx vitest run tests/agent-studio tests/procedure-runtime.spec.ts
npx tsc --noEmit --incremental false
npm run worker:ai:build
node scripts/evaluate-studio-model.cjs --list
node scripts/evaluate-studio-model.cjs --agent UUID --workspace UUID
```

Na suíte padrão, os testes de modelo real ficam desativados para não gerar custos ou acessar credenciais inadvertidamente. A avaliação explícita usa o modelo da publicação encontrada, sem substituição silenciosa. Uma falha deixa código de saída diferente de zero.

## Limites da evidência

O corpus é pequeno e houve variabilidade entre rodadas. Os resultados não demonstram taxa de resolução em produção, desempenho universal, nem aprendizado automático. Publicação/implantação e homologação pelo canal real continuam separadas desta validação local.
