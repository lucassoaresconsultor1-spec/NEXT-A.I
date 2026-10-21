// pt-BR display of stock quantities as the database returns them ("12.500"),
// working on the string so no floating-point rounding reaches the screen.

export type QuantityUnit = "un" | "kg" | "l" | "m";

const DB_QUANTITY = /^(-?)(\d+)(?:\.(\d{1,3}))?$/;

/** "12.500" -> "12,5"; "1234.000" -> "1.234"; "-3.250" -> "-3,25"; "0.000" -> "0". With unit: "12,5 kg". */
export function formatQuantity(dbValue: string, unit?: QuantityUnit): string {
  const match = DB_QUANTITY.exec(dbValue);
  if (!match) return dbValue;
  const [, sign, rawWhole, rawFraction = ""] = match;
  const whole = rawWhole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = rawFraction.replace(/0+$/, "");
  const isZero = /^0+$/.test(rawWhole) && fraction === "";
  const text = `${isZero ? "" : sign}${whole}${fraction ? `,${fraction}` : ""}`;
  return unit ? `${text} ${unit}` : text;
}
