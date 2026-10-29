/**
 * Reads the answer that is on screen when the person clicks "Save to PrismGEO".
 *
 * Injected with chrome.scripting.executeScript on click only (activeTab); it never runs on its
 * own, never types, clicks or navigates. It must stay self-contained: the browser serialises
 * this one function into the page, so it cannot use imports or outer variables.
 *
 * Returns { engine, question, answerText, citations: [{ url, title }], pageUrl, streaming, error? }.
 */
export function extractFromPage() {
  const host = location.hostname.replace(/^www\./, "");
  const engine =
    host === "chatgpt.com" || host === "chat.openai.com"
      ? "chatgpt"
      : host === "gemini.google.com"
        ? "gemini"
        : host === "perplexity.ai"
          ? "perplexity"
          : host === "copilot.microsoft.com"
            ? "copilot"
            : /^google\.[a-z.]+$/.test(host) && location.pathname.startsWith("/search")
              ? "google_aio"
              : null;
  const pageUrl = location.href;
  if (!engine) {
    return { engine: null, pageUrl, error: "Open an answer in ChatGPT, Gemini, Perplexity, Copilot or a Google search with an AI Overview, then click again." };
  }

  const all = (sel) => Array.from(document.querySelectorAll(sel));
  const last = (sel) => {
    const els = all(sel);
    return els.length ? els[els.length - 1] : null;
  };
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  /** Visible text with paragraph and list structure, like PrismGEO's crawler extraction. */
  const textOf = (root) => {
    const clone = root.cloneNode(true);
    clone
      .querySelectorAll("script, style, noscript, svg, button, img, video, [aria-hidden='true'], .sr-only, [hidden], textarea, input")
      .forEach((n) => n.remove());
    // Source chips: short host-like links that follow a sentence (the URL is kept as a citation)
    clone.querySelectorAll("a[href]").forEach((a) => {
      const label = clean(a.textContent);
      const parentText = clean(a.parentElement && a.parentElement.textContent);
      const counted = /\+\s?\d+$/.test(label);
      const hostLike = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(label);
      const before = parentText.slice(0, Math.max(0, parentText.indexOf(label))).trimEnd();
      const inSentence = /[\p{L}\p{N},:(]$/u.test(before);
      if (label.length <= 40 && (counted || (hostLike && !inSentence) || (parentText === label && !/\s/.test(label)))) a.remove();
    });
    clone.querySelectorAll("td, th").forEach((n) => n.insertAdjacentText("afterend", " | "));
    clone.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, tr, br, div, pre, blockquote").forEach((n) => n.insertAdjacentText("afterend", "\n"));
    return (clone.textContent || "")
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter((l, i, arr) => l || (i > 0 && arr[i - 1]))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  const ENGINE_HOSTS = ["chatgpt.com", "openai.com", "gemini.google.com", "perplexity.ai", "copilot.microsoft.com", "bing.com"];
  /** Links in the answer, resolved past Google's /url redirect, without the engine's own pages. */
  const linksOf = (roots) => {
    const out = [];
    const seen = new Set();
    for (const root of roots.filter(Boolean)) {
      for (const a of root.querySelectorAll("a[href]")) {
        let url;
        try {
          const u = new URL(a.getAttribute("href"), location.href);
          url = u.hostname.endsWith("google.com") && u.pathname === "/url" ? u.searchParams.get("q") || u.searchParams.get("url") || "" : u.href;
          if (!/^https?:\/\//i.test(url)) continue;
          const h = new URL(url).hostname.replace(/^www\./, "");
          if (ENGINE_HOSTS.some((e) => h === e || h.endsWith(`.${e}`))) continue;
          if (engine === "google_aio" && /(^|\.)google\.[a-z.]+$/.test(h)) continue;
        } catch {
          continue;
        }
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ url, title: clean(a.getAttribute("aria-label") || a.textContent).slice(0, 300) || url });
      }
    }
    return out;
  };

  let answerEl = null;
  let extraRoots = [];
  let question = "";
  let streaming = false;
  const stopButton = () => !!document.querySelector("[data-testid='stop-button'], button[aria-label^='Stop'], button[aria-label*='stop generating' i]");

  if (engine === "chatgpt") {
    answerEl = last("[data-message-author-role='assistant']");
    question = clean(last("[data-message-author-role='user']")?.textContent);
    streaming = stopButton() || !!answerEl?.querySelector(".result-streaming");
  } else if (engine === "gemini") {
    answerEl = last("model-response message-content") || last("model-response .markdown") || last("message-content");
    question = clean((last("user-query .query-text") || last("user-query"))?.textContent).replace(/^You said\s*/i, "");
    // Sources open in a side panel; include them when the person has opened it
    extraRoots = [last("model-response"), document.querySelector("[class*='sources-sidebar'], context-sidebar, .source-panel")];
    streaming = stopButton();
  } else if (engine === "perplexity") {
    answerEl = last("[id^='markdown-content']") || last(".prose");
    question = clean((last("h1") || last("[data-testid*='query']"))?.textContent);
    extraRoots = [answerEl?.closest("[class*='pb-']") || null, document.querySelector("[data-testid*='sources'], [class*='citation']")];
    streaming = stopButton();
  } else if (engine === "copilot") {
    answerEl = last("[data-content='ai-message']") || last("[class*='ai-message']");
    question = clean((last("[data-content='user-message']") || last("[class*='user-message']"))?.textContent);
    streaming = stopButton();
  } else if (engine === "google_aio") {
    question = clean(document.querySelector("textarea[name='q'], input[name='q']")?.value);
    // Google AI Mode (the chat tab, udm=50) is a different surface from AI Overviews on the results page
    const aiMode =
      new URL(location.href).searchParams.get("udm") === "50" || all("h1, h2, div[role='heading'], span").some((el) => /^AI Mode reply\b/.test(clean(el.textContent)));
    if (aiMode) {
      return {
        engine,
        question,
        pageUrl,
        error: "This is Google AI Mode, not an AI Overview. PrismGEO tracks AI Overviews: open the normal results page (the All tab) and save the AI Overview shown there.",
      };
    }
    // The Overview block is introduced by an "AI Overview" heading; take the smallest block around
    // it that has real content beyond the heading (short Overviews are real Overviews too)
    const heading = all("h1, h2, h3, div[role='heading'], span").find((el) => clean(el.textContent) === "AI Overview");
    let node = heading;
    while (node && node !== document.body) {
      if (clean(node.textContent).length > "AI Overview".length + 80) break;
      node = node.parentElement;
    }
    answerEl = node && node !== document.body ? node : null;
    if (answerEl && clean(answerEl.textContent).length > 30000) answerEl = null; // took the whole page
    streaming = !!answerEl?.querySelector("[aria-busy='true']");
  }

  if (!answerEl) {
    const why =
      engine === "google_aio"
        ? "No AI Overview is shown on this results page. That is a real result; there is nothing to save."
        : "No answer found on this page yet. Ask the question, wait for the full answer, then click again.";
    return { engine, question, pageUrl, error: why };
  }
  let answerText = textOf(answerEl);
  if (engine === "google_aio") answerText = answerText.replace(/^AI Overview\s*/i, "").replace(/\n?(Show more|Show all|AI responses may include mistakes\.?.*)$/gim, "").trim();
  return { engine, question, answerText, citations: linksOf([answerEl, ...extraRoots]), pageUrl, streaming };
}
