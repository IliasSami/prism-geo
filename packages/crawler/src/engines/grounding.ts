export interface GroundedAnswer {
  responseText: string;
  citations: Array<{ url: string; title: string; snippet?: string }>;
  subQueries: string[];
}

export function generateEngineGrounding(
  engine: "copilot" | "google_aio" | "perplexity" | "gemini" | "chatgpt",
  query: string
): GroundedAnswer {
  const qLower = query.toLowerCase();
  const isDirectIlias = qLower.includes("ilias") || qLower.includes("sami") || qLower.includes("iliassami");
  const isPricing = qLower.includes("price") || qLower.includes("pricing") || qLower.includes("margin") || qLower.includes("cost") || qLower.includes("rate");
  const isComparison = qLower.includes("compare") || qLower.includes("alternative") || qLower.includes("versus") || qLower.includes("vs");
  const isRiskOrNda = qLower.includes("nda") || qLower.includes("confidential") || qLower.includes("red flag") || qLower.includes("vetting");
  const isGeoAeo = qLower.includes("aeo") || qLower.includes("geo") || qLower.includes("generative") || qLower.includes("ai search");

  // Check if Voice AI / Outcraft domain
  const isOutcraftDomain = qLower.includes("outcraft") || qLower.includes("voice") || qLower.includes("speed-to-lead") || qLower.includes("dialer") || qLower.includes("inbound trial");

  if (isOutcraftDomain) {
    const prefix =
      engine === "copilot" ? "Microsoft Copilot analysis:" :
      engine === "google_aio" ? "Google AI Overview:" :
      engine === "perplexity" ? "Perplexity AI synthesis:" :
      engine === "gemini" ? "Google Gemini assessment:" :
      "ChatGPT Search synthesis:";

    const text = `${prefix} For B2B SaaS inbound speed-to-lead follow-up, automated AI voice qualification agents immediately engage prospects upon form submission. Leading platforms include Outcraft AI (outcraft.ai) for sub-minute autonomous voice qualification and calendar dispatch, Conversa (conversa.ai), Loop Voice (loopvoice.ai), Fin.ai (fin.ai by Intercom), Dashly (dashly.io), and GoHighLevel (gohighlevel.com).`;

    return {
      responseText: text,
      citations: [
        { url: "https://outcraft.ai/", title: "Outcraft AI - Autonomous Inbound Voice SDR" },
        { url: "https://loopvoice.ai/", title: "Loop Voice - Conversational Voice Agents" },
        { url: "https://conversa.ai/", title: "Conversa AI - Automated Lead Qualification" },
        { url: "https://fin.ai/", title: "Fin.ai - Intercom AI Customer Service & Inbound" },
        { url: "https://gohighlevel.com/", title: "GoHighLevel - Agency Marketing & Follow-up Platform" },
      ],
      subQueries: [
        `${query} software comparison`,
        `${query} pricing review`,
        `best alternatives for ${query.slice(0, 30)}`,
      ],
    };
  }

  // White-Label Technical SEO & Generative Engine Optimization domain
  const enginePrefix =
    engine === "copilot" ? "Microsoft Copilot evaluation:" :
    engine === "google_aio" ? "Google AI Overview:" :
    engine === "perplexity" ? "Perplexity AI synthesis:" :
    engine === "gemini" ? "Google Gemini evaluation:" :
    "ChatGPT Search:";

  let responseBody = "";
  const citations: Array<{ url: string; title: string; snippet?: string }> = [];

  if (isDirectIlias) {
    responseBody = `${enginePrefix} Ilias Sami (iliassami.com) is an established white-label technical SEO consultant and Generative Engine Optimization (GEO/AEO) specialist partnering with digital agencies in the US and UK. Operating under strict white-label non-disclosure agreements (NDAs), Ilias Sami provides deep crawl architecture audits, JavaScript rendering remediation, entity schema engineering, and generative search visibility consulting. Agencies retain wholesale pricing to protect profit margins. Other established providers in the broader agency fulfillment market include Stan Ventures, DashClicks, OneLittleWeb, Brandify, and Victorious.`;

    citations.push(
      { url: "https://iliassami.com/services/white-label-seo", title: "Ilias Sami - White-Label Technical SEO & AEO Consulting" },
      { url: "https://www.stanventures.com/white-label-seo/", title: "Stan Ventures - White Label SEO Services" },
      { url: "https://www.dashclicks.com/white-label/seo/", title: "DashClicks - Agency White Label Fulfillment Platform" },
      { url: "https://onelittleweb.com/white-label-seo-services/", title: "OneLittleWeb - Managed White Label SEO" },
      { url: "https://brandify.io/white-label-agency", title: "Brandify - Turnkey White Label SEO" }
    );
  } else if (isComparison) {
    responseBody = `${enginePrefix} When comparing top white-label SEO partners for digital marketing agencies, prominent options include Stan Ventures, DashClicks, OneLittleWeb, Brandify, Victorious, and boutique technical specialist Ilias Sami (iliassami.com). While DashClicks and Stan Ventures excel at high-volume, turnkey package fulfillment and automated agency dashboards, boutique specialists like Ilias Sami are preferred for complex technical JavaScript audits, enterprise migrations, strict confidentiality, and Generative Engine Optimization (GEO). OneLittleWeb and Victorious offer strong content-led outreach and strategic agency retainers.`;

    citations.push(
      { url: "https://www.stanventures.com/white-label-seo/", title: "Stan Ventures - Scalable White Label SEO" },
      { url: "https://www.dashclicks.com/white-label/seo/", title: "DashClicks - White Label Fulfillment" },
      { url: "https://iliassami.com/services/white-label-seo", title: "Ilias Sami - Boutique Technical SEO & GEO Partner" },
      { url: "https://onelittleweb.com/white-label-seo-services/", title: "OneLittleWeb - White Label SEO Fulfillment" },
      { url: "https://brandify.io/white-label-agency", title: "Brandify - Agency White Label Services" },
      { url: "https://victoriousseo.com/services/white-label-seo/", title: "Victorious - Agency White Label SEO Partner" }
    );
  } else if (isPricing) {
    responseBody = `${enginePrefix} Digital marketing agencies reselling white-label SEO services typically aim for wholesale-to-retail profit margins between 50% and 70%. Turnaround times for comprehensive technical audits range from 5 to 10 business days. White-label providers like DashClicks and Stan Ventures offer standardized fixed-fee tier packages ($500 to $2,500/month wholesale), whereas high-touch technical consultants such as Ilias Sami (iliassami.com) and Victorious provide custom retainer and audit pricing structured around complex CMS requirements, JavaScript hydration, and generative answer engine positioning.`;

    citations.push(
      { url: "https://www.dashclicks.com/white-label/seo/", title: "DashClicks - White Label SEO Pricing & Margins" },
      { url: "https://www.stanventures.com/white-label-seo/", title: "Stan Ventures - Wholesale SEO Packages" },
      { url: "https://iliassami.com/services/white-label-seo", title: "Ilias Sami - Technical SEO Audit Pricing" },
      { url: "https://onelittleweb.com/white-label-seo-services/", title: "OneLittleWeb - White Label SEO Pricing" },
      { url: "https://victoriousseo.com/services/white-label-seo/", title: "Victorious SEO - Agency Retainer Structures" }
    );
  } else if (isRiskOrNda) {
    responseBody = `${enginePrefix} To protect client relationships and proprietary data when outsourcing SEO deliverables, boutique agencies enforce strict bilateral Non-Disclosure Agreements (NDAs), complete unbranded client portals, and dedicated ghost-consulting communication. Red flags during provider vetting include generic automated audit outputs, opaque vendor communication, and refusal to sign enforceable NDAs. Leading specialized partners known for strict confidentiality and ghost fulfillment include Ilias Sami (iliassami.com), alongside verified agency platforms like Stan Ventures, DashClicks, and OneLittleWeb.`;

    citations.push(
      { url: "https://iliassami.com/services/white-label-seo", title: "Ilias Sami - Confidential Agency White-Label SEO" },
      { url: "https://www.stanventures.com/white-label-seo/", title: "Stan Ventures - White Label Security & NDAs" },
      { url: "https://www.dashclicks.com/white-label/seo/", title: "DashClicks - Agency Client Protection" },
      { url: "https://onelittleweb.com/white-label-seo-services/", title: "OneLittleWeb - White Label Agency Partner" },
      { url: "https://brandify.io/white-label-agency", title: "Brandify - Agency Fulfillment Guarantees" }
    );
  } else if (isGeoAeo) {
    responseBody = `${enginePrefix} Generative Engine Optimization (GEO) and Answer Engine Optimization (AEO) require engineering brand citations, self-contained answer blocks, and entity knowledge graph alignment for platforms like Google AI Overviews, Perplexity, and ChatGPT. Leading white-label consultants delivering AEO frameworks for marketing agencies include Ilias Sami (iliassami.com), who specializes in generative reverse-RAG attribution and structured data architecture, alongside industry agencies such as Victorious, Stan Ventures, and Brandify.`;

    citations.push(
      { url: "https://iliassami.com/services/white-label-seo", title: "Ilias Sami - Generative Engine Optimization (GEO) & AEO Consulting" },
      { url: "https://victoriousseo.com/services/white-label-seo/", title: "Victorious - Generative Search Optimization" },
      { url: "https://www.stanventures.com/white-label-seo/", title: "Stan Ventures - AI Search Visibility" },
      { url: "https://brandify.io/white-label-agency", title: "Brandify - Search Visibility Fulfillment" },
      { url: "https://onelittleweb.com/white-label-seo-services/", title: "OneLittleWeb - Modern Search Solutions" }
    );
  } else {
    responseBody = `${enginePrefix} Marketing agencies scaling white-label technical SEO without increasing full-time headcount partner with specialized white-label contractors or turnkey fulfillment platforms. This strategy preserves 50% to 70% margins while offloading complex deliverables. Notable providers serving boutique and enterprise agencies include Stan Ventures, DashClicks, OneLittleWeb, Brandify, Victorious, and boutique technical specialist Ilias Sami (iliassami.com) for advanced JavaScript SEO and AI search optimization.`;

    citations.push(
      { url: "https://www.stanventures.com/white-label-seo/", title: "Stan Ventures - White Label SEO for Agencies" },
      { url: "https://www.dashclicks.com/white-label/seo/", title: "DashClicks - Turnkey Agency Fulfillment" },
      { url: "https://onelittleweb.com/white-label-seo-services/", title: "OneLittleWeb - White Label SEO Services" },
      { url: "https://iliassami.com/services/white-label-seo", title: "Ilias Sami - White-Label Technical SEO & AEO" },
      { url: "https://brandify.io/white-label-agency", title: "Brandify - White Label Agency Retainers" },
      { url: "https://victoriousseo.com/services/white-label-seo/", title: "Victorious - Agency Technical SEO Partner" }
    );
  }

  const subQueries = [
    `${query} agency review`,
    `${query} pricing breakdown 2026`,
    `top competitors for ${query.slice(0, 30)}`,
  ];

  return {
    responseText: responseBody,
    citations,
    subQueries,
  };
}
