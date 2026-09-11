/** Business profile fields only. Routing identifiers, ownership and permissions are not editable. */
export const STUDIO_CRM_PROFILE_FIELDS = [
  { id: 'contact.name', name: 'Nome do contato', column: 'name', type: 'text' },
  { id: 'contact.email', name: 'E-mail do contato', column: 'email', type: 'email' },
  { id: 'contact.phone', name: 'Telefone de contato', column: 'phone', type: 'phone' },
  { id: 'contact.address', name: 'Endereço do contato', column: 'address', type: 'text' },
] as const;

export const studioCrmProfileField = (id: string) => STUDIO_CRM_PROFILE_FIELDS.find((field) => field.id === id);
