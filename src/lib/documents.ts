// Brazilian document helpers. Pure functions: safe on server and client.

export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

/** Removes punctuation and upper-cases; alphanumeric CNPJ (IN RFB 2.229/2024) keeps letters. */
export function normalizeCnpj(value: string) {
  return value.replace(/[^0-9a-z]/gi, "").toUpperCase();
}

// Character value for the check-digit calculation: ASCII code minus 48,
// so digits keep their value and letters A-Z map to 17-42.
function cnpjCharValue(char: string) {
  return char.charCodeAt(0) - 48;
}

function cnpjCheckDigit(base: string) {
  let weight = 2;
  let sum = 0;
  for (let index = base.length - 1; index >= 0; index -= 1) {
    sum += cnpjCharValue(base[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCnpj(value: string) {
  const cnpj = normalizeCnpj(value);
  // 12 alphanumeric characters followed by 2 numeric check digits.
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const first = cnpjCheckDigit(cnpj.slice(0, 12));
  const second = cnpjCheckDigit(cnpj.slice(0, 12) + first);
  return cnpj.endsWith(`${first}${second}`);
}

export function isValidCpf(value: string) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export function formatCnpj(value: string) {
  const cnpj = normalizeCnpj(value);
  if (cnpj.length !== 14) return value;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

export function formatCpf(value: string) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return value;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

/** Landline (10 digits) or mobile (11 digits) with area code. */
export function isValidPhone(value: string) {
  const phone = onlyDigits(value);
  return /^[1-9]{2}(9\d{8}|[2-8]\d{7})$/.test(phone);
}

export function formatPhone(value: string) {
  const phone = onlyDigits(value);
  if (phone.length === 11) return `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`;
  if (phone.length === 10) return `(${phone.slice(0, 2)}) ${phone.slice(2, 6)}-${phone.slice(6)}`;
  return value;
}

export function isValidCep(value: string) {
  return /^\d{8}$/.test(onlyDigits(value));
}

export function formatCep(value: string) {
  const cep = onlyDigits(value);
  return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : value;
}
