import { NextResponse } from "next/server";
import type { z } from "zod";

/**
 * Shared response helpers for the API routes. Every error leaves as { error: string } with a
 * message written for the person using the dashboard; SQLite messages, stack traces and file
 * paths are logged on the server (data/logs/prismgeo.log) and never sent to the client.
 */

export type ErrorBody = { error: string } & Record<string, unknown>;

export function jsonError(error: string, status: number, extra: Record<string, unknown> = {}): NextResponse<ErrorBody> {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Logs the real error with its route and returns a generic message (409 for constraint conflicts). */
export function serverError(route: string, err: unknown): NextResponse<ErrorBody> {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[api] ${route} failed:`, err);
  if (/UNIQUE constraint failed/i.test(message)) {
    return jsonError("That already exists. Use a different name or domain.", 409);
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return jsonError("This refers to something that no longer exists. Reload the page and try again.", 409);
  }
  if (/database is locked|SQLITE_BUSY/i.test(message)) {
    return jsonError("The database is busy (an audit may be saving results). Try again in a few seconds.", 503);
  }
  return jsonError("Something went wrong on the server. Details are in the PrismGEO log (Settings → Data).", 500);
}

/** Wraps a route handler so an unexpected exception becomes a friendly 500 instead of a raw message. */
export function route<A extends unknown[]>(name: string, handler: (...args: A) => Promise<Response> | Response) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      return serverError(name, err);
    }
  };
}

/** The JSON body as a plain object, or null when it is missing, invalid or not an object. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => undefined);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Words for body fields, so errors read "Question 2: …" rather than "prompts.1: …". */
const FIELD_WORDS: Record<string, string> = {
  prompts: "Question",
  competitors: "Competitor",
  aliases: "Other name",
  valueProps: "Difference",
  domain: "website",
  name: "name",
  query: "",
  queryText: "",
  brand: "",
  crawler: "",
  engines: "Engine",
  byok: "API key",
};

function fieldLabel(path: PropertyKey[]): string {
  const parts: string[] = [];
  for (const seg of path) {
    if (typeof seg === "number") {
      if (parts.length) parts[parts.length - 1] = `${parts[parts.length - 1]} ${seg + 1}`;
      continue;
    }
    const key = String(seg);
    const word = key in FIELD_WORDS ? FIELD_WORDS[key] : key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    if (word) parts.push(word);
  }
  const label = parts.join(" ").trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "";
}

/** One readable sentence from the first validation issues, e.g. "Competitor 2 website: Enter a domain like example.com". */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => {
      const label = fieldLabel(issue.path);
      return label ? `${label}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse<ErrorBody> };

/** Reads and validates a JSON object body. On failure the response is a 400 naming the field. */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<Parsed<z.output<S>>> {
  const body = await readJsonObject(request);
  if (!body) return { ok: false, response: jsonError("Send a JSON object as the request body", 400) };
  const result = schema.safeParse(body);
  if (!result.success) return { ok: false, response: jsonError(describeIssues(result.error), 400) };
  return { ok: true, data: result.data };
}
