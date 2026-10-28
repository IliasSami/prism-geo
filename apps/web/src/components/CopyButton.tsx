"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "./ui";
import { copyText } from "./clipboard";

/** Copies a fixed text; says "Copied" only when the copy really worked. */
export function CopyButton({ text, label = "Copy", size = "sm" }: { text: string; label?: string; size?: "sm" | "md" }) {
  const [state, setState] = useState<"idle" | "ok" | "failed">("idle");
  return (
    <Button
      size={size}
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "ok" : "failed");
        setTimeout(() => setState("idle"), ok ? 1500 : 4000);
      }}
    >
      {state === "ok" ? <Check className="h-4 w-4 text-emerald-700" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      <span aria-live="polite">{state === "ok" ? "Copied" : state === "failed" ? "Couldn't copy: select the text" : label}</span>
    </Button>
  );
}
