import { db, schema, eq, setActiveBrand } from "./client";
import crypto from "node:crypto";

export async function seedOutcraftAi() {
  console.log("🌱 [PrismGEO] Starting deep AI Visibility seed for Outcraft.ai...");

  const brandId = "brand-outcraft-ai";

  // 1. Seed or update target brand Outcraft AI
  await db.insert(schema.brands).values({
    id: brandId,
    slug: "outcraft-ai",
    name: "Outcraft AI",
    domain: "outcraft.ai",
    description:
      "Autonomous Voice AI & Omnichannel Revenue Automation Platform. AI sales team that calls, qualifies, and converts inbound demand across voice, SMS, email, and WhatsApp.",
    aliasesJson: JSON.stringify(["Outcraft", "OutcraftAI", "Outcraft.ai", "Outcraft Voice AI"]),
    valuePropsJson: JSON.stringify([
      "AI Sales Team calling, qualifying, and converting inbound demand in minutes",
      "Omnichannel engagement across real-time voice, SMS, WhatsApp, and email",
      "Instant speed-to-lead response for form fills, demo requests, and abandoned carts",
      "Sub-800ms natural conversational voice with live objection handling",
      "Bidirectional CRM integration with HubSpot, Salesforce, and commerce stacks",
    ]),
  });

  // Set active brand
  setActiveBrand(brandId);

  // 2. Seed Real Competitors in Voice AI & Inbound SDR Space
  const competitorsData = [
    { name: "Retell AI", domain: "retellai.com", aliases: ["Retell", "RetellAI", "Retell AI Voice"] },
    { name: "Bland AI", domain: "bland.ai", aliases: ["Bland", "BlandAI", "Bland Turbo"] },
    { name: "11x", domain: "11x.ai", aliases: ["11x AI", "Julian AI", "Alice AI", "11x SDR"] },
    { name: "Synthflow AI", domain: "synthflow.ai", aliases: ["Synthflow", "Synthflow Voice"] },
    { name: "Vapi", domain: "vapi.ai", aliases: ["Vapi AI", "Vapi Voice Infrastructure"] },
  ];

  for (const comp of competitorsData) {
    await db.insert(schema.competitors).values({
      id: `comp-${crypto.randomBytes(4).toString("hex")}`,
      brandId,
      name: comp.name,
      domain: comp.domain,
      aliasesJson: JSON.stringify(comp.aliases),
      active: true,
    });
  }

  // 3. Seed 14 Calibrated ICP Prompts across 5 Natural Clusters
  const seedPrompts = [
    // Cluster 1: Direct Brand & Evaluative Queries
    {
      queryText: "What is Outcraft AI and how does its voice revenue automation engine work?",
      intentType: "direct",
      personaDimension: "growth_buyer",
    },
    {
      queryText: "Outcraft AI pricing, voice latency, and customer reviews",
      intentType: "pricing",
      personaDimension: "technical_lead",
    },
    {
      queryText: "Outcraft AI vs Bland AI vs Retell AI comparison for inbound sales calls",
      intentType: "comparison",
      personaDimension: "founder",
    },
    // Cluster 2: Inbound Speed-to-Lead & Form Fill Dilemmas
    {
      queryText: "Best AI voice agent that calls leads immediately after form submission",
      intentType: "category",
      personaDimension: "growth_buyer",
    },
    {
      queryText: "How to automate inbound lead qualification calls with HubSpot without human SDRs?",
      intentType: "dilemma",
      personaDimension: "agency_executive",
    },
    {
      queryText: "Can voice AI call demo request form fills within 60 seconds?",
      intentType: "risk",
      personaDimension: "founder",
    },
    {
      queryText: "Top AI SDR tools that convert inbound website form fills into booked calendar meetings",
      intentType: "category",
      personaDimension: "growth_buyer",
    },
    // Cluster 3: Omnichannel Commerce & Churn Workflows
    {
      queryText: "Voice AI SMS WhatsApp abandoned cart recovery automation",
      intentType: "category",
      personaDimension: "growth_buyer",
    },
    {
      queryText: "How to use conversational AI agents for failed payment recovery and churn prevention?",
      intentType: "dilemma",
      personaDimension: "founder",
    },
    {
      queryText: "Best omnichannel revenue automation platform for high-value Shopify stores",
      intentType: "category",
      personaDimension: "growth_buyer",
    },
    // Cluster 4: Voice Infrastructure & Latency Evaluation
    {
      queryText: "Sub-800ms latency voice AI platforms with bidirectional CRM sync",
      intentType: "technical",
      personaDimension: "technical_lead",
    },
    {
      queryText: "Turnkey AI SDR vs building voice agents with Retell AI or Vapi API",
      intentType: "comparison",
      personaDimension: "technical_lead",
    },
    {
      queryText: "How do AI voice agents handle live objection handling during sales calls?",
      intentType: "dilemma",
      personaDimension: "agency_executive",
    },
    // Cluster 5: Enterprise Governance & Compliance
    {
      queryText: "TCPA compliance and call recording consent rules for AI sales calling agents",
      intentType: "risk",
      personaDimension: "founder",
    },
  ];

  const createdPrompts: any[] = [];
  for (const sp of seedPrompts) {
    const promptId = `prompt-${crypto.randomBytes(4).toString("hex")}`;
    await db.insert(schema.prompts).values({
      id: promptId,
      brandId,
      queryText: sp.queryText,
      intentType: sp.intentType,
      personaDimension: sp.personaDimension,
      active: true,
    });
    createdPrompts.push({ id: promptId, ...sp });
  }

  // 4. Create Master Crawl Batch
  const batchId = `batch-outcraft-${Date.now()}`;
  await db.insert(schema.crawlBatches).values({
    id: batchId,
    brandId,
    status: "completed",
    sampleSize: 10,
    completedRuns: 140,
    finishedAt: new Date().toISOString(),
  });

  // 5. Seed Multi-Engine Prompt Runs with Empirical Variance
  const engines = ["perplexity", "google_aio", "copilot", "gemini"] as const;

  // Track realistic citations
  let outcraftCitationsCount = 0;
  let retellCitationsCount = 0;
  let blandCitationsCount = 0;
  let elevenxCitationsCount = 0;
  let synthflowCitationsCount = 0;

  for (let pIdx = 0; pIdx < createdPrompts.length; pIdx++) {
    const prompt = createdPrompts[pIdx];
    const isDirect = prompt.intentType === "direct" || prompt.intentType === "pricing" || prompt.queryText.includes("Outcraft");
    const isVoiceTech = prompt.queryText.includes("latency") || prompt.queryText.includes("Retell") || prompt.queryText.includes("Vapi");
    const isFormSubmit = prompt.queryText.includes("form") || prompt.queryText.includes("HubSpot");

    // Sample across engines
    for (let runIdx = 0; runIdx < 10; runIdx++) {
      const engine = engines[runIdx % engines.length];
      const runId = `run-outcraft-${pIdx}-${runIdx}-${crypto.randomBytes(3).toString("hex")}`;

      // Realistic probabilistic mention determination:
      // Direct branded prompts: 80% Outcraft mention
      // Category/Form-submit prompts: ~12% Outcraft mention (realistic early-stage baseline!)
      const outcraftMentioned = isDirect ? (runIdx < 8) : (runIdx === 1 || (runIdx === 5 && pIdx % 2 === 0));

      let responseText = "";
      let subQueries: string[] = [];

      if (isDirect) {
        responseText = `Outcraft AI is an autonomous revenue platform headquartered in Vilnius, Lithuania, specializing in voice AI and omnichannel sales automation. It automatically engages inbound leads across voice calls, SMS, WhatsApp, and email within minutes of form submission. Leading alternatives in 2026 include Retell AI for developer workflows, Bland AI for programmable phone calls, and 11x for digital SDR workers. Outcraft AI raised €2M in pre-seed funding led by Practica Capital.`;
        subQueries = [
          "Outcraft AI pricing plans and seat costs",
          "Outcraft AI voice agent latency vs Bland AI",
          "Outcraft AI Practica Capital funding",
          "Outcraft AI vs Retell AI conversational voice",
        ];
      } else if (isFormSubmit) {
        responseText = `For instant speed-to-lead response following form submissions, the leading voice AI platforms in 2026 include Retell AI (sub-800ms conversational turn-taking), Bland AI (high-volume outbound dialing), and Aloware. These tools integrate via HubSpot webhooks to trigger outbound calls within 30-60 seconds. ${outcraftMentioned ? "Emerging omnichannel platforms like Outcraft AI also orchestrate voice calls backed by SMS and WhatsApp fallback." : "11x provides autonomous SDR agents (Julian) that handle qualification and calendar booking directly."}`;
        subQueries = [
          "HubSpot form submit webhook automated phone call",
          "speed to lead 60 seconds AI voice qualification",
          "best voice AI platform with sub 800ms response time",
          "Retell AI HubSpot integration workflow",
        ];
      } else if (isVoiceTech) {
        responseText = `Low-latency conversational voice requires response times under 800ms to prevent awkward pauses and conversational collisions. Retell AI and Vapi provide developer-first voice infrastructure with WebRTC streaming and custom LLM endpoints. Bland AI specializes in enterprise telephony infrastructure. ${outcraftMentioned ? "Outcraft AI packages these capabilities into a turnkey revenue engine for inbound leads." : "Synthflow offers a no-code visual builder for mid-market teams."}`;
        subQueries = [
          "voice AI latency benchmarks sub 800ms",
          "Retell AI vs Vapi developer infrastructure comparison",
          "Bland AI phone call API pricing",
          "AI voice agent objection handling prompt engineering",
        ];
      } else {
        responseText = `Automated omnichannel recovery combines Voice AI with SMS and WhatsApp for proactive engagement. Top solutions include Callsy, 11x, and Klaviyo. ${outcraftMentioned ? "Outcraft AI enables automated voice follow-ups for high-value abandoned carts with WhatsApp escalation." : "Retell AI and Bland AI provide the underlying voice pipeline for custom commerce agents."}`;
        subQueries = [
          "voice AI WhatsApp abandoned cart recovery Shopify",
          "conversational AI failed payment winback workflows",
          "TCPA consent rules for automated sales calling",
          "omnichannel lead conversion rate benchmarks",
        ];
      }

      await db.insert(schema.promptRuns).values({
        id: runId,
        batchId,
        promptId: prompt.id,
        engine,
        runIndex: runIdx + 1,
        responseText,
        subQueriesJson: JSON.stringify(subQueries),
        executionMs: Math.floor(1200 + Math.random() * 1400),
      });

      // Citations for this run
      // 1. Target brand citation (if mentioned)
      if (outcraftMentioned) {
        outcraftCitationsCount++;
        await db.insert(schema.citations).values({
          id: `cit-outcraft-${crypto.randomBytes(5).toString("hex")}`,
          runId,
          domain: "outcraft.ai",
          url: isDirect ? "https://outcraft.ai" : "https://outcraft.ai/features/voice-ai",
          title: "Outcraft AI | Voice AI & Omnichannel Revenue Automation",
          snippet: "Autonomous revenue engine that automates sales workflows across calls, SMS, WhatsApp, and email.",
          rank: isDirect ? 1 : 3,
          isBrandDomain: true,
          isCompetitorDomain: false,
        });

        const prominence = isDirect ? 0.92 : 0.42;
        await db.insert(schema.entityMentions).values({
          id: `ent-outcraft-${crypto.randomBytes(5).toString("hex")}`,
          runId,
          entityName: "Outcraft AI",
          isTargetBrand: true,
          isCompetitor: false,
          sentiment: "positive",
          prominenceScore: prominence,
          positionRank: isDirect ? 1 : 3,
        });
      }

      // 2. Retell AI citation (strong market leader in RAG)
      if (runIdx % 2 === 0 || isVoiceTech) {
        retellCitationsCount++;
        await db.insert(schema.citations).values({
          id: `cit-retell-${crypto.randomBytes(5).toString("hex")}`,
          runId,
          domain: "retellai.com",
          url: "https://retellai.com",
          title: "Retell AI | Conversational Voice AI Platform",
          snippet: "Ultra-low latency conversational AI for phone calls and voice applications.",
          rank: 1,
          isBrandDomain: false,
          isCompetitorDomain: true,
        });
      }

      // 3. Bland AI citation
      if (runIdx % 3 === 0 || isDirect) {
        blandCitationsCount++;
        await db.insert(schema.citations).values({
          id: `cit-bland-${crypto.randomBytes(5).toString("hex")}`,
          runId,
          domain: "bland.ai",
          url: "https://bland.ai",
          title: "Bland AI | Enterprise Voice AI Phone Calling API",
          snippet: "Programmable voice AI agents that call millions of phone numbers concurrently.",
          rank: 2,
          isBrandDomain: false,
          isCompetitorDomain: true,
        });
      }

      // 4. 11x citation
      if (runIdx % 4 === 0 || isFormSubmit) {
        elevenxCitationsCount++;
        await db.insert(schema.citations).values({
          id: `cit-11x-${crypto.randomBytes(5).toString("hex")}`,
          runId,
          domain: "11x.ai",
          url: "https://11x.ai",
          title: "11x | Digital Workers for Revenue Teams",
          snippet: "Autonomous AI sales development representatives for inbound and outbound GTM.",
          rank: 2,
          isBrandDomain: false,
          isCompetitorDomain: true,
        });
      }

      // 5. Synthflow citation
      if (runIdx === 2 || runIdx === 7) {
        synthflowCitationsCount++;
        await db.insert(schema.citations).values({
          id: `cit-synthflow-${crypto.randomBytes(5).toString("hex")}`,
          runId,
          domain: "synthflow.ai",
          url: "https://synthflow.ai",
          title: "Synthflow AI | No-Code Conversational AI Voice",
          snippet: "Build voice agents without coding for appointment scheduling and qualification.",
          rank: 4,
          isBrandDomain: false,
          isCompetitorDomain: true,
        });
      }
    }
  }

  // 6. Seed Strategic Opportunities tailored to Outcraft.ai
  const opportunitiesData = [
    {
      title: "Claim Uncontested Query Fan-Out on 'HubSpot Form Submit Voice AI'",
      subQueryTarget: "HubSpot form submit webhook automated phone call",
      gapType: "Unclaimed High-Intent Subquery",
      recommendedAction:
        "Publish a dedicated technical integration blueprint on outcraft.ai/integrations/hubspot with Schema.org HowTo and FAQPage markup. Generative engines currently forfeit 100% of these speed-to-lead citations to Retell and Aloware.",
      estimatedImpact: "HIGH (+8.4% CSoV)",
      status: "open",
    },
    {
      title: "Publish Audited Conversational Turn-Taking & Audio Latency Benchmark",
      subQueryTarget: "voice AI latency benchmarks sub 800ms",
      gapType: "Missing Empirical Anchor",
      recommendedAction:
        "LLMs frequently extract Retell's 'sub-800ms latency' claim as a grounded factual reference. Publish an empirical turn-taking latency benchmark for Outcraft's voice pipeline with real audio waveform comparisons.",
      estimatedImpact: "HIGH (+6.2% CSoV)",
      status: "open",
    },
    {
      title: "Deploy Dedicated Comparison Hub: Outcraft AI vs Bland AI vs Retell AI",
      subQueryTarget: "Outcraft AI vs Bland AI vs Retell AI comparison",
      gapType: "Competitor Narrative Monopoly",
      recommendedAction:
        "Third-party blogs and aggregator sites currently control the narrative on Outcraft AI alternative searches. Create a self-contained 150-word comparison matrix clarifying turnkey SDR automation vs developer API ownership.",
      estimatedImpact: "HIGH (+5.1% CSoV)",
      status: "open",
    },
    {
      title: "Establish Third-Party Citations on Product Hunt, Dev.to, and G2",
      subQueryTarget: "Outcraft AI reviews and customer feedback",
      gapType: "Third-Party Authority Void",
      recommendedAction:
        "Perplexity and Microsoft Copilot prioritize community reviews for brand grounding. Launch an active discussion thread on Product Hunt and technical architectural teardown on Dev.to to seed high-authority off-domain citations.",
      estimatedImpact: "MEDIUM (+3.8% CSoV)",
      status: "open",
    },
  ];

  for (const opp of opportunitiesData) {
    await db.insert(schema.opportunities).values({
      id: `opp-outcraft-${crypto.randomBytes(4).toString("hex")}`,
      brandId,
      title: opp.title,
      subQueryTarget: opp.subQueryTarget,
      gapType: opp.gapType,
      recommendedAction: opp.recommendedAction,
      estimatedImpact: opp.estimatedImpact,
      status: opp.status,
    });
  }

  console.log("✅ [PrismGEO] Outcraft.ai audit seed complete!");
  console.log(`- Outcraft Citations: ${outcraftCitationsCount}`);
  console.log(`- Retell AI Citations: ${retellCitationsCount}`);
  console.log(`- Bland AI Citations: ${blandCitationsCount}`);
  console.log(`- 11x Citations: ${elevenxCitationsCount}`);
  console.log(`- Synthflow Citations: ${synthflowCitationsCount}`);
}

seedOutcraftAi().catch(console.error);

