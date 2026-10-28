"use client";

import { useRef, useState, useEffect } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button, Card, Field, IconButton, Notice, cn, inputClass, textareaClass, buttonClass } from "@/components/ui";

interface CompetitorInput {
  name: string;
  domain: string;
}

const STEPS = [
  { num: 1, title: "Client", desc: "Who you are" },
  { num: 2, title: "Competitors", desc: "Who you are compared with" },
  { num: 3, title: "Questions", desc: "What buyers ask AI" },
] as const;

const cleanDomainOf = (raw: string) =>
  raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/**
 * Three-step onboarding: client profile, competitors, and the questions to track. Engine access
 * (sessions, API keys) is configured later in Settings → Engines & access, after a first audit.
 */
export default function SetupWizardPage() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Step 1
  const [brandName, setBrandName] = useState("");
  const [brandDomain, setBrandDomain] = useState("");
  const [brandAliases, setBrandAliases] = useState("");
  const [description, setDescription] = useState("");
  const [valueProps, setValueProps] = useState("");
  const [touched, setTouched] = useState(false);

  // Step 2
  const [competitors, setCompetitors] = useState<CompetitorInput[]>([
    { name: "", domain: "" },
    { name: "", domain: "" },
  ]);

  // Step 3
  const [questionSource, setQuestionSource] = useState<"generate" | "own">("generate");
  const [promptCount, setPromptCount] = useState(10);
  const [ownQuestions, setOwnQuestions] = useState("");
  const [repeats, setRepeats] = useState(1);

  const cleanDomain = cleanDomainOf(brandDomain);
  const nameValid = brandName.trim().length > 0;
  const domainValid = cleanDomain.includes(".");
  const step1Valid = nameValid && domainValid;
  const halfFilled = competitors.some((c) => Boolean(c.name.trim()) !== Boolean(c.domain.trim()));
  const ownList = ownQuestions
    .split("\n")
    .map((q) => q.trim())
    .filter((q) => q.length >= 5);
  const step3Valid = questionSource === "generate" || ownList.length > 0;

  // Move focus to the step title so keyboard and screen-reader users land on the new step
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  function next() {
    if (step === 1 && !step1Valid) {
      setTouched(true);
      return setError("Enter the brand name and a domain like example.com.");
    }
    if (step === 2 && halfFilled) return setError("Complete or remove the competitor rows that have only a name or only a domain.");
    setError(null);
    setStep(step + 1);
  }

  async function finish() {
    if (!step1Valid) {
      setStep(1);
      return setError("Enter the brand name and a domain like example.com.");
    }
    if (!step3Valid) return setError("Add at least one question (5 characters or more), or let PrismGEO write them.");
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        brand: {
          name: brandName.trim(),
          domain: cleanDomain,
          description: description.trim(),
          aliases: brandAliases.split(",").map((a) => a.trim()).filter(Boolean),
          valueProps: valueProps.split("\n").map((v) => v.trim()).filter(Boolean),
        },
        competitors: competitors.filter((c) => c.name.trim() && c.domain.trim()),
        crawler: { sampleSize: repeats },
        ...(questionSource === "own"
          ? { prompts: ownList.map((query) => ({ query, intent: "category", persona: "buyer" })) }
          : { promptLimit: promptCount }),
      };
      const res = await fetch("/api/setup/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not create the client");
      window.location.href = "/";
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  const current = STEPS[step - 1];

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2">
      <header className="animate-fade-up">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">Add a client</h1>
        <p className="mt-1 text-base text-zinc-500">Three short steps. You can change everything later in Settings.</p>
      </header>

      {/* Progress */}
      <nav aria-label="Setup progress">
        <ol className="grid grid-cols-3 gap-2">
          {STEPS.map((s) => {
            const done = step > s.num;
            const isCurrent = step === s.num;
            return (
              <li key={s.num}>
                <button
                  type="button"
                  onClick={() => s.num < step && (setError(null), setStep(s.num))}
                  disabled={s.num >= step}
                  aria-current={isCurrent ? "step" : undefined}
                  className="group flex w-full flex-col gap-2 text-left disabled:cursor-default"
                >
                  <span className={cn("h-1 w-full rounded-full transition-colors duration-300", done || isCurrent ? "bg-accent-600" : "bg-zinc-200")} />
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition",
                        done ? "bg-accent-600 text-white" : isCurrent ? "bg-accent-50 text-accent-700 ring-1 ring-accent-500" : "bg-zinc-100 text-zinc-500"
                      )}
                    >
                      {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : s.num}
                    </span>
                    <span className={cn("text-sm font-medium", isCurrent ? "text-zinc-900" : "text-zinc-500", done && "group-hover:text-zinc-900")}>
                      {s.title}
                      {done && <span className="sr-only"> (completed)</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <Card className="overflow-hidden">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (step < 3) next();
            else finish();
          }}
        >
          <div key={step} className="space-y-5 p-5 sm:p-6 animate-fade-up">
            <div>
              <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold text-zinc-900 focus:outline-none">
                Step {step} of 3 · {current.title}
              </h2>
              <p className="text-base text-zinc-500">{current.desc}</p>
            </div>

            {error && (
              <Notice tone="danger" action={<IconButton aria-label="Dismiss error" onClick={() => setError(null)}>×</IconButton>}>
                {error}
              </Notice>
            )}

            {step === 1 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Brand name" htmlFor="brand-name">
                  <input
                    id="brand-name"
                    autoFocus
                    required
                    aria-invalid={touched && !nameValid}
                    className={cn(inputClass, touched && !nameValid && "border-red-300")}
                    placeholder="e.g. Acme Analytics"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                  />
                </Field>
                <Field label="Website domain" htmlFor="brand-domain" hint={touched && !domainValid ? "Enter a domain like example.com" : "e.g. acme.com"}>
                  <input
                    id="brand-domain"
                    required
                    aria-invalid={touched && !domainValid}
                    className={cn(inputClass, "font-mono", touched && !domainValid && "border-red-300")}
                    placeholder="acme.com"
                    value={brandDomain}
                    onChange={(e) => setBrandDomain(e.target.value)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Other names (optional)" htmlFor="brand-aliases" hint="Comma separated, e.g. Acme, Acme App">
                    <input id="brand-aliases" className={inputClass} value={brandAliases} onChange={(e) => setBrandAliases(e.target.value)} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="What you do" htmlFor="brand-description" hint="One or two sentences. PrismGEO writes the buyer questions from this.">
                    <textarea
                      id="brand-description"
                      rows={2}
                      className={textareaClass}
                      placeholder="e.g. AI voice agents that call shoppers who abandon checkout"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="What makes you different (optional)" htmlFor="brand-values" hint="One per line">
                    <textarea
                      id="brand-values"
                      rows={3}
                      className={textareaClass}
                      placeholder={"e.g. Calls within 5 minutes\nWorks with Shopify and Klaviyo"}
                      value={valueProps}
                      onChange={(e) => setValueProps(e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <p className="text-base text-zinc-600">Add the companies buyers compare you with. You can skip this and add them later.</p>
                <ul className="space-y-2">
                  {competitors.map((c, i) => (
                    <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                      <input
                        aria-label={`Competitor ${i + 1} name`}
                        className={inputClass}
                        placeholder="Name"
                        value={c.name}
                        onChange={(e) => setCompetitors(competitors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      />
                      <input
                        aria-label={`Competitor ${i + 1} domain`}
                        className={cn(inputClass, "font-mono")}
                        placeholder="domain.com"
                        value={c.domain}
                        onChange={(e) => setCompetitors(competitors.map((x, j) => (j === i ? { ...x, domain: e.target.value } : x)))}
                      />
                      <IconButton
                        aria-label={`Remove competitor ${i + 1}`}
                        tone="danger"
                        disabled={competitors.length === 1}
                        onClick={() => setCompetitors(competitors.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
                <Button size="sm" variant="ghost" onClick={() => setCompetitors([...competitors, { name: "", domain: "" }])}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Add another
                </Button>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <legend className="sr-only">Where the questions come from</legend>
                  {[
                    { id: "generate" as const, title: "Write them for me", desc: `From ${brandName.trim() || "your"} profile and competitors.` },
                    { id: "own" as const, title: "I have my own", desc: "Paste the questions your buyers ask." },
                  ].map((o) => (
                    <label
                      key={o.id}
                      className={cn(
                        "relative cursor-pointer rounded-xl border p-4 transition duration-150",
                        questionSource === o.id ? "border-accent-500 bg-accent-50/60 ring-1 ring-accent-500" : "border-zinc-200 hover:border-zinc-300"
                      )}
                    >
                      <input
                        type="radio"
                        name="question-source"
                        className="peer sr-only"
                        checked={questionSource === o.id}
                        onChange={() => setQuestionSource(o.id)}
                      />
                      <span className="block font-semibold text-zinc-900">{o.title}</span>
                      <span className="mt-0.5 block text-sm text-zinc-600">{o.desc}</span>
                      <span className="pointer-events-none absolute inset-0 rounded-xl peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 peer-focus-visible:ring-offset-2" />
                    </label>
                  ))}
                </fieldset>

                {questionSource === "generate" ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label htmlFor="prompt-count" className="text-sm font-medium text-zinc-700">
                        How many questions
                      </label>
                      <span className="font-semibold tabular text-zinc-900">{promptCount}</span>
                    </div>
                    <input
                      id="prompt-count"
                      type="range"
                      min={5}
                      max={50}
                      step={5}
                      value={promptCount}
                      onChange={(e) => setPromptCount(Number(e.target.value))}
                      className="w-full accent-accent-600"
                    />
                    <p className="text-xs text-zinc-500">You can review, edit and pause each one on the Prompts page before the first audit.</p>
                  </div>
                ) : (
                  <Field label="Your questions" htmlFor="own-questions" hint={`One per line, written the way a buyer would ask an AI assistant. ${ownList.length} ready.`}>
                    <textarea
                      id="own-questions"
                      rows={6}
                      className={textareaClass}
                      placeholder={"e.g. what's the best way to recover abandoned checkouts on shopify?\nis there a tool that calls customers who abandon carts?"}
                      value={ownQuestions}
                      onChange={(e) => setOwnQuestions(e.target.value)}
                    />
                  </Field>
                )}

                <Field label="Repeats per question" htmlFor="repeats" hint="Answers vary between runs. Start with 1 and let the daily schedule add more over time.">
                  <select id="repeats" className={cn(inputClass, "w-32")} value={repeats} onChange={(e) => setRepeats(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}×
                      </option>
                    ))}
                  </select>
                </Field>

                <Notice tone="info" title="After your first audit">
                  Connect your own engine accounts or add free API keys in Settings → Engines &amp; access, so engines that rate-limit
                  anonymous use keep answering.
                </Notice>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/60 px-5 py-4 sm:px-6">
            {step > 1 ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setError(null);
                  setStep(step - 1);
                }}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back
              </Button>
            ) : (
              <Link href="/" className={buttonClass("ghost")}>
                Cancel
              </Link>
            )}
            {step < 3 ? (
              <Button type="submit" variant="primary">
                Continue
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            ) : (
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                {submitting ? "Creating client…" : "Create client"}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
