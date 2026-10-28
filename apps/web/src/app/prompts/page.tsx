import { db, schema, eq, getActiveBrand, getRawDb } from "@prismgeo/db";
import { Compass } from "lucide-react";
import { redirect } from "next/navigation";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { PromptsClient } from "./PromptsClient";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  const brand = getActiveBrand();
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Prompts" description="The questions your buyers ask. Every audit sends each active prompt to every selected engine." />
      {prompts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Compass className="h-5 w-5" />}
            title="No prompts yet"
            description="Add the questions your buyers ask an AI assistant, or let the setup wizard draft them from your client profile."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <PromptsClient prompts={[]} addOnly />
                <LinkButton href="/setup" variant="secondary">
                  Open setup wizard
                </LinkButton>
              </div>
            }
          />
        </Card>
      ) : (
        <PromptsClient prompts={prompts} />
      )}
    </div>
  );
}
