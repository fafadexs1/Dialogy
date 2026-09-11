# Consumo observado: foto de vestido e retomada

Modelo: deepseek/deepseek-v4-flash. Fonte: reasoning-model-live.json neste diretório. Modelo real, conversa e catálogo controlados; nenhuma compra, publicação ou entrega WhatsApp.

| Turno | Duração observada | Decisões | Ferramentas | Tokens de entrada | Tokens de saída |
|---|---:|---:|---:|---:|---:|
| Solicitar foto do vestido azul | 6,978 s | 3 | 2 | 15.560 | 1.057 |
| Retomar e perguntar a cor | 2,493 s | 1 | 0 | 4.075 | 447 |
| Total | 9,471 s | 4 | 2 | 19.635 | 1.504 |

O teste verificou o produto blue e a URL do catálogo, uma única chamada de apresentação e resposta azul na retomada, sem transferência. A execução de apresentação é controlada; não prova entrega no canal.

## Estimativa do modelo, sem desconto de cache

Preços em USD por milhão de tokens consultados na [documentação oficial](https://api-docs.deepseek.com/quick_start/pricing/): entrada sem cache 0,44 em pico / 0,22 fora de pico; saída 1,32 / 0,66. A captura mais recente do índice oficial informa preços diferentes dos registros antigos sem barra final; foram utilizados os valores mais recentes de pico/fora de pico.

Fórmula: (tokens de entrada × preço de entrada + tokens de saída × preço de saída) / 1.000.000.

- Dois turnos: USD 0,01062468 em pico ou USD 0,00531234 fora de pico, supondo toda entrada sem cache.
- Mil repetições com exatamente esse consumo: USD 10,62468 em pico ou USD 5,31234 fora de pico. É extrapolação, não previsão de custo para mil clientes reais.

Os registros não discriminam cache hit/miss; portanto não permitem reproduzir a cobrança efetiva. A estimativa exclui infraestrutura, canal, ferramentas, análise de mídia, impostos, câmbio e tentativas de teste anteriores. Uma única conversa não mede distribuição de latência nem taxa de resolução. Comparação com o adaptativo anterior sob o mesmo cenário ainda não foi realizada; não há economia relativa comprovada.
