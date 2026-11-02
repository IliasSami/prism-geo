/**
 * Input limits shared by the API routes and the forms that send to them, so the browser can say
 * what is wrong before a request is made. No server-only imports: client components use this file.
 */
export const LIMITS = {
  name: 120,
  description: 2000,
  alias: 120,
  aliases: 20,
  valueProp: 300,
  valueProps: 20,
  competitors: 50,
  promptMin: 5,
  promptMax: 500,
  prompts: 200,
  label: 40,
  apiKey: 300,
  proxyUrl: 2000,
} as const;

export interface QuestionLines {
  /** Lines that will be sent (trimmed, LIMITS.promptMin characters or more). */
  questions: string[];
  /** Non-empty lines under LIMITS.promptMin characters; they are ignored. */
  ignored: number;
  /** Lines over LIMITS.promptMax characters, by their line number in the text box (1-based). */
  tooLong: Array<{ line: number; length: number }>;
}

/** Reads a "one question per line" text box the way the server will take it. */
export function questionLines(text: string): QuestionLines {
  const out: QuestionLines = { questions: [], ignored: 0, tooLong: [] };
  text.split("\n").forEach((raw, i) => {
    const q = raw.trim();
    if (!q) return;
    if (q.length < LIMITS.promptMin) out.ignored++;
    else {
      out.questions.push(q);
      if (q.length > LIMITS.promptMax) out.tooLong.push({ line: i + 1, length: q.length });
    }
  });
  return out;
}

/** "Line 3 is 612 characters; questions can be at most 500." or null when every line fits. */
export function tooLongMessage(tooLong: QuestionLines["tooLong"]): string | null {
  if (!tooLong.length) return null;
  const [first] = tooLong;
  if (tooLong.length === 1) return `Line ${first.line} is ${first.length} characters; questions can be at most ${LIMITS.promptMax}. Shorten it to add it.`;
  const lines = tooLong.map((t) => t.line);
  return `Lines ${lines.slice(0, -1).join(", ")} and ${lines[lines.length - 1]} are over ${LIMITS.promptMax} characters, the most a question can have. Shorten them to add them.`;
}
