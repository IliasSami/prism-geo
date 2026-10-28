"use client";

import { useState, type ReactNode } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { Badge, Field, IconButton, inputClass, cn } from "@/components/ui";

/**
 * One API key input. The settings API returns saved keys masked ("sk-p••••abcd"); sending a
 * masked value back keeps the stored key, sending "" clears it.
 */
export function ApiKeyField({
  id,
  service,
  label,
  hint,
  placeholder,
  value,
  saved,
  onChange,
}: {
  id: string;
  /** Plain name for button labels, e.g. "OpenAI key". */
  service: string;
  label: ReactNode;
  hint?: ReactNode;
  placeholder: string;
  value: string;
  /** A key is stored for this service (from the settings API). */
  saved: boolean;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const unchanged = value.includes("••••");
  const status = saved && unchanged ? "saved" : value && !unchanged ? "new" : saved && !value ? "removing" : null;

  return (
    <Field
      htmlFor={id}
      label={
        <span className="flex items-center gap-2">
          {label}
          {status === "saved" && <Badge tone="success">Saved</Badge>}
          {status === "new" && <Badge tone="warning">Not saved yet</Badge>}
          {status === "removing" && <Badge tone="danger">Will be removed</Badge>}
        </span>
      }
      hint={hint}
    >
      <div className="relative">
        <input
          id={id}
          type={visible && !unchanged ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputClass, "pr-20 font-mono")}
        />
        <div className="absolute inset-y-0 right-1 flex items-center">
          {!unchanged && value && (
            <IconButton aria-label={visible ? `Hide ${service}` : `Show ${service}`} onClick={() => setVisible(!visible)}>
              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </IconButton>
          )}
          {value && (
            <IconButton aria-label={`Clear ${service}`} tone="danger" onClick={() => onChange("")}>
              <X className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      </div>
    </Field>
  );
}
