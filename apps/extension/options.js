import { api, loadSettings, saveSettings } from "./settings.js";

const $ = (id) => document.getElementById(id);

(async () => {
  const s = await loadSettings();
  $("server").value = s.serverUrl;
  $("token").value = s.token;
})();

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("status");
  const serverUrl = $("server").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  status.textContent = "Testing…";
  status.className = "muted";
  try {
    const origin = new URL(serverUrl).origin;
    // localhost is granted at install; any other address needs the person's explicit permission
    if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) throw new Error("Permission to reach that address was not given.");
    }
    await saveSettings({ serverUrl, token });
    const ctx = await api({ serverUrl, token }, "/api/capture/context");
    status.textContent = `Connected: ${ctx.brands.length} client(s), ${ctx.prompts.length} tracked questions.`;
    status.className = "ok";
  } catch (err) {
    status.textContent = err.message;
    status.className = "error";
  }
});
