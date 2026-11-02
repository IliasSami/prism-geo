import { NextResponse } from "next/server";
import type { z } from "zod";
import { ENGINES } from "@prismgeo/core";

/**
 * Shared response helpers for the API routes. Every error leaves as { error: string } with a
 * message written for the person using the dashboard; SQLite messages, stack traces and file
 * paths are logged on the server (logs/prismgeo.log next to the database) and never sent to the client.
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
  id: "ID",
  brandId: "Client ID",
  batchId: "Audit ID",
  proxyUrl: "Proxy URL",
  sampleSize: "Runs per question",
  promptLimit: "Number of questions",
  scheduleEnabled: "Daily audit",
  schedulePromptsPerDay: "Questions per day",
  scheduleHour: "Start hour",
  scheduleTimeZone: "Time zone",
  strictLocation: "Only search from here",
  providerLocation: "Search country",
  providerLanguage: "Language",
  searchPlace: "Place",
  ...Object.fromEntries(Object.values(ENGINES).map((e) => [e.id, e.label])),
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

const TYPE_WORDS: Record<string, string> = {
  string: "text",
  number: "a number",
  int: "a whole number",
  boolean: "true or false",
  array: "a list",
  object: "an object",
};

/** One issue as a sentence; zod's own wording ("Invalid input: expected string…") is rewritten. */
function describeIssue(issue: z.core.$ZodIssue): string {
  const label = fieldLabel(issue.path);
  const lastKey = [...issue.path].reverse().find((p) => typeof p === "string") as string | undefined;
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.map((k) => `"${k}"`).join(", ");
    const where = label ? ` in ${label}` : "";
    return `${issue.keys.length > 1 ? "Unknown fields" : "Unknown field"}${where}: ${keys}. Remove ${issue.keys.length > 1 ? "them" : "it"} and try again.`;
  }
  let message = issue.message;
  if (/^Invalid input(:|$)/.test(message)) {
    const subject = label || "A value";
    if (issue.code === "invalid_type") {
      message = /received undefined/.test(message) ? `${subject} is required` : `${subject} must be ${TYPE_WORDS[issue.expected] ?? issue.expected}`;
    } else {
      message = `${subject} is not valid`;
    }
    return message;
  }
  if (!label) return message;
  // The message already names the field ("Proxy URL must…", "scheduleEnabled must…"): do not repeat it
  const lower = message.toLowerCase();
  const bare = lower.replace(/^the /, "");
  if (lastKey && message.startsWith(`${lastKey} `)) return `${label}${message.slice(lastKey.length)}`;
  if (bare.startsWith(label.toLowerCase())) return message;
  const lastWord = lastKey ? (FIELD_WORDS[lastKey] ?? lastKey).toLowerCase() : "";
  if (lastWord && bare.startsWith(lastWord) && !/\d/.test(label)) return message;
  return `${label}: ${message}`;
}

/** One readable sentence from the first validation issues, e.g. "Competitor 2 website: Enter a domain like example.com". */
export function describeIssues(error: z.ZodError): string {
  return error.issues.slice(0, 3).map(describeIssue).join("; ");
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
