/**
 * The PrismGEO mark: a prism wedge (the question) refracting into three rays of decreasing length
 * (the engines' answers, ranked). The wedge takes the brand colour; the rays follow the text colour,
 * so the mark works on any background. Source files and usage rules: docs/brand/.
 */
export function LogoMark({ className = "h-7 w-7", wedge = "fill-accent-600 stroke-accent-600" }: { className?: string; wedge?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M2.5 26.5 13 5.5v21z" className={wedge} strokeWidth="2" strokeLinejoin="round" />
      <g stroke="currentColor" strokeWidth="3.6" strokeLinecap="round">
        <path d="m17.5 11 11.5-5" />
        <path d="M17.5 16.5h9" opacity=".6" />
        <path d="m17.5 22 5.5 2.4" opacity=".4" />
      </g>
    </svg>
  );
}

/** Mark plus live-text wordmark; "GEO" is muted, mirroring the 50% opacity of the outlined lockup. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-zinc-900 ${className || ""}`}>
      <LogoMark className="h-7 w-7" />
      <span className="text-md font-semibold tracking-tight">
        Prism<span className="text-zinc-500">GEO</span>
      </span>
    </span>
  );
}
