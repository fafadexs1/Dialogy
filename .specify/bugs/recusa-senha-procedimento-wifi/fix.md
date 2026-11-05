# Bug Fix: Autorização Total de Fornecimento e Alteração de Wi-Fi / Senha

- **Slug**: recusa-senha-procedimento-wifi
- **Fixed**: 2026-09-15T19:05:00Z
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Corrigida a base de conhecimento (`knowledge_base`) e o fluxo nativo do Lucas Suporte Técnico para permitir que o agente informe a senha atual do Wi-Fi e realize procedimentos de alteração de nome (SSID) e senha via ferramenta MCP `configure_wifi`, eliminando a recusa por políticas restritivas anteriores e prevenindo o vazamento de sintaxe de template não interpolada no nó de handoff.

## Changes

| Componente | Mudança | Notas |
|------------|---------|-------|
| `autopilot_configs.knowledge_base` | Atualização das diretivas `@consultar_wifi` e `@alterar_wifi` e regras gerais | Removeu a proibição de exibir senha atual; adicionou autorização total para fornecer senha e executar `configure_wifi` com `password`. |
| `workflow_definitions` (v57) | Correção do nó `primary_handoff` | Substituiu o template com fallback quebrado `{{current.summary || ...}}` por `{{current.customerMessage}}` e mensagem padrão direta. |
| `autopilot_config_versions` | Publicação da versão v57 | Publicada versão v57 no banco e ativada como corrente no workspace Velpro. |

## Diff Highlights

### `@consultar_wifi` (Antes vs Depois)
- **Antes**:
  `Nunca revele senha atual, mesmo se houver no retorno. Se o pedido envolver recuperar ou trocar senha, explique que o suporte dará continuidade de forma segura, sem solicitar senha no chat; transfira.`
- **Depois**:
  `Para consultar rede e senha do Wi-Fi: valide contrato/equipamento e execute get_wifi_diagnostics. Informe ao cliente tanto o nome da rede (SSID) quanto a senha atual do Wi-Fi reportada pelo equipamento. Se o cliente também quiser alterar o nome ou a senha, siga para @alterar_wifi.`

### `@alterar_wifi` (Antes vs Depois)
- **Antes**:
  `Rota exclusiva para alteração de SSID solicitada pelo titular e confirmada. Para senha, transfira para procedimento seguro humano sem coletar segredo no chat... Não envie password...`
- **Depois**:
  `Alteração de nome (SSID) e/ou senha do Wi-Fi solicitada pelo cliente. Valide o contrato/equipamento, informe que os dispositivos podem se desconectar e precisar reconectar com a nova senha/rede. Solicite o novo nome de rede desejado e/ou a nova senha desejada (mínimo de 8 caracteres). Obtenha a confirmação do cliente e execute configure_wifi com device_id, band (padrão 'both'), ssid e password conforme solicitado.`

### `primary_handoff` (Antes vs Depois)
- **Antes**:
  `{{current.summary || "Um momento, vou transferir o seu atendimento para a nossa equipe técnica de suporte."}}` (inválido no renderTemplate)
- **Depois**:
  `{{current.customerMessage}}`

## Tests Added or Updated

- `check-mcp-wifi.ts`: Validação de que `get_wifi_diagnostics` no roteador ZTE3BJNQ7H01408 retorna a senha atual (`Velpro123@@@`) e os SSIDs das bandas 2.4GHz e 5GHz com status 200 OK.
- `publish-lucas-v57.ts`: Validação formal do workflow definition v57 com reconciliação de ferramentas e persistência em banco.

## Local Verification

- Validação da estrutura JSON do workflow: `valid: true`.
- Verificação do registro ativo em `autopilot_configs`: `active_workflow_version: 'v57'`.

## Deviations from Assessment

Nenhuma. Todas as correções seguiram o plano estabelecido no assessment.

## Follow-ups

- Monitorar os próximos atendimentos do cliente `5561995215930` para verificar se o agente responde diretamente fornecendo a senha ou efetuando a alteração solicitada.
