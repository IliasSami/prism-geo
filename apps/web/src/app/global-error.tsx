"use client";

import "./globals.css";
import { useEffect } from "react";

/**
 * The root layout itself failed (it reads SQLite for the header, so a locked or missing database
 * lands here). It replaces the whole document, so it brings its own <html> and <body>.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="text-lg font-semibold">PrismGEO couldn&apos;t load</h1>
          <p className="text-sm leading-relaxed text-zinc-600">
            Something went wrong on the server while reading your data (the database may be busy or unreachable). Nothing was changed.
          </p>
          {error.digest && <p className="text-xs text-zinc-500">Reference: {error.digest}. The details are in data/logs/prismgeo.log.</p>}
          <button
            type="button"
            onClick={reset}
            className="mt-2 inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
