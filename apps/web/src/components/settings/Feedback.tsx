"use client";

import { useEffect } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { Button, cn } from "@/components/ui";

export interface ToastState {
  type: "success" | "error" | "info";
  message: string;
}

/** Bottom-right toast; announced politely to screen readers, errors assertively. */
export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, toast.type === "error" ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  return (
    <div aria-live={toast?.type === "error" ? "assertive" : "polite"} role="status" className="pointer-events-none fixed bottom-6 right-6 z-50">
      {toast && (
        <div
          className={cn(
            "pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-base shadow-pop animate-fade-up",
            toast.type === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-zinc-200 bg-white text-zinc-800"
          )}
        >
          {toast.type === "success" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />}
          {toast.type === "error" && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />}
          {toast.type === "info" && <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" aria-hidden />}
          <span className="flex-1">{toast.message}</span>
          <button type="button" onClick={onClose} aria-label="Dismiss notification" className="-m-1 rounded-md p-1 text-zinc-400 hover:text-zinc-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Appears at the bottom of the page while there are unsaved changes. */
export function SaveBar({ visible, saving, onSave, onDiscard }: { visible: boolean; saving: boolean; onSave: () => void; onDiscard: () => void }) {
  if (!visible) return null;
  return (
    <div className="sticky bottom-4 z-30 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-pop backdrop-blur">
        <p className="text-base text-zinc-700">
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" aria-hidden />
          You have unsaved changes
        </p>
        <div className="flex gap-2">
          <Button onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
          <Button variant="primary" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
