"use client";

import { useRef, useState, useEffect } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { Button, Card, Field, IconButton, Notice, cn, inputClass, textareaClass, buttonClass } from "@/components/ui";
import { cleanDomain, cleanedHint, domainError } from "@/components/domain";

interface CompetitorInput {
  name: string;
  domain: string;
}

const STEPS = [
  { num: 1, title: "Client", desc: "Who you are" },
  { num: 2, title: "Competitors", desc: "Who you are compared with" },
  { num: 3, title: "Questions", desc: "What buyers ask AI" },
] as const;

/**
 * Three-step onboarding: client profile, competitors, and the questions to track. Engine access
 * (sessions, API keys) is configured later on Engines and in Settings, after a first audit.
 * Generated questions are shown for review on the Prompts page right after the client is created.
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
  const [category, setCategory] = useState("");
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

  const brandClean = cleanDomain(brandDomain);
  const nameValid = brandName.trim().length > 0;
  const brandDomainError = brandDomain.trim() ? domainError(brandDomain) : "Enter the website, e.g. example.com";
  const domainValid = !brandDomainError;
  const step1Valid = nameValid && domainValid;
  const [touched2, setTouched2] = useState(false);
  const rowProblem = (c: CompetitorInput): string | null => {
    const name = c.name.trim();
    const domain = c.domain.trim();
    if (!name && !domain) return null;
    if (name && !domain) return `Add ${name}'s website, or remove the row.`;
    if (!name && domain) return "Add the company name, or remove the row.";
    return domainError(domain);
  };
  const step2Valid = competitors.every((c) => !rowProblem(c));
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
      return setError(!nameValid && !domainValid ? "Enter the brand name and its website." : !nameValid ? "Enter the brand name." : `Website: ${brandDomainError}`);
    }
    if (step === 2 && !step2Valid) {
      setTouched2(true);
      return setError("Fix the highlighted competitor rows, or remove them.");
    }
    setError(null);
    setStep(step + 1);
  }

  async function finish() {
    if (!step1Valid) {
      setStep(1);
      setTouched(true);
      return setError("Enter the brand name and its website.");
    }
    if (!step3Valid) return setError("Add at least one question (5 characters or more), or let PrismGEO write them.");
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        brand: {
          name: brandName.trim(),
          domain: brandClean,
          description: description.trim(),
          ...(category.trim() ? { category: category.trim() } : {}),
          aliases: brandAliases.split(",").map((a) => a.trim()).filter(Boolean),
          valueProps: valueProps.split("\n").map((v) => v.trim()).filter(Boolean),
        },
        competitors: competitors.filter((c) => c.name.trim() && c.domain.trim()).map((c) => ({ name: c.name.trim(), domain: cleanDomain(c.domain) })),
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
      // Written questions are reviewed before the first audit; own questions were already read
      window.location.href = questionSource === "generate" ? "/prompts?review=1" : "/";
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  const current = STEPS[step - 1];

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">Add a client</h1>
        <p className="mt-1 text-base text-zinc-500">Three short steps. You can change these later in Settings.</p>
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
          <div key={step} className="space-y-5 p-5 sm:p-6">
            <div>
              <h2 ref={heading} tabIndex={-1} className="scroll-mt-24 text-lg font-semibold text-zinc-900 focus:outline-none">
                Step {step} of 3 · {current.title}
              </h2>
              <p className="text-base text-zinc-500">{current.desc}</p>
            </div>

            {error && (
              <Notice tone="danger" action={<IconButton aria-label="Dismiss error" onClick={() => setError(null)}><X className="h-4 w-4" /></IconButton>}>
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
                    className={cn(inputClass, touched && !nameValid && "border-red-400")}
                    placeholder="e.g. Acme Analytics"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                  />
                </Field>
                <Field
                  label="Website domain"
                  htmlFor="brand-domain"
                  hintId="brand-domain-hint"
                  hint={
                    <span className={touched && !domainValid ? "text-red-700" : undefined}>
                      {touched && !domainValid ? brandDomainError : cleanedHint(brandDomain) || "e.g. acme.com"}
                    </span>
                  }
                >
                  <input
                    id="brand-domain"
                    required
                    aria-invalid={touched && !domainValid}
                    aria-describedby="brand-domain-hint"
                    className={cn(inputClass, touched && !domainValid && "border-red-400")}
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
                      placeholder="e.g. Accounting software for small online shops"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field
                    label="Category (optional)"
                    htmlFor="brand-category"
                    hint="2–8 words a buyer would use for what you sell. Makes the generated questions sound natural."
                  >
                    <input
                      id="brand-category"
                      className={inputClass}
                      placeholder="e.g. accounting software for online shops"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="What makes you different (optional)" htmlFor="brand-values" hint="One per line">
                    <textarea
                      id="brand-values"
                      rows={3}
                      className={textareaClass}
                      placeholder={"e.g. Set up in 10 minutes\nWorks with Shopify and Stripe"}
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
                <ul className="space-y-3">
                  {competitors.map((c, i) => {
                    const problem = rowProblem(c);
                    const show = Boolean(problem) && (touched2 || Boolean(c.domain.trim() && c.name.trim()));
                    const hint = !problem ? cleanedHint(c.domain) : null;
                    const nameBad = show && !c.name.trim();
                    const domainBad = show && Boolean(c.name.trim());
                    return (
                      <li key={i}>
                        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                          <input
                            aria-label={`Competitor ${i + 1} name`}
                            aria-invalid={nameBad}
                            aria-describedby={show || hint ? `competitor-${i}-hint` : undefined}
                            className={cn(inputClass, nameBad && "border-red-400")}
                            placeholder="Name"
                            value={c.name}
                            onChange={(e) => setCompetitors(competitors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                          />
                          <input
                            aria-label={`Competitor ${i + 1} website`}
                            aria-invalid={domainBad}
                            aria-describedby={show || hint ? `competitor-${i}-hint` : undefined}
                            className={cn(inputClass, domainBad && "border-red-400")}
                            placeholder="example.com"
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
                        </div>
                        {(show || hint) && (
                          <p id={`competitor-${i}-hint`} className={cn("mt-1 text-xs", show ? "text-red-700" : "text-zinc-500")}>
                            {show ? problem : hint}
                          </p>
                        )}
                      </li>
                    );
                  })}
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
                      aria-valuetext={`${promptCount} questions`}
                      className="w-full accent-accent-600"
                    />
                    <p className="text-xs text-zinc-500">
                      After you create the client, the questions open on the Prompts page so you can read them and edit or pause any that don&apos;t sound
                      like your buyers, before the first audit.
                    </p>
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

                <Field
                  label="Ask each question"
                  htmlFor="repeats"
                  hint={
                    <>
                      AI answers vary between asks; asking more often gives a steadier picture. Start with 1. To re-check questions every day, turn on the
                      daily schedule in Settings → Schedule after setup (it is off until you do).
                    </>
                  }
                >
                  <select id="repeats" className={cn(inputClass, "w-32")} value={repeats} onChange={(e) => setRepeats(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? "Once" : `${n} times`}
                      </option>
                    ))}
                  </select>
                </Field>

                <Notice tone="info" title="After your first audit">
                  If an engine limits anonymous use, connect your own account on the Engines page or add a free API key in Settings, so it keeps
                  answering.
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
