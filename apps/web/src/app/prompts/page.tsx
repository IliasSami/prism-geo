import { db, schema, eq, getRawDb } from "@prismgeo/db";
import { activeBrandFromCookies } from "@/app/api/_lib/brand";
import { Compass } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { RunAuditButton } from "@/components/CrawlModal";
import { PromptsClient } from "./PromptsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prompts" };

export default async function PromptsPage({ searchParams }: { searchParams: Promise<{ review?: string }> }) {
  const params = await searchParams;
  const brand = await activeBrandFromCookies();
  // Without a workspace there is nothing to show (and unscoped queries would mix brands)
  if (!brand) redirect("/setup");
  const rawPrompts = await db.query.prompts.findMany({
    where: eq(schema.prompts.brandId, brand.id),
  });
  // Captured answers per prompt: a prompt's wording is locked once it has answers
  const runCounts = new Map(
    (getRawDb().prepare("SELECT prompt_id, COUNT(*) AS n FROM prompt_runs WHERE brand_id = ? GROUP BY prompt_id").all(brand.id) as Array<{
      prompt_id: string;
      n: number;
    }>).map((r) => [r.prompt_id, Number(r.n)])
  );
  const prompts = rawPrompts.map((p) => ({ ...p, runCount: runCounts.get(p.id) || 0 }));
  const review = params.review === "1" && prompts.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Prompts" description="The questions your buyers ask. Every audit sends each active prompt to every selected engine." />
      {review && (
        <Notice
          tone="accent"
          title={`PrismGEO wrote ${prompts.length} ${prompts.length === 1 ? "question" : "questions"} for ${brand.name}`}
          action={<RunAuditButton label="They look right: run an audit" />}
        >
          Read them before the first audit: they are what every number is measured on. Edit any that don&apos;t sound like your buyers, pause the ones that
          don&apos;t fit, or add your own.
        </Notice>
      )}
      {prompts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Compass className="h-5 w-5" />}
            title="No prompts yet"
            description="Add the questions your buyers ask an AI assistant, or let the setup wizard draft them from your client profile."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <PromptsClient prompts={[]} addOnly brandId={brand.id} />
                <LinkButton href="/setup" variant="secondary">
                  Open setup wizard
                </LinkButton>
              </div>
            }
          />
        </Card>
      ) : (
        <PromptsClient prompts={prompts} brandId={brand.id} />
      )}
    </div>
  );
}
