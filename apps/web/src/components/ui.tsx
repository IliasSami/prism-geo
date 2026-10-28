import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * PrismGEO design system primitives. Compact, neutral, one accent colour.
 * Type floor is 12px; controls are 36px tall (32px for `sm`); motion is 150–220ms and is
 * disabled under prefers-reduced-motion (see globals.css).
 */

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition " +
  "duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 select-none tap-target";
const buttonVariants: Record<Variant, string> = {
  primary: "bg-zinc-900 text-white shadow-sm hover:bg-zinc-800",
  secondary: "bg-white text-zinc-800 border border-zinc-200 shadow-sm hover:bg-zinc-50 hover:border-zinc-300",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50",
};
const buttonSizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-9 px-3.5 text-base",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string): string {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], extra);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ComponentPropsWithoutRef<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/** Square icon-only button; always pass an aria-label. */
export function IconButton({
  className,
  tone = "neutral",
  type = "button",
  ...props
}: ComponentPropsWithoutRef<"button"> & { tone?: "neutral" | "danger" | "success"; "aria-label": string }) {
  const tones = {
    neutral: "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
    danger: "text-zinc-500 hover:bg-red-50 hover:text-red-600",
    success: "text-emerald-600 hover:bg-emerald-50",
  };
  return (
    <button
      type={type}
      title={props["aria-label"]}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg transition duration-150 active:scale-95 disabled:opacity-40 disabled:pointer-events-none tap-target",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

/* ── Surfaces ────────────────────────────────────────────────────────────── */

export function Card({ className, ...props }: ComponentPropsWithoutRef<"section">) {
  return <section className={cn("rounded-xl border border-zinc-200 bg-white shadow-card", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-md font-semibold text-zinc-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-base text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ── Data display ────────────────────────────────────────────────────────── */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
const badgeTones: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  accent: "bg-accent-50 text-accent-700 ring-accent-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", pulse = false }: { tone?: Tone; pulse?: boolean }) {
  const colors: Record<Tone, string> = {
    neutral: "bg-zinc-400",
    accent: "bg-accent-500",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    danger: "bg-red-500",
    info: "bg-sky-500",
  };
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", colors[tone])} />}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", colors[tone])} />
    </span>
  );
}

/** A single headline number with an optional range and caption. */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  href?: string;
}) {
  const valueTone = {
    neutral: "text-zinc-900",
    accent: "text-accent-600",
    success: "text-emerald-600",
    warning: "text-amber-600",
    danger: "text-red-600",
  }[tone];
  const body = (
    <>
      <div className="text-sm font-medium text-zinc-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tracking-tight tabular", valueTone)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </>
  );
  const cls = "block rounded-xl border border-zinc-200 bg-white p-4 shadow-card";
  return href ? (
    <Link href={href} className={cn(cls, "transition duration-150 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-pop")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Horizontal share bar, 0–1. `range` draws the uncertainty band behind the value. */
export function Meter({
  value,
  range,
  tone = "accent",
  label,
}: {
  value: number;
  range?: [number, number];
  tone?: "accent" | "neutral" | "success" | "warning" | "danger";
  label: string;
}) {
  const fill = { accent: "bg-accent-500", neutral: "bg-zinc-400", success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500" }[tone];
  const pct = (n: number) => `${Math.max(0, Math.min(1, n)) * 100}%`;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-100" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      {range && <div className="absolute inset-y-0 rounded-full bg-zinc-200" style={{ left: pct(range[0]), width: pct(range[1] - range[0]) }} />}
      <div className={cn("absolute inset-y-0 left-0 origin-left rounded-full animate-bar-grow", fill)} style={{ width: pct(value) }} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center animate-fade-in">
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500">{icon}</div>}
      <h3 className="text-md font-semibold text-zinc-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-base text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const tones: Record<Tone, string> = {
    neutral: "border-zinc-200 bg-zinc-50 text-zinc-700",
    accent: "border-accent-200 bg-accent-50 text-accent-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-800",
    info: "border-sky-200 bg-sky-50 text-sky-900",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex flex-wrap items-start justify-between gap-3 rounded-xl border px-4 py-3 text-base", tones[tone])}>
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title ? "mt-0.5" : "", "opacity-90")}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

/* ── Forms ───────────────────────────────────────────────────────────────── */

export const inputClass =
  "h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 placeholder:text-zinc-400 shadow-sm " +
  "transition duration-150 hover:border-zinc-300 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20 " +
  "disabled:bg-zinc-50 disabled:text-zinc-500";

export const textareaClass = inputClass.replace("h-9", "min-h-[84px] py-2 leading-relaxed");

export function Field({ label, hint, htmlFor, children }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-700">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/* ── Tables ──────────────────────────────────────────────────────────────── */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-left text-base", className)}>{children}</table>
    </div>
  );
}

export const th = "px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 bg-zinc-50/80 border-b border-zinc-200";
export const td = "px-4 py-3 align-top border-b border-zinc-100";

/* ── Formatting ──────────────────────────────────────────────────────────── */

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return `${(n * 100).toFixed(digits)}%`;
}

export const ENGINE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
  google_aio: "Google AI Overviews",
  copilot: "Copilot",
};

export function engineLabel(id: string): string {
  return ENGINE_LABELS[id] || id;
}
