import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { ScrollArea } from "./ScrollArea";

/**
 * PrismGEO design system primitives. Compact, neutral, one accent colour (Prism, see docs/brand).
 * Type floor is 12px; controls are 36px tall (44px on touch screens); motion is 150–200ms and is
 * disabled under prefers-reduced-motion (see globals.css).
 *
 * Colour has two separate jobs and they never mix:
 * - Entities: you = accent (Prism), competitor = neutral zinc, third-party = outline.
 * - Status: green / amber / red / sky, for engine and run status only.
 */

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition " +
  "duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 select-none tap-target";
const buttonVariants: Record<Variant, string> = {
  primary: "bg-zinc-900 text-white shadow-sm hover:bg-zinc-800",
  secondary: "bg-white text-zinc-800 border border-zinc-300 shadow-sm hover:bg-zinc-50 hover:border-zinc-400",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
  danger: "bg-white text-red-700 border border-red-200 hover:bg-red-50",
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
    danger: "text-zinc-500 hover:bg-red-50 hover:text-red-700",
    success: "text-emerald-700 hover:bg-emerald-50",
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
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-base text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ── Data display ────────────────────────────────────────────────────────── */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "outline";
const badgeTones: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-800 ring-zinc-300",
  outline: "bg-white text-zinc-600 ring-zinc-300",
  accent: "bg-accent-50 text-accent-700 ring-accent-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

/** Entity colours, used on every page: you, a tracked competitor, anyone else. */
export type Entity = "you" | "competitor" | "thirdParty";
export const ENTITY_TONE: Record<Entity, Tone> = { you: "accent", competitor: "neutral", thirdParty: "outline" };
export const ENTITY_LABEL: Record<Entity, string> = { you: "Your site", competitor: "Competitor", thirdParty: "Third-party" };
export const entityOf = (x: { isBrand?: boolean; isCompetitor?: boolean }): Entity => (x.isBrand ? "you" : x.isCompetitor ? "competitor" : "thirdParty");

export function EntityBadge({ entity, children, className }: { entity: Entity; children?: ReactNode; className?: string }) {
  return (
    <Badge tone={ENTITY_TONE[entity]} className={className}>
      {children ?? ENTITY_LABEL[entity]}
    </Badge>
  );
}

export function Dot({ tone = "neutral", pulse = false }: { tone?: Tone; pulse?: boolean }) {
  const colors: Record<Tone, string> = {
    neutral: "bg-zinc-400",
    outline: "bg-zinc-300",
    accent: "bg-accent-500",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    danger: "bg-red-500",
    info: "bg-sky-500",
  };
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
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
  valueClassName,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "accent" | "success";
  href?: string;
  valueClassName?: string;
}) {
  const valueTone = {
    neutral: "text-zinc-900",
    accent: "text-accent-600",
    success: "text-emerald-700",
  }[tone];
  const body = (
    <>
      <div className="text-sm font-medium text-zinc-500">{label}</div>
      <div className={cn("mt-1 truncate text-2xl font-semibold tracking-tight tabular", valueTone, valueClassName)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </>
  );
  const cls = "block min-w-0 rounded-xl border border-zinc-200 bg-white p-4 shadow-card";
  return href ? (
    <Link href={href} className={cn(cls, "transition duration-150 hover:border-zinc-300 hover:shadow-pop")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * Horizontal share bar, 0–1. `range` draws the 95% band (with edge ticks) behind the value, and the
 * value itself is a thin line ending in a tick, so the point estimate and the range read separately.
 */
export function Meter({
  value,
  range,
  tone = "accent",
  label,
  animate = false,
}: {
  value: number;
  range?: [number, number];
  tone?: "accent" | "neutral" | "success" | "warning" | "danger";
  label: string;
  /** Grow the bar on first paint (Overview only). */
  animate?: boolean;
}) {
  const fill = { accent: "bg-accent-600", neutral: "bg-zinc-500", success: "bg-emerald-600", warning: "bg-amber-600", danger: "bg-red-600" }[tone];
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const pct = (n: number) => `${clamp(n) * 100}%`;
  const aria = { role: "meter", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(value * 100) } as const;
  if (!range) {
    return (
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-100" {...aria}>
        <div className={cn("absolute inset-y-0 left-0 origin-left rounded-full", fill, animate && "animate-bar-grow")} style={{ width: pct(value) }} />
      </div>
    );
  }
  return (
    <div className="relative h-2.5 w-full rounded-full bg-zinc-100" {...aria}>
      <div className="absolute inset-y-0 rounded-sm border-x-2 border-zinc-400 bg-zinc-300/70" style={{ left: pct(range[0]), width: pct(range[1] - range[0]) }} />
      <div className={cn("absolute left-0 top-1/2 h-1 -translate-y-1/2 origin-left rounded-full", fill, animate && "animate-bar-grow")} style={{ width: pct(value) }} />
      <div className={cn("absolute -inset-y-[3px] w-0.5 -translate-x-1/2 rounded-full", fill)} style={{ left: pct(value) }} aria-hidden="true" />
    </div>
  );
}

/**
 * The end of a meter's scale, as a fraction. Below 40% the bars are stretched to the next 10%
 * (and the scale is printed next to them); above it they use 0–100%, so lengths stay honest.
 */
export function meterScale(maxHigh: number): number {
  if (maxHigh > 0.4) return 1;
  return Math.max(0.1, Math.ceil(maxHigh * 10) / 10);
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
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500">{icon}</div>}
      <h2 className="text-md font-semibold text-zinc-900">{title}</h2>
      {description && <div className="mt-1 max-w-md text-base text-zinc-500">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const tones: Record<Tone, string> = {
    neutral: "border-zinc-200 bg-zinc-50 text-zinc-700",
    outline: "border-zinc-200 bg-white text-zinc-700",
    accent: "border-accent-200 bg-accent-50 text-accent-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-800",
    info: "border-sky-200 bg-sky-50 text-sky-900",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex flex-wrap items-start justify-between gap-3 rounded-xl border px-4 py-3 text-base", tones[tone])}>
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title ? "mt-0.5" : "")}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

/* ── Forms ───────────────────────────────────────────────────────────────── */

export const inputClass =
  "h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-900 placeholder:text-zinc-500 shadow-sm " +
  "transition duration-150 hover:border-zinc-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20 " +
  "disabled:bg-zinc-50 disabled:text-zinc-500";

export const textareaClass = inputClass.replace("h-9", "min-h-[84px] py-2 leading-relaxed");

export function Field({ label, hint, htmlFor, children, hintId }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; hintId?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-700">
        {label}
      </label>
      {children}
      {hint && (
        <p id={hintId} className="text-xs text-zinc-500">
          {hint}
        </p>
      )}
    </div>
  );
}

/* ── Tables ──────────────────────────────────────────────────────────────── */

/** A table that scrolls sideways inside its card, with a fade on the right while more is hidden. */
export function Table({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <ScrollArea label={label}>
      <table className={cn("w-full text-left text-base", className)}>{children}</table>
    </ScrollArea>
  );
}

export const th = "px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 bg-zinc-50/80 border-b border-zinc-200";
export const td = "px-4 py-3 align-top border-b border-zinc-100";

/* ── Formatting ──────────────────────────────────────────────────────────── */

/** "1 search", "3 searches". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "28 Oct, 08:58" from a stored UTC timestamp ("2026-10-28 08:58:00" or ISO). Server components only. */
export function formatWhen(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

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
