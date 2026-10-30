import { extractFromPage } from "./extract.js";
import { api, loadSettings, saveSettings } from "./settings.js";

const ENGINE_NAMES = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", copilot: "Copilot", google_aio: "Google AI Overview", google_ai_mode: "Google AI Mode" };
const NEW = "__new__";
const $ = (id) => document.getElementById(id);

const show = (text, tone = "") => {
  $("state").textContent = text;
  $("state").className = `state ${tone}`;
  $("state").hidden = !text;
};

/** Same normalisation and word-overlap ranking as the server (manual-capture.ts). */
const normalize = (q) =>
  (q || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[^\p{L}\p{N}$%+&]+/gu, " ")
    .trim();
const words = (q) => new Set(normalize(q).split(" ").filter((w) => w.length > 1));
function rank(question, prompts) {
  const q = words(question);
  return prompts
    .map((p) => {
      const w = words(p.text);
      let shared = 0;
      for (const x of w) if (q.has(x)) shared++;
      return { ...p, score: q.size + w.size - shared ? shared / (q.size + w.size - shared) : 0 };
    })
    .sort((a, b) => b.score - a.score);
}

async function readTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: extractFromPage });
  return result;
}

let settings;
let capture;
let context;

function fillPrompts() {
  const select = $("prompt");
  select.textContent = "";
  const ranked = rank(capture.question || "", context.prompts.filter((p) => p.active));
  const exact = ranked.find((p) => normalize(p.text) === normalize(capture.question));
  const addOpt = (value, label) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    select.append(o);
  };
  if (capture.question) addOpt(NEW, `➕ Add as new: “${capture.question.slice(0, 80)}”`);
  for (const p of ranked) addOpt(p.id, `${p.score >= 0.5 ? "★ " : ""}${p.text}`);
  select.value = exact ? exact.id : ranked[0] && ranked[0].score >= 0.5 ? ranked[0].id : capture.question ? NEW : ranked[0]?.id || "";
  $("asked").textContent = capture.question ? `You asked: “${capture.question.slice(0, 160)}”${exact ? " (tracked)" : ""}` : "The question was not found on the page; pick it from the list.";
  $("new-question").hidden = select.value !== NEW;
}

async function loadContext(brandId) {
  context = await api(settings, `/api/capture/context${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ""}`);
  const brand = $("brand");
  brand.textContent = "";
  for (const b of context.brands) {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = `${b.name} (${b.domain})`;
    brand.append(o);
  }
  brand.value = context.brandId || "";
  fillPrompts();
}

async function init() {
  settings = await loadSettings();
  if (!settings.token) {
    show("Connect the extension to PrismGEO first: open Settings and paste the capture token.", "warn");
    return;
  }
  // ?tabId= lets the popup page be opened as a tab against a given page (automated tests)
  const forcedTab = Number(new URLSearchParams(location.search).get("tabId")) || 0;
  const [tab] = forcedTab ? [await chrome.tabs.get(forcedTab)] : await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || "")) return show("Open an answer in ChatGPT, Gemini, Perplexity, Copilot or Google, then click again.", "warn");

  // Read twice: an answer that is still being written is not saved
  let first;
  try {
    first = await readTab(tab.id);
  } catch {
    return show("This page cannot be read. Open the answer in a normal browser tab and try again.", "error");
  }
  if (first.error) return show(first.error, "warn");
  await new Promise((r) => setTimeout(r, 1200));
  capture = await readTab(tab.id);
  if (capture.error) return show(capture.error, "warn");
  if (capture.streaming || capture.answerText !== first.answerText) {
    return show(`${ENGINE_NAMES[capture.engine]} is still writing the answer. Wait until it finishes, then click again.`, "warn");
  }

  try {
    await loadContext(settings.brandId);
  } catch (err) {
    return show(err.message, "error");
  }
  if (!context.brands.length) return show("Create a client in PrismGEO first.", "warn");

  const wordCount = capture.answerText.split(/\s+/).filter(Boolean).length;
  $("summary").textContent = `${ENGINE_NAMES[capture.engine]} answer · ${wordCount} words · ${capture.citations.length} links`;
  $("preview").textContent = `${capture.answerText.slice(0, 1500)}${capture.answerText.length > 1500 ? "\n…" : ""}\n\nLinks:\n${
    capture.citations.map((c) => `• ${c.url}`).join("\n") || "(none)"
  }${capture.engine === "gemini" && !capture.citations.length ? "\n\nTip: open Gemini's Sources panel before saving so its sources are included." : ""}`;
  show("");
  $("form").hidden = false;
}

$("brand").addEventListener("change", async (e) => {
  await saveSettings({ brandId: e.target.value });
  settings.brandId = e.target.value;
  try {
    await loadContext(e.target.value);
  } catch (err) {
    show(err.message, "error");
  }
});
$("prompt").addEventListener("change", (e) => ($("new-question").hidden = e.target.value !== NEW));
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = $("save");
  button.disabled = true;
  button.textContent = "Saving…";
  const promptId = $("prompt").value;
  const body = {
    brandId: $("brand").value,
    engine: capture.engine,
    answerText: capture.answerText,
    citations: capture.citations.slice(0, 200),
    pageUrl: capture.pageUrl,
    ...(promptId === NEW ? { question: capture.question, addAsPrompt: true, intent: $("intent").value } : { promptId }),
  };
  try {
    const r = await api(settings, "/api/capture", { method: "POST", body: JSON.stringify(body) });
    $("form").hidden = true;
    const result = $("result");
    result.hidden = false;
    const named = r.mentions.length
      ? r.mentions.map((m) => `${m.isTarget ? "<strong>" : ""}${escapeHtml(m.name)}${m.isTarget ? "</strong>" : ""} (${m.sentiment})`).join(", ")
      : "no tracked company";
    result.innerHTML = `<p class="ok">Saved to PrismGEO.</p><p>${escapeHtml(r.promptText)}</p><p class="muted small">Named: ${named} · ${r.citations} sources stored.</p>`;
  } catch (err) {
    show(err.message, err.status === 409 ? "warn" : "error");
    button.disabled = false;
    button.textContent = "Save answer";
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

init();
