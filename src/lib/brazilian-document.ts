/** Removes presentation punctuation without discarding invalid characters. */
export function normalizeBrazilianDocument(value: string): string {
  return value.trim().toUpperCase().replace(/[.\/\-\s]/g, '');
}

/** CPF and numeric/alphanumeric CNPJ check digits (Receita Federal modulo 11). */
export function isValidBrazilianDocument(value: string): boolean {
  const document = normalizeBrazilianDocument(value);
  if (/^(.)\1+$/.test(document)) return false;
  const digit = (text: string, weights: number[]) => {
    const remainder = [...text].reduce((sum, char, index) => sum + (char.charCodeAt(0) - 48) * weights[index]!, 0) % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  if (/^\d{11}$/.test(document)) {
    return digit(document.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(document[9])
      && digit(document.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(document[10]);
  }
  if (/^[A-Z0-9]{12}\d{2}$/.test(document)) {
    return digit(document.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(document[12])
      && digit(document.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(document[13]);
  }
  return false;
}
