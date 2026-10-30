"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, MapPin, X } from "lucide-react";
import { cn, inputClass } from "../ui";

interface Place {
  name: string;
  canonicalName: string;
  type: string;
}

/**
 * Optional city, state or postal code inside the search country, picked from Google's own
 * location list, so the name is exactly what Google (uule), DataForSEO and SerpApi accept.
 */
export function PlacePicker({ country, countryName, value, onChange }: { country: string; countryName: string; value: string; onChange: (place: string) => void }) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setPlaces([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/geo/locations?country=${encodeURIComponent(country)}&q=${encodeURIComponent(query.trim())}`).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok) {
        setPlaces(body.places || []);
        setActive(-1);
      } else setError(body.error || "The location list could not be loaded");
      setLoading(false);
    }, 250);
  }, [query, country]);

  const choose = (p: Place) => {
    onChange(p.canonicalName);
    setQuery("");
    setPlaces([]);
  };

  if (value)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent-50 px-2.5 py-1.5 text-sm font-medium text-accent-800 ring-1 ring-accent-200">
          <MapPin className="h-3.5 w-3.5" aria-hidden /> {value}
        </span>
        <button type="button" onClick={() => onChange("")} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100" aria-label="Search from the whole country instead">
          <X className="h-3.5 w-3.5" aria-hidden /> Whole {countryName}
        </button>
      </div>
    );

  return (
    <div className="relative">
      <input
        id="search-place"
        role="combobox"
        aria-expanded={places.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        className={inputClass}
        placeholder={`Whole ${countryName} (or type a city, state or postal code)`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(places.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && active >= 0 && places[active]) {
            e.preventDefault();
            choose(places[active]);
          } else if (e.key === "Escape") setPlaces([]);
        }}
      />
      {loading && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-zinc-400" aria-hidden />}
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      {places.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
          {places.map((p, i) => (
            <li
              key={p.canonicalName}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              className={cn("flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm", i === active ? "bg-accent-50" : "hover:bg-zinc-50")}
            >
              <span className="text-zinc-900">{p.canonicalName}</span>
              <span className="shrink-0 text-xs text-zinc-500">{p.type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
