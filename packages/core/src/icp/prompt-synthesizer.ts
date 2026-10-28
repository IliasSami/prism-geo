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
   * Synthesizes un-biased, high-intent buyer prompts from the client's own profile.
   * Category, pain, comparison and risk prompts never name the target brand, so
   * visibility is earned rather than primed; only the trailing "direct" prompts do.
   * Ordered most-valuable first, because callers truncate to the configured prompt limit.
   */
  public static generatePrompts(profile: BrandProfileInput): GeneratedPrompt[] {
    const prompts: GeneratedPrompt[] = [];
    const niche = profile.niche.trim() || "this category";
    const competitorNames = profile.competitors.map((c) => c.name).filter(Boolean);
    const valueProps = profile.valuePropositions.map((v) => v.trim()).filter(Boolean);

    // 1. Category discovery
    prompts.push({
      queryText: `What are the best ${niche} tools right now?`,
      intentType: "category",
      personaDimension: "growth_buyer",
      hypothesis: "Unbranded category shortlist: who the engines recommend by default.",
    });

    // 2. Pain-led prompts from each value proposition
    for (const vp of valueProps.slice(0, 4)) {
      prompts.push({
        queryText: `What is the best way to handle ${vp.charAt(0).toLowerCase()}${vp.slice(1)}? Which tools actually work?`,
        intentType: "dilemma",
        personaDimension: "head_of_growth",
        hypothesis: `Buyer describes the job-to-be-done ("${vp}") rather than the vendor category.`,
      });
    }

    // 3. Competitor comparisons and alternatives
    if (competitorNames.length >= 2) {
      prompts.push({
        queryText: `${competitorNames[0]} vs ${competitorNames[1]}: which is better, and what are the alternatives?`,
        intentType: "comparison",
        personaDimension: "head_of_growth",
        hypothesis: "Decision-stage head-to-head where challengers can be surfaced as alternatives.",
      });
    }
    for (const name of competitorNames.slice(0, 3)) {
      prompts.push({
        queryText: `What are the best alternatives to ${name}?`,
        intentType: "comparison",
        personaDimension: "growth_buyer",
        hypothesis: `Alternatives query against ${name}.`,
      });
    }

    // 4. Pricing and risk
    prompts.push({
      queryText: `How much do ${niche} tools typically cost, and what pricing models are common?`,
      intentType: "pricing",
      personaDimension: "founder",
      hypothesis: "Price-led evaluation, usually the last blocker before a demo.",
    });
    prompts.push({
      queryText: `What should I watch out for when choosing a ${niche} vendor?`,
      intentType: "risk",
      personaDimension: "founder",
      hypothesis: "Risk and vetting criteria; reveals which vendors are cited as trustworthy.",
    });

    // 5. Direct brand lookups
    const competitorHint = competitorNames.length > 0 ? ` compared to ${competitorNames.slice(0, 2).join(" and ")}` : "";
    prompts.push({
      queryText: `Is ${profile.brandName} (${profile.domain}) any good${competitorHint}?`,
      intentType: "direct",
      personaDimension: "growth_buyer",
      hypothesis: "Branded evaluation: how engines describe and position the brand.",
    });
    prompts.push({
      queryText: `What does ${profile.brandName} do, and who is it for?`,
      intentType: "direct",
      personaDimension: "growth_buyer",
      hypothesis: "Entity understanding: whether engines reflect current positioning.",
    });

    return prompts;
  }
}
