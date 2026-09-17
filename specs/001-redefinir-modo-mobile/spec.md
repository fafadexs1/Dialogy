# Feature Specification: Redefinição da Experiência Mobile como Chat Nativo

**Feature Branch**: `001-redefinir-modo-mobile`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "Redefinir o modo mobile do Dialogy com interface dedicada de mensageria (Mobile-First Web View), tela de lista limpa, chat em tela cheia com ancoragem perfeita do teclado virtual (100dvh/visualViewport), remoção de abas estáticas e centralização de ações em bottom sheet"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Atendimento e Conversação em Tela Cheia (Priority: P1)

Como atendente utilizando o smartphone, quero visualizar e responder uma conversa em tela cheia com interface de mensageiro instantâneo, para que eu possa focar totalmente no diálogo com o cliente sem distrações de menus ou botões desktop.

**Why this priority**: É o núcleo de valor do produto no celular. Se o atendente não conseguir ler e responder confortavelmente em tela cheia, a experiência móvel falha em seu propósito fundamental.

**Independent Test**: Pode ser testado abrindo qualquer conversa ativa a partir da lista móvel; a conversa deve ocupar 100% da viewport, exibindo o histórico de mensagens em balões claros, avatar e identificação do cliente no cabeçalho e um botão evidente para voltar à lista.

**Acceptance Scenarios**:

1. **Given** que o atendente está na lista de conversas em um dispositivo móvel, **When** toca em um card de conversa, **Then** o sistema transiciona para a visualização da conversa em tela cheia, ocultando a lista e exibindo o botão de retorno no cabeçalho.
2. **Given** que o atendente está em uma conversa em tela cheia, **When** toca no botão de voltar (`←`), **Then** o sistema retorna imediatamente para a lista de conversas na mesma posição de rolagem e na mesma aba em que estava.
3. **Given** que uma nova mensagem de texto ou áudio é recebida do cliente, **When** a conversa está aberta na tela móvel, **Then** a mensagem surge no final do histórico instantaneamente sem recarregar a tela.

---

### User Story 2 - Estabilidade e Visibilidade do Campo de Digitação com Teclado Virtual (Priority: P1)

Como atendente digitando em um celular, quero que a barra de envio de mensagem permaneça perfeitamente visível e fixada imediatamente acima do teclado virtual, para que o teclado nunca cubra o que estou escrevendo nem o botão de envio.

**Why this priority**: A sobreposição do teclado virtual sobre a área de texto é o defeito mais frustrante e crítico em interfaces web móveis. Garantir ancoragem e visibilidade contínua é pré-requisito para viabilidade de uso.

**Independent Test**: Pode ser testado tocando no campo de texto em dispositivos móveis (iOS e Android); o teclado virtual se abre e a barra de digitação deve ser reposicionada suavemente sobre ele, mantendo o botão de envio e a última mensagem do histórico acessíveis sem cortes.

**Acceptance Scenarios**:

1. **Given** que o atendente está em uma conversa aberta, **When** toca no campo de entrada de texto para digitar, **Then** o teclado virtual do sistema operacional é exibido e a barra de digitação é deslocada para cima do teclado sem sobreposição.
2. **Given** que o teclado virtual está aberto e ativo, **When** o atendente digita uma mensagem longa de múltiplas linhas, **Then** a caixa de entrada expande verticalmente até um limite ergonômico enquanto as mensagens anteriores continuam roláveis acima.
3. **Given** que o atendente conclui a digitação e toca no botão de envio, **When** a mensagem é enviada, **Then** o campo de texto é limpo, o histórico rola automaticamente para o final e o teclado permanece disponível para a próxima frase.

---

### User Story 3 - Gestão do Atendimento e Contexto via Gaveta Deslizante (Priority: P2)

Como atendente ou gestor em dispositivo móvel, quero acessar dados cadastrais do cliente, transferir a conversa ou encerrar o atendimento tocando no cabeçalho do contato, para que essas ações fiquem facilmente acessíveis pelo polegar sem poluir a área de leitura das mensagens.

**Why this priority**: Ações operacionais como transferir atendente, ver telefone e finalizar chamado são frequentes, mas não devem competir visualmente com o espaço nobre de leitura e digitação de mensagens.

**Independent Test**: Pode ser testado tocando no nome ou foto do cliente no cabeçalho do chat móvel; uma gaveta inferior deslizante deve se abrir exibindo os detalhes do lead, tags associadas, notas internas e opções para transferir ou encerrar.

**Acceptance Scenarios**:

1. **Given** que o operador está com uma conversa aberta, **When** toca na área do contato no cabeçalho, **Then** uma gaveta deslizante inferior é exibida cobrindo parcialmente a tela, apresentando telefone, canal de origem, protocolo e etiquetas do cliente.
2. **Given** que a gaveta inferior está aberta, **When** o operador seleciona "Transferir Conversa", **Then** a lista de atendentes/equipes disponíveis é apresentada para confirmação com um toque.
3. **Given** que o operador decide encerrar a conversa pela gaveta inferior, **When** confirma o encerramento com o motivo selecionado, **Then** a conversa é finalizada, seu status atualiza visualmente e o operador pode retornar à lista.

---

### User Story 4 - Triage e Filtragem Rápida na Lista de Conversas (Priority: P3)

Como operador móvel, quero alternar rapidamente entre as filas de atendimento e pesquisar clientes por nome ou número com toques diretos, para encontrar e priorizar atendimentos pendentes em poucos segundos.

**Why this priority**: Permite triagem eficiente e organizada de conversas em trânsito antes de ingressar no diálogo em tela cheia.

**Independent Test**: Pode ser testado na lista móvel alternando entre as abas e digitando na barra de pesquisa superior; a listagem deve filtrar instantaneamente os cards correspondentes.

**Acceptance Scenarios**:

1. **Given** que o operador está na lista móvel, **When** toca na aba "Robô", "Fila", "Atendendo" ou "Encerrados", **Then** a lista atualiza instantaneamente apresentando apenas os contatos daquela categoria com seus respectivos badges numéricos.
2. **Given** que o operador digita um termo na caixa de busca superior, **When** o termo coincide com nome, telefone ou protocolo, **Then** a lista reflete os resultados filtrados em tempo real.
3. **Given** que uma conversa recebe nova mensagem ou muda de fila enquanto a lista está visível, **When** o evento em tempo real é recebido, **Then** o card do contato é reposicionado para o topo da lista com o indicador de mensagem não lida atualizado.

---

### Edge Cases

- **Retorno do aplicativo em segundo plano**: Quando o operador alterna entre aplicativos no smartphone e retorna ao navegador móvel após alguns minutos, a tela deve reconectar o canal em tempo real e sincronizar mensagens pendentes sem perder a conversa que estava aberta.
- **Teclado aberto durante chegada de mensagens concorrentes**: Se o cliente enviar múltiplas mensagens enquanto o operador estiver digitando com o teclado aberto, a área de histórico deve rolar suavemente sem saltos bruscos que tirem o foco da caixa de digitação.
- **Encerramento remoto da conversa**: Se outro operador ou uma regra automatizada encerrar ou transferir o chamado enquanto a conversa estiver aberta na tela do smartphone, o cabeçalho deve atualizar seu estado para encerrado/transferido imediatamente, ajustando os botões de ação sem fechar a tela abruptamente.
- **Contatos com nomes muito longos ou dados incompletos**: Nomes extensos devem ser truncados com reticências no cabeçalho sem empurrar os botões de voltar ou menu para fora da tela.
- **Dispositivos com entalhes de tela (Notch / Dynamic Island / Barra Inferior de Gestos)**: O cabeçalho superior e a barra de digitação inferior devem respeitar os limites físicos e áreas seguras das telas de smartphones, evitando que botões fiquem sobrepostos a barras de sistema.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE fornecer um layout exclusivo para dispositivos móveis com largura de tela inferior a 768 pixels, operando em duas visualizações distintas: Lista de Conversas e Conversa em Tela Cheia.
- **FR-002**: A tela de Lista de Conversas DEVE conter cabeçalho superior com campo de busca por texto e seletores horizontais de fila (Robô, Fila, Atendendo e Encerrados).
- **FR-003**: A tela de Lista de Conversas NÃO DEVE exibir abas inferiores de navegação vazias ou não funcionais ("CRM" e "Ajustes" estáticos).
- **FR-004**: Ao selecionar uma conversa na lista, o sistema DEVE abrir a Conversa em Tela Cheia cobrindo 100% da área útil do dispositivo.
- **FR-005**: O cabeçalho da Conversa em Tela Cheia DEVE conter um botão evidente de retorno à lista, a foto/avatar do cliente, o nome do cliente e a identificação do status atual do atendimento.
- **FR-006**: O campo de entrada de texto e controles de envio da conversa DEVEM permanecer fixados na borda inferior da tela e se reajustar imediatamente acima do teclado virtual quando este for acionado.
- **FR-007**: As mensagens da conversa DEVEM ser apresentadas em balões com contraste legível, exibindo texto, mídias (áudio com botão de reprodução, imagens com visualização expandida), carimbo de data/hora e status de entrega.
- **FR-008**: Ao tocar na área de identificação do cliente no cabeçalho, o sistema DEVE abrir uma gaveta inferior deslizante contendo dados do contato, canal, protocolo, etiquetas e notas.
- **FR-009**: A gaveta inferior DEVE disponibilizar os fluxos de encerramento do atendimento (com seleção de motivo) e transferência para outro atendente ou equipe.
- **FR-010**: O sistema DEVE sincronizar em tempo real todas as mensagens recebidas e alterações de status de atendimento sem exigir recarregamento da página.
- **FR-011**: O layout móvel DEVE respeitar as áreas seguras de exibição (*safe areas*) superiores e inferiores em dispositivos com entalhes ou barras de navegação gestual.
- **FR-012**: O sistema DEVE preservar o estado e o rascunho de texto digitado caso o usuário alterne brevemente de aba ou feche a gaveta de contexto.

### Key Entities

- **Conversa (Chat)**: Representa o canal de comunicação ativo entre o cliente e a empresa. Possui identificador único, vínculo com contato, status da fila (Robô, Fila, Atendendo, Encerrados), atendente atribuído e carimbos de data/hora.
- **Mensagem (Message)**: Item individual de comunicação dentro de uma conversa. Contém autor (cliente, operador ou sistema), conteúdo textual, anexos de mídia (áudio, imagem, documento), status de leitura e registro de horário.
- **Contato (Contact)**: Cadastro do cliente com nome, número de telefone, foto de perfil, etiquetas e notas históricas de atendimento.
- **Motivo de Encerramento (Close Reason Tag)**: Categoria padronizada de classificação utilizada no momento da finalização do atendimento.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O campo de digitação e o botão de envio permanecem 100% visíveis e operáveis sem sobreposição do teclado virtual em dispositivos móveis homologados (iOS Safari e Android Chrome).
- **SC-002**: O operador consegue navegar da lista para uma conversa e começar a digitar uma resposta em menos de 2 segundos.
- **SC-003**: 100% das mensagens recebidas enquanto a conversa está em tela cheia são renderizadas na tela sem necessidade de intervenção ou recarga manual da página.
- **SC-004**: O operador consegue executar o fluxo completo de encerramento ou transferência de um chamado na gaveta inferior em no máximo 3 toques na tela.
- **SC-005**: Eliminação completa de barras de navegação com opções não implementadas ou botões inativos na visualização móvel.

## Assumptions

- Os usuários acessam o modo móvel primariamente por meio de navegadores móveis modernos (Safari no iOS e Chrome no Android) ou através de atalhos instalados na tela inicial (PWA).
- A camada de autenticação, o armazenamento de dados em cache local e o serviço de mensageria em tempo real existentes são mantidos e reaproveitados integralmente.
- Recursos complexos de desktop incompatíveis com atendimento rápido em smartphone (como criador visual de fluxos de IA e dashboards analíticos densos) continuam reservados à visualização desktop.
- O dispositivo móvel do atendente possui conexão de internet ativa com suporte a conexões seguras WebSocket para recebimento de eventos.
