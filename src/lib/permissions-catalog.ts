export const PERMISSIONS = [
    // Workspace & Settings
    { id: 'workspace:settings:view', category: 'Workspace', description: 'Visualizar configurações do workspace' },
    { id: 'workspace:settings:edit', category: 'Workspace', description: 'Editar configurações do workspace' },
    { id: 'workspace:invites:manage', category: 'Workspace', description: 'Criar e revogar convites para o workspace' },
    // Members & Permissions
    { id: 'members:view', category: 'Membros', description: 'Visualizar membros do workspace' },
    { id: 'members:remove', category: 'Membros', description: 'Remover membros do workspace' },
    { id: 'permissions:view', category: 'Membros', description: 'Visualizar papéis e permissões' },
    { id: 'permissions:edit', category: 'Membros', description: 'Criar, editar e atribuir papéis e permissões' },
    // Teams
    { id: 'teams:view', category: 'Equipes', description: 'Visualizar equipes' },
    { id: 'teams:edit', category: 'Equipes', description: 'Criar, editar e remover equipes e seus membros' },
    // CRM
    { id: 'crm:view', category: 'CRM', description: 'Visualizar contatos e suas informações' },
    { id: 'crm:edit', category: 'CRM', description: 'Criar e editar contatos e suas informações' },
    { id: 'crm:delete', category: 'CRM', description: 'Excluir contatos' },
    // Campaigns
    { id: 'campaigns:manage', category: 'Campanhas', description: 'Criar, visualizar e gerenciar campanhas' },
    { id: 'campaigns:delete', category: 'Campanhas', description: 'Excluir campanhas' },
    // Inbox / Chat
    { id: 'inbox:access', category: 'Chat', description: 'Acessar e responder atendimentos no Inbox' },
    // Automations
    { id: 'automations:manage', category: 'Automações', description: 'Gerenciar o Piloto Automático e Agentes do Sistema' },
    // Analytics
    { id: 'analytics:view', category: 'Analytics', description: 'Visualizar a página de Analytics' },
    // Billing
    { id: 'billing:view', category: 'Faturamento', description: 'Visualizar a página de faturamento e histórico' },
];
