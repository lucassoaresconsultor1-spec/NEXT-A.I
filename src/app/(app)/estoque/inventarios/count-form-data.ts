// Reads the count sheet: one field "qty:<itemId>" per item the counter changed.
// Service errors come back as "items.<index>.<field>" and are mapped to the field of that item.

export const QTY_PREFIX = "qty:";

export function readCountedItems(formData: FormData): { itemId: string; countedQuantity: string }[] {
  const items: { itemId: string; countedQuantity: string }[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(QTY_PREFIX) || typeof value !== "string" || value.trim() === "") continue;
    items.push({ itemId: name.slice(QTY_PREFIX.length), countedQuantity: value.trim() });
  }
  return items;
}

export function itemFieldErrors(fieldErrors: Record<string, string[]> | undefined, items: { itemId: string }[]): Record<string, string[]> | undefined {
  if (!fieldErrors) return undefined;
  const mapped: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const match = /^items\.(\d+)\./.exec(key);
    const item = match ? items[Number(match[1])] : undefined;
    mapped[item ? `${QTY_PREFIX}${item.itemId}` : key] = messages;
  }
  return mapped;
}
