# Data Model: Redefinição da Experiência Mobile como Chat Nativo

**Feature**: `001-redefinir-modo-mobile` | **Date**: 2026-09-14

## Core Domain Entities (Reused from System)

Esta funcionalidade consome os modelos de dados centrais já existentes no Dialogy, sem alterações no esquema de banco de dados ou migrações Prisma.

### Chat (Conversa)
Representa a conversa de atendimento entre o cliente e o workspace.
- `id`: `string` (UUID único da conversa)
- `workspace_id`: `string` (UUID do workspace tenant)
- `status`: `'gerais' | 'atendimentos' | 'encerrados'`
- `agentId`: `string | null` (UUID do operador humano atribuído)
- `assigned_system_agent_id`: `string | null` (UUID do agente de IA atribuído)
- `contact`: `Contact` (dados do cliente)
- `messages`: `Message[]` (mensagens recentes da conversa)
- `protocol`: `string` (código legível do protocolo)
- `unreadCount`: `number` (quantidade de mensagens não lidas)
- `instance_name`: `string` (nome da instância WhatsApp conectada)
- `updatedAt`: `string` (timestamp ISO da última atividade)
- `closed_at`: `string | null` (timestamp de encerramento)

### Message (Mensagem)
Representa um item individual enviado ou recebido na conversa.
- `id`: `string` (UUID ou ID da mensagem)
- `chat_id`: `string` (vínculo com a conversa)
- `content`: `string` (texto da mensagem)
- `type`: `'text' | 'image' | 'audio' | 'video' | 'document' | 'system'`
- `from_me`: `boolean` (true se enviada pelo operador/empresa, false se pelo cliente)
- `status`: `'sent' | 'delivered' | 'read' | 'pending' | 'failed'`
- `createdAt`: `string` (timestamp de criação)
- `transcription`: `string | null` (áudio transcrito, se houver)

### Contact (Contato)
Identificação do cliente atendido.
- `id`: `string` (UUID)
- `name`: `string` (Nome completo ou identificador)
- `phone`: `string` (Telefone formatado com DDI/DDD)
- `avatar_url`: `string | null` (URL da foto de perfil)
- `tags`: `Tag[]` (Etiquetas de classificação atribuídas)

---

## Mobile UI View State Model

Modelos de estado transitório que governam a apresentação e navegação móvel:

```typescript
export type MobileInboxTab = 'robo' | 'gerais' | 'atendimentos' | 'encerrados';

export interface MobileViewState {
  // Controle de tela: se null, exibe MobileChatList; se preenchido, exibe MobileChatView
  activeChatId: string | null;
  // Aba de fila ativa na lista
  activeTab: MobileInboxTab;
  // Termo de busca digitado
  searchQuery: string;
  // Controle de abertura da gaveta de detalhes do contato
  isContactSheetOpen: boolean;
  // Controle de abertura do modal de transferência
  isTransferDialogOpen: boolean;
  // Controle de abertura do modal de encerramento
  isCloseDialogOpen: boolean;
}

export interface MobileKeyboardMetrics {
  isOpen: boolean;
  keyboardHeight: number;
  viewportHeight: number;
}
```

---

## State Transition Diagram

```text
+-------------------------------------------------------------+
|                     MobileChatList                          |
|  - Cabeçalho com busca e abas: Robô, Fila, Atend., Encerr.  |
|  - Lista de cards virtuais de conversas                     |
+-------------------------------------------------------------+
                              |
                              | [Tocar em card de conversa]
                              v
+-------------------------------------------------------------+
|                     MobileChatView                          |
|  - Cabeçalho: Botão Voltar (<-), Foto, Nome, Status         |
|  - Histórico de mensagens com rolagem e balões ergonômicos  |
|  - Barra de digitação ancorada acima do teclado (100dvh)    |
+-------------------------------------------------------------+
         |                                           |
         | [Tocar no cabeçalho do cliente]           | [Tocar em Voltar (<-)]
         v                                           v
+------------------------------------+   +--------------------+
|         MobileContactSheet         |   | Retorna à          |
|  - Telefone, Tags, Notas           |   | MobileChatList     |
|  - Ação: Transferir Atendente      |   +--------------------+
|  - Ação: Encerrar Chamado          |
+------------------------------------+
```
