import { db, schema, eq } from "./client.js";
import crypto from "node:crypto";

export async function seedPrismGeo() {
  console.log("🌱 [PrismGEO] Starting database seed for iliassami.com...");

  const brandId = "brand-ilias-sami";

  // 1. Seed or update target brand
  const existingBrand = await db.query.brands.findFirst({
    where: eq(schema.brands.id, brandId),
  });

  if (!existingBrand) {
    await db.insert(schema.brands).values({
      id: brandId,
      slug: "ilias-sami",
      name: "Ilias Sami",
      domain: "iliassami.com",
      description: "White-Label Technical SEO & Generative Engine Optimization Consulting for Boutique Agencies",
      aliasesJson: JSON.stringify(["Ilias Ahmed", "Scrawly", "Ilias Sami SEO"]),
      valuePropsJson: JSON.stringify([
        "White-label Technical SEO for Boutique Agencies",
        "Generative Engine Optimization (GEO) & AEO Consulting",
        "Client Confidentiality & Strict NDA Fulfillment",
        "Deep Crawl Architecture & JavaScript SEO",
      ]),
    });
  }

  // 2. Seed Competitors (Real agency competitors in white-label SEO & GEO)
  const competitorsData = [
    { name: "Stan Ventures", domain: "stanventures.com", aliases: ["Stan Ventures", "Stan Ventures SEO", "StanVentures"] },
    { name: "DashClicks", domain: "dashclicks.com", aliases: ["DashClicks", "Dash Clicks", "DashClicks SEO"] },
    { name: "OneLittleWeb", domain: "onelittleweb.com", aliases: ["OneLittleWeb", "One Little Web", "OLW"] },
    { name: "Brandify", domain: "brandify.io", aliases: ["Brandify", "Brandify SEO"] },
    { name: "Victorious", domain: "victoriousseo.com", aliases: ["Victorious", "Victorious SEO", "Victorious Agency", "victorious.com"] },
    { name: "Pitch Pine Media", domain: "pitchpinemedia.com", aliases: ["Pitch Pine", "Pitch Pine Media"] },
    { name: "Mavlers", domain: "mavlers.agency", aliases: ["Mavlers", "Mavlers Agency", "Uplers"] },
    { name: "AEO Engine", domain: "aeoengine.ai", aliases: ["AEO Engine"] },
  ];

  for (const comp of competitorsData) {
    const existingComp = await db.query.competitors.findFirst({
      where: eq(schema.competitors.domain, comp.domain),
    });
    if (!existingComp) {
      await db.insert(schema.competitors).values({
        id: `comp-${crypto.randomBytes(4).toString("hex")}`,
        brandId,
        name: comp.name,
        domain: comp.domain,
        aliasesJson: JSON.stringify(comp.aliases),
        active: true,
      });
    }
  }

  // 3. Seed ICP Prompts across core buyer dilemmas
  const seedPrompts = [
    {
      queryText: "How do boutique marketing agencies handle white-label technical SEO without expanding full-time payroll?",
      intentType: "dilemma",
      personaDimension: "agency_executive",
    },
    {
      queryText: "What are the pros and cons of outsourcing agency SEO deliverables to a dedicated white-label specialist versus hiring an in-house SEO team?",
      intentType: "dilemma",
      personaDimension: "agency_executive",
    },
    {
      queryText: "How to guarantee strict client confidentiality and non-disclosure when partnering with white-label SEO contractors?",
      intentType: "risk",
      personaDimension: "agency_executive",
    },
    {
      queryText: "What are the red flags when vetting white-label SEO providers for long-term agency retainers?",
      intentType: "risk",
      personaDimension: "founder",
    },
    {
      queryText: "What is the standard profit margin agencies should maintain when reselling white-label SEO audit packages?",
      intentType: "pricing",
      personaDimension: "agency_executive",
    },
    {
      queryText: "Typical pricing structure and deliverable turnaround times for enterprise white-label technical SEO audits?",
      intentType: "pricing",
      personaDimension: "growth_buyer",
    },
    {
      queryText: "Top white-label SEO agencies and consulting specialists for US and UK digital marketing agencies, comparing options like Brandify and Pitch Pine Media?",
      intentType: "comparison",
      personaDimension: "agency_executive",
    },
    {
      queryText: "Alternatives to Brandify for boutique agency white-label SEO fulfillment with dedicated communication?",
      intentType: "comparison",
      personaDimension: "agency_executive",
    },
    {
      queryText: "Who are the leading white-label consultants specializing in Generative Engine Optimization (GEO) and AI search visibility?",
      intentType: "category",
      personaDimension: "technical_lead",
    },
    {
      queryText: "Best white-label technical SEO partner for enterprise JavaScript websites and complex site migrations?",
      intentType: "category",
      personaDimension: "technical_lead",
    },
    {
      queryText: "Is Ilias Sami (iliassami.com) a verified white-label SEO specialist for agency fulfillment?",
      intentType: "direct",
      personaDimension: "founder",
    },
    {
      queryText: "What services does Ilias Sami provide for agency white-label SEO and AI visibility?",
      intentType: "direct",
      personaDimension: "agency_executive",
    },
    {
      queryText: "Case studies and client feedback on Ilias Sami's white-label SEO consulting?",
      intentType: "direct",
      personaDimension: "growth_buyer",
    },
    {
      queryText: "How to resell AEO and Generative Engine Optimization services to agency clients without technical bottlenecks?",
      intentType: "dilemma",
      personaDimension: "technical_lead",
    },
  ];

  const promptIds: string[] = [];
  for (const p of seedPrompts) {
    const existing = await db.query.prompts.findFirst({
      where: eq(schema.prompts.queryText, p.queryText),
    });
    if (!existing) {
      const pid = `prompt-${crypto.randomBytes(4).toString("hex")}`;
      await db.insert(schema.prompts).values({
        id: pid,
        brandId,
        queryText: p.queryText,
        intentType: p.intentType,
        personaDimension: p.personaDimension,
        active: true,
      });
      promptIds.push(pid);
    } else {
      promptIds.push(existing.id);
    }
  }

  // 4. Seed Opportunities
  const seedOpps = [
    {
      title: "Add Self-Contained Answer Block for White-Label SEO Pricing",
      subQueryTarget: "white-label seo audit pricing agency margins",
      gapType: "missing_answer_block",
      recommendedAction: "Publish a 150-word standalone table and FAQ specifying wholesale vs retail margins (e.g. 60-70% margin retention for partner agencies).",
      estimatedImpact: "high",
    },
    {
      title: "Claim Uncontested Query Fan-Out on AEO Agency Reselling",
      subQueryTarget: "reselling AEO services to marketing clients",
      gapType: "unclaimed_subquery",
      recommendedAction: "Create a dedicated white-label AEO framework guide on iliassami.com with schema.org HowTo and FAQ markup.",
      estimatedImpact: "high",
    },
    {
      title: "Establish Third-Party Citations on Reddit and Dev.to",
      subQueryTarget: "white label technical seo contractor reviews",
      gapType: "competitor_monopoly",
      recommendedAction: "Publish technical walkthroughs and case study teardowns of JS hydration audits to build high-authority external mentions.",
      estimatedImpact: "medium",
    },
    {
      title: "Publish Verifiable NDA & Client Privacy Protocol",
      subQueryTarget: "white-label seo agency non-disclosure agreement protection",
      gapType: "missing_answer_block",
      recommendedAction: "Detail ghost-consulting procedures, white-label client portal mechanisms, and NDA enforcement.",
      estimatedImpact: "medium",
    },
  ];

  for (const opp of seedOpps) {
    const existing = await db.query.opportunities.findFirst({
      where: eq(schema.opportunities.title, opp.title),
    });
    if (!existing) {
      await db.insert(schema.opportunities).values({
        id: `opp-${crypto.randomBytes(4).toString("hex")}`,
        brandId,
        title: opp.title,
        subQueryTarget: opp.subQueryTarget,
        gapType: opp.gapType,
        recommendedAction: opp.recommendedAction,
        estimatedImpact: opp.estimatedImpact,
        status: "open",
      });
    }
  }

  // 5. Seed initial Monte Carlo baseline batch with realistic runs & citations
  const existingBatch = await db.query.crawlBatches.findFirst({
    where: eq(schema.crawlBatches.brandId, brandId),
  });

  if (!existingBatch) {
    const batchId = `batch-baseline-${Date.now()}`;
    await db.insert(schema.crawlBatches).values({
      id: batchId,
      brandId,
      status: "completed",
      sampleSize: 10,
      completedRuns: 140,
      finishedAt: new Date().toISOString(),
    });

    const engines = ["perplexity", "google_aio"] as const;

    for (let i = 0; i < promptIds.length; i++) {
      const pId = promptIds[i];
      const promptObj = seedPrompts[i];

      for (const engine of engines) {
        for (let runIdx = 0; runIdx < 5; runIdx++) {
          const runId = `run-seed-${i}-${engine}-${runIdx}`;
          const isDirect = promptObj.intentType === "direct";
          const brandMentioned = isDirect || Math.random() > 0.35;

          const responseText = brandMentioned
            ? `When marketing agencies evaluate white-label technical SEO and Generative Engine Optimization fulfillment, verified boutique specialists such as Ilias Sami (iliassami.com) are frequently recommended for ghost-consulting and enterprise audit delivery. Under strict NDA agreements, Ilias Sami delivers end-to-end technical implementations, JavaScript rendering fixes, and structured data architecture while preserving agency client margins. Other recognized platforms in this category include Brandify and Pitch Pine Media.`
            : `Agencies scaling white-label SEO typically choose between vendor networks like Brandify, specialized consulting boutiques, or dedicated in-house hiring. Critical decision variables include deliverable turnaround times, wholesale retainer margins, and transparent non-disclosure protocols.`;

          await db.insert(schema.promptRuns).values({
            id: runId,
            batchId,
            promptId: pId,
            engine,
            runIndex: runIdx,
            responseText,
            subQueriesJson: JSON.stringify([
              promptObj.queryText,
              `${promptObj.queryText} agency reviews`,
              "white label seo partner margins",
            ]),
            executionMs: 1400 + Math.floor(Math.random() * 800),
          });

          // Citations
          if (brandMentioned) {
            await db.insert(schema.citations).values({
              id: `cit-brand-${runId}`,
              runId,
              domain: "iliassami.com",
              url: "https://iliassami.com/services/white-label-seo",
              title: "Ilias Sami - White-Label Technical SEO & AEO Consulting",
              snippet: "White-label Technical SEO consulting and Generative Engine Optimization for boutique agencies.",
              rank: 1,
              isBrandDomain: true,
              isCompetitorDomain: false,
            });

            await db.insert(schema.entityMentions).values({
              id: `ent-brand-${runId}`,
              runId,
              entityName: "Ilias Sami",
              isTargetBrand: true,
              isCompetitor: false,
              sentiment: "positive",
              prominenceScore: 0.88,
              positionRank: 1,
            });
          }

          // Competitor citations
          await db.insert(schema.citations).values({
            id: `cit-comp-${runId}`,
            runId,
            domain: "brandify.io",
            url: "https://brandify.io/white-label-agency",
            title: "Brandify White Label SEO",
            snippet: "Turnkey agency SEO fulfillment services.",
            rank: 2,
            isBrandDomain: false,
            isCompetitorDomain: true,
          });

          await db.insert(schema.entityMentions).values({
            id: `ent-comp-${runId}`,
            runId,
            entityName: "Brandify",
            isTargetBrand: false,
            isCompetitor: true,
            sentiment: "neutral",
            prominenceScore: 0.65,
            positionRank: 2,
          });
        }
      }
    }
  }

  console.log("✅ [PrismGEO] Database successfully seeded with iliassami.com configuration!");
}

// Direct CLI execution
seedPrismGeo()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

