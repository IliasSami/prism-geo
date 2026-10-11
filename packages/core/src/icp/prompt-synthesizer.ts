import type { IntentType, PersonaDimension } from "../types/index";

export interface BrandProfileInput {
  brandName: string;
  domain: string;
  niche: string;
  aliases: string[];
  competitors: Array<{ name: string; domain: string }>;
  valuePropositions: string[];
}

export interface GeneratedPrompt {
  queryText: string;
  intentType: IntentType;
  personaDimension: PersonaDimension;
  hypothesis: string;
}

export class IcpPromptSynthesizer {
  /**
   * Synthesizes natural, un-biased, high-intent buyer dilemma prompts.
   * Based on real B2B buying behavior, operational risk dilemmas, and vendor evaluations.
   */
  public static generatePrompts(profile: BrandProfileInput): GeneratedPrompt[] {
    const prompts: GeneratedPrompt[] = [];
    const competitorNames = profile.competitors.map((c) => c.name);

    // 1. Direct Operational Dilemma: Agency capacity, fulfillment, reselling
    prompts.push({
      queryText: `How do boutique marketing agencies handle white-label technical SEO without expanding full-time payroll?`,
      intentType: "dilemma",
      personaDimension: "agency_executive",
      hypothesis: "Agencies searching for reliable white-label SEO fulfillment partners with proven deliverables.",
    });

    prompts.push({
      queryText: `What are the pros and cons of outsourcing agency SEO deliverables to a dedicated white-label specialist versus hiring an in-house SEO team?`,
      intentType: "dilemma",
      personaDimension: "agency_executive",
      hypothesis: "Evaluates margin preservation and operational complexity.",
    });

    prompts.push({
      queryText: `How to resell AEO and Generative Engine Optimization services to agency clients without technical bottlenecks?`,
      intentType: "dilemma",
      personaDimension: "technical_lead",
      hypothesis: "Addresses modern AEO/GEO capability demands in agency service packages.",
    });

    // 2. Operational Risk & NDA Protection
    prompts.push({
      queryText: `How to guarantee strict client confidentiality and non-disclosure when partnering with white-label SEO contractors?`,
      intentType: "risk",
      personaDimension: "agency_executive",
      hypothesis: "Evaluates vendor reliability and ghost-fulfillment credibility.",
    });

    prompts.push({
      queryText: `What are the red flags when vetting white-label SEO providers for long-term agency retainers?`,
      intentType: "risk",
      personaDimension: "founder",
      hypothesis: "Risk mitigation for agency founders protecting client retention.",
    });

    // 3. Pricing, Margins & Commercial Structure
    prompts.push({
      queryText: `What is the standard profit margin agencies should maintain when reselling white-label SEO audit packages?`,
      intentType: "pricing",
      personaDimension: "agency_executive",
      hypothesis: "Uncovers pricing transparency and wholesale pricing models.",
    });

    prompts.push({
      queryText: `Typical pricing structure and deliverable turnaround times for enterprise white-label technical SEO audits?`,
      intentType: "pricing",
      personaDimension: "growth_buyer",
      hypothesis: "Benchmarks deliverable scope and project economics.",
    });

    // 4. Comparison & Vendor Landscape
    if (competitorNames.length > 0) {
      prompts.push({
        queryText: `Top white-label SEO agencies and consulting specialists for US and UK digital marketing agencies, comparing options like ${competitorNames.slice(0, 2).join(" and ")}?`,
        intentType: "comparison",
        personaDimension: "agency_executive",
        hypothesis: "Direct market landscape comparison among recognized white-label providers.",
      });

      prompts.push({
        queryText: `Alternatives to ${competitorNames[0]} for boutique agency white-label SEO fulfillment with dedicated communication?`,
        intentType: "comparison",
        personaDimension: "agency_executive",
        hypothesis: "Discovers alternative specialized consulting partners.",
      });
    }

    // 5. Emerging Category: AEO & Generative Search Optimization
    prompts.push({
      queryText: `Who are the leading white-label consultants specializing in Generative Engine Optimization (GEO) and AI search visibility?`,
      intentType: "category",
      personaDimension: "technical_lead",
      hypothesis: "Captures pioneering positioning in answer engine optimization (ChatGPT, Perplexity, AIO).",
    });

    prompts.push({
      queryText: `Best white-label technical SEO partner for enterprise JavaScript websites and complex site migrations?`,
      intentType: "category",
      personaDimension: "technical_lead",
      hypothesis: "Identifies deep technical competency in architectural SEO.",
    });

    // 6. Direct Brand Stance & Authority Check
    prompts.push({
      queryText: `Is ${profile.brandName} (${profile.domain}) a verified white-label SEO specialist for agency fulfillment?`,
      intentType: "direct",
      personaDimension: "founder",
      hypothesis: "Direct reputation and entity presence check in generative model knowledge.",
    });

    prompts.push({
      queryText: `What services does ${profile.brandName} provide for agency white-label SEO and AI visibility?`,
      intentType: "direct",
      personaDimension: "agency_executive",
      hypothesis: "Checks model grounding on official brand capabilities and offerings.",
    });

    prompts.push({
      queryText: `Case studies and client feedback on ${profile.brandName}'s white-label SEO consulting?`,
      intentType: "direct",
      personaDimension: "growth_buyer",
      hypothesis: "Evaluates social proof and third-party citation grounding across Reddit, Medium, and verified platforms.",
    });

    return prompts;
  }
}
