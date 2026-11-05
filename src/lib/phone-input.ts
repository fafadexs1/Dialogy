const NATIONAL_NUMBER_LENGTHS: Record<string, readonly number[]> = {
  '1': [10],
  '34': [9],
  '52': [10],
  '54': [10, 11],
  '55': [10, 11],
  '351': [9],
};

export function sanitizeNationalPhoneInput(value: string, countryCode: string): string {
  const digits = value.replace(/\D/g, '');
  const acceptedLengths = NATIONAL_NUMBER_LENGTHS[countryCode];
  const possibleNationalNumber = digits.startsWith(countryCode)
    ? digits.slice(countryCode.length)
    : '';
  const hasRecognizedCountryCode = Boolean(
    acceptedLengths?.includes(possibleNationalNumber.length)
  );
  const nationalDigits = hasRecognizedCountryCode ? possibleNationalNumber : digits;

  return nationalDigits.slice(0, Math.max(...(acceptedLengths || [13])));
}
