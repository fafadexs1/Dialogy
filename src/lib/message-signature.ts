export function prependIntelligentAttendantSignature(content: string, agentName: string): string {
  const normalizedName = agentName.trim().toUpperCase();
  if (!normalizedName) return content;

  const signature = `*${normalizedName} (Agente Virtual)*`;
  if (content.trimStart().startsWith(signature)) return content;

  return `${signature}:\n\n${content}`;
}
