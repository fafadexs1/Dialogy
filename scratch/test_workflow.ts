function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasSpecificSupportActionRequest(message: string): boolean {
  const normalized = normalizeText(message);
  const regex = /\b(reiniciar|reinicia|reboot|resetar|reseta|desligar|ligar)\b/;
  console.log("Normalized:", normalized);
  console.log("Match:", regex.exec(normalized));
  return regex.test(normalized);
}

const message = 'reinicia meu roteador por favor';
console.log("Result:", hasSpecificSupportActionRequest(message));
