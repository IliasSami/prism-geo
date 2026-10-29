/** Where the extension sends answers, kept in chrome.storage.local on this computer only. */
export const DEFAULT_SERVER = "http://localhost:3333";

export async function loadSettings() {
  const { serverUrl, token, brandId } = await chrome.storage.local.get(["serverUrl", "token", "brandId"]);
  return { serverUrl: (serverUrl || DEFAULT_SERVER).replace(/\/+$/, ""), token: token || "", brandId: brandId || "" };
}

export async function saveSettings(values) {
  await chrome.storage.local.set(values);
}

/** Calls the PrismGEO capture API with the capture token. Throws an Error with the server's message. */
export async function api(settings, path, init = {}) {
  let res;
  try {
    res = await fetch(`${settings.serverUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.token}`, ...(init.headers || {}) },
    });
  } catch {
    throw new Error(`Cannot reach PrismGEO at ${settings.serverUrl}. Is it running (pnpm start)?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `PrismGEO answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
