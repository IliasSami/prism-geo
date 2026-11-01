/**
 * How secrets are shown to the browser. API keys and the proxy password never leave the server
 * in full: GET /api/settings returns masked values, and a masked value sent back means "keep the
 * saved one".
 */
export const MASK = "••••";

/** "••••1234": at most the last 4 characters, and nothing at all for short keys. */
export function maskKey(value: string): string {
  if (!value) return "";
  return value.length >= 12 ? `${MASK}${value.slice(-4)}` : MASK;
}

export const isMasked = (value: string) => value.includes(MASK);

/** The proxy URL with its password replaced by •••• (the user name stays visible). */
export function maskProxyUrl(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!url.password) return value;
    url.password = "MASKED";
    return url.toString().replace(":MASKED@", `:${MASK}@`);
  } catch {
    return MASK;
  }
}

/**
 * The proxy URL to save when the browser sends `value`. A masked password is replaced by the
 * saved one only while the host name and user name stay the same (the port may change), so the
 * saved password is never sent to a different proxy. null: the password must be entered again.
 */
export function unmaskProxyUrl(value: string, saved: string): string | null {
  if (!isMasked(value)) return value;
  // The unreadable saved URL comes back as the bare mask: unchanged
  if (value.trim() === MASK) return saved;
  try {
    const url = new URL(value.replace(`:${MASK}@`, ":MASKED@"));
    if (url.password !== "MASKED") return null;
    const previous = new URL(saved);
    if (url.hostname !== previous.hostname || url.username !== previous.username) return null;
    url.password = previous.password;
    return url.toString();
  } catch {
    return null;
  }
}
