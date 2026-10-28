/**
 * Copies text and reports whether it worked. navigator.clipboard only exists in a secure context
 * (https or localhost), so over plain HTTP on a LAN this falls back to a hidden textarea and
 * document.execCommand("copy"). Callers show "Copied" only when this returns true.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or not focused: try the fallback below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    const active = document.activeElement as HTMLElement | null;
    // Inside a modal the textarea must sit in the dialog, or a focus trap may steal the selection
    (active?.closest("[role=dialog]") || document.body).appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    active?.focus?.();
    return ok;
  } catch {
    return false;
  }
}
