/**
 * Only same-origin paths, so a `next` parameter cannot become an open redirect.
 * Browsers drop tabs/newlines and treat "\\" as "/" in URLs, so those are refused
 * before the value is resolved against a placeholder origin.
 */
export function safeNextPath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value, "http://localhost");
    return url.origin === "http://localhost" ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}
