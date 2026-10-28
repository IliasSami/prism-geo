/**
 * Realistic answers in the styles the engines produce, with hand-labelled ground truth, for a
 * fictional brand and fictional competitors. "browser" answers are what extractAnswer() leaves
 * after flattening the DOM (plain lines); "api" answers keep markdown and inline links.
 */
export type Sentiment = "positive" | "neutral" | "negative";

export const PROFILE = {
  brand: { name: "Northwind Voice", domain: "northwindvoice.ai", aliases: ["Northwind"] },
  competitors: [
    { id: "c-talkly", name: "Talkly", domain: "talkly.com", aliases: [] as string[] },
    { id: "c-ringo", name: "Ringo Calls", domain: "ringocalls.com", aliases: [] as string[] },
    { id: "c-dialsy", name: "Dialsy AI", domain: "dialsy.ai", aliases: [] as string[] },
    // Listed on a marketplace as "Hoop – AI Voice Agents" (en dash); "Hoop Subscriptions"/"Hoop Returns" are other companies
    { id: "c-hoop", name: "Hoop Voice", domain: "hoopvoice.ai", aliases: ["Hoop – AI Voice Agents"] },
    { id: "c-vocalyze", name: "Vocalyze", domain: "vocalyze.io", aliases: [] as string[] },
  ],
};

export interface Case {
  id: string;
  prompt: string;
  intent: string;
  style: "browser" | "api";
  responseText: string;
  citations: Array<{ url: string; title: string }>;
  /** Entity -> rank among non-echo tracked vendors (null for an echo of the prompt) and sentiment; absent = not mentioned. */
  expected: Record<string, { rank: number | null; sentiment: Sentiment }>;
  /** Entities named by the prompt itself (echoes). */
  echoes?: string[];
  /** Expected look-alike domains of the brand. */
  lookalikes?: string[];
}

export const CASES: Case[] = [
  {
    id: "A",
    prompt: "best ai tool to call customers who abandon checkout on shopify",
    intent: "category",
    style: "browser",
    responseText: [
      "If you want an AI that actually phones shoppers who abandoned checkout on Shopify, these are the tools worth a look in 2026:",
      "Best overall: Talkly",
      "Talkly is the most established Shopify-native voice agent for cart recovery. It syncs abandoned checkouts in real time and calls within minutes.",
      "Best for high-volume stores: Dialsy AI",
      "Dialsy handles large call volumes and has a Klaviyo integration, but pricing is per minute and can get expensive at scale.",
      "Best for brands already on the Shopify App Store: Hoop – AI Voice Agents",
      "Listed on the Shopify App Store, quick to install, good for simple scripts.",
      "Best for pay-per-performance: Northwind",
      'Northwind (Northwind Voice) positions itself as an "AI sales team" and charges per recovered order, which lowers risk for smaller brands.',
      "Also worth considering: Ringo Calls, Vocalyze",
      "General-purpose voice agent builders; more setup, more flexibility.",
      "Quick recommendation",
      "If you want the safest choice, start with Talkly. If you want to pay only for results, try Northwind.",
    ].join("\n"),
    citations: [],
    expected: {
      Talkly: { rank: 1, sentiment: "positive" },
      "Dialsy AI": { rank: 2, sentiment: "positive" },
      "Hoop Voice": { rank: 3, sentiment: "positive" },
      "Northwind Voice": { rank: 4, sentiment: "positive" },
      "Ringo Calls": { rank: 5, sentiment: "positive" },
      Vocalyze: { rank: 6, sentiment: "positive" },
    },
  },
  {
    id: "B",
    prompt: "which ai cart recovery voice agent should a shopify store pick",
    intent: "category",
    style: "api",
    responseText: [
      "Here's a quick comparison of AI voice agents for abandoned-checkout calls:",
      "",
      "| Tool | Best for | Shopify | Klaviyo | Pricing |",
      "|---|---|---|---|---|",
      "| **Talkly** | Established DTC brands | Native app | Yes | Monthly plan |",
      "| **Dialsy AI** | High call volume | Yes | Yes | Per minute |",
      "| **Northwind Voice** | Pay-per-recovered-order | Yes | Yes | % of recovered revenue |",
      "| **Vocalyze** | Custom voice workflows | Via Zapier | Limited | Seat-based |",
      "",
      "**Bottom line:** Talkly is the top pick for most Shopify stores; Northwind is a strong alternative if you only want to pay for results ([northwindvoice.ai](https://northwindvoice.ai/pricing?utm_source=openai)).",
    ].join("\n"),
    citations: [{ url: "https://northwindvoice.ai/pricing?utm_source=openai", title: "Pricing | Northwind Voice" }],
    expected: {
      Talkly: { rank: 1, sentiment: "positive" },
      "Dialsy AI": { rank: 2, sentiment: "neutral" },
      "Northwind Voice": { rank: 3, sentiment: "positive" },
      Vocalyze: { rank: 4, sentiment: "neutral" },
    },
  },
  {
    id: "C",
    prompt: "is there an app that phones shoppers who leave items in their cart",
    intent: "category",
    style: "browser",
    responseText: [
      "Yes. Several Shopify apps now place automated phone calls to shoppers who left items in their cart:",
      "1. Talkly – AI voice agent built for Shopify cart recovery. Inexpensive to start and easy to set up.",
      "2. Dialsy AI – calls and texts abandoned carts; no major drawbacks reported by reviewers.",
      "3. Northwind Voice – newer entrant. Reviews are thin and some users complain that calls sound scripted, so test it on a small segment first.",
      "4. Ringo Calls – more of a general AI receptionist; it lacks native Shopify checkout triggers.",
      "Tip: calls convert best when placed within 15 minutes of the abandoned checkout.",
    ].join("\n"),
    citations: [],
    expected: {
      Talkly: { rank: 1, sentiment: "positive" },
      "Dialsy AI": { rank: 2, sentiment: "positive" },
      "Northwind Voice": { rank: 3, sentiment: "negative" },
      "Ringo Calls": { rank: 4, sentiment: "negative" },
    },
  },
  {
    id: "D",
    prompt: "how do i recover abandoned checkouts with phone calls",
    intent: "dilemma",
    style: "api",
    responseText: [
      "To recover abandoned checkouts with phone calls, you need three things: the shopper's phone number and consent, a trigger when checkout is abandoned, and a script that removes the blocker (shipping cost, sizing, payment failure) ([talkly.com](https://www.talkly.com/blog/abandoned-checkout-calls?utm_source=chatgpt.com)).",
      "",
      "1. Collect phone numbers at checkout and capture SMS/call consent ([help.shopify.com](https://help.shopify.com/en/manual/checkout-settings?utm_source=chatgpt.com)).",
      "2. Trigger a call 5 to 30 minutes after abandonment, either with your own team or an AI voice agent.",
      "3. Offer help rather than a discount on the first call.",
      "4. Log outcomes back into Klaviyo so flows stop for recovered orders ([northwindvoice.ai](https://northwindvoice.ai/blog/klaviyo-voice?utm_source=chatgpt.com)).",
    ].join("\n"),
    citations: [
      { url: "https://www.talkly.com/blog/abandoned-checkout-calls?utm_source=chatgpt.com", title: "How to call abandoned checkouts" },
      { url: "https://northwindvoice.ai/blog/klaviyo-voice?utm_source=chatgpt.com", title: "Klaviyo + voice" },
    ],
    expected: {},
  },
  {
    id: "E",
    prompt: "dialsy ai alternatives",
    intent: "category",
    style: "browser",
    responseText: [
      "Dialsy AI is a popular AI voice agent for e-commerce, but if it doesn't fit your needs, here are some strong options:",
      "Talkly",
      "Best for: Shopify brands that want a done-for-you setup. Talkly's agents call abandoned checkouts and sync results to Klaviyo.",
      "Northwind Voice",
      "Best for: paying only for recovered orders. Northwind markets itself as an AI sales team for ecommerce.",
      "Vocalyze",
      "Best for: teams that want to build custom voice workflows.",
      "Which one should you choose?",
      "If you want the fastest setup, Talkly is the top choice.",
    ].join("\n"),
    citations: [],
    echoes: ["Dialsy AI"],
    expected: {
      "Dialsy AI": { rank: null, sentiment: "positive" },
      Talkly: { rank: 1, sentiment: "positive" },
      "Northwind Voice": { rank: 2, sentiment: "positive" },
      Vocalyze: { rank: 3, sentiment: "positive" },
    },
  },
  {
    id: "F",
    prompt: "is northwind voice legit",
    intent: "category",
    style: "browser",
    responseText: [
      "Northwind Voice appears to be a legitimate company, but be careful: there are two similarly named businesses.",
      "Northwind Voice (northwindvoiceai.com) describes itself as an AI automation agency that builds custom chatbots and lead-generation workflows for local businesses. It has a small online footprint and few independent reviews.",
      "If you mean the ecommerce voice-agent startup that calls shoppers who abandon checkout, that is a different product; check its own site and Shopify App Store listing before signing up.",
      "Bottom line: no red flags such as scam reports, but limited third-party validation.",
    ].join("\n"),
    citations: [{ url: "https://northwindvoiceai.com/about?utm_source=chatgpt.com", title: "About – Northwind Voice" }],
    echoes: ["Northwind Voice"],
    lookalikes: ["northwindvoiceai.com"],
    expected: { "Northwind Voice": { rank: null, sentiment: "neutral" } },
  },
  {
    id: "G",
    prompt: "which ai voice agents work with klaviyo",
    intent: "category",
    style: "browser",
    responseText: [
      "Several voice agents integrate with Klaviyo:",
      "Hoop Subscriptions: not a voice agent, but its Klaviyo integration lets you trigger flows from subscription events.",
      "Hoop Returns also pushes return events to Klaviyo.",
      "Hoop - AI Voice Agents (Shopify App Store) calls abandoned checkouts and writes call outcomes to Klaviyo profiles.",
      "Dialsy: native Klaviyo integration.",
      "NORTHWIND's Klaviyo sync tags recovered orders; Northwind’s agents also read Klaviyo segments.",
      "Ringo Calls can be connected through Zapier.",
    ].join("\n"),
    citations: [],
    expected: {
      "Hoop Voice": { rank: 1, sentiment: "neutral" },
      "Dialsy AI": { rank: 2, sentiment: "neutral" },
      "Northwind Voice": { rank: 3, sentiment: "neutral" },
      "Ringo Calls": { rank: 4, sentiment: "neutral" },
    },
  },
  {
    id: "G2",
    prompt: "shopify apps that call customers about abandoned carts",
    intent: "category",
    style: "browser",
    responseText: [
      "A few Shopify App Store listings do outbound cart-recovery calls:",
      "Hoop—AI Voice Agents: installs in minutes and calls shoppers who abandon checkout.",
      "Dialsy AI: similar, with SMS follow-up.",
    ].join("\n"),
    citations: [],
    expected: {
      "Hoop Voice": { rank: 1, sentiment: "neutral" },
      "Dialsy AI": { rank: 2, sentiment: "neutral" },
    },
  },
  {
    id: "H",
    prompt: "ai sales agent for ecommerce brands",
    intent: "category",
    style: "api",
    responseText: [
      "AI sales agents for ecommerce mostly fall into on-site chat agents and outbound voice agents.",
      "On-site chat: tools such as on-site assistants answer product questions and nudge shoppers to checkout.",
      "Voice: tools such as Talkly call shoppers after an abandoned checkout.",
      "Sources: https://www.g2.com/categories/ai-sales-assistant, https://www.g2.com/products/northwind-voice/reviews, https://vocalyze.io/blog/ecommerce-voice",
    ].join("\n"),
    citations: [
      { url: "https://www.g2.com/categories/ai-sales-assistant", title: "Best AI Sales Assistant Software" },
      { url: "https://www.g2.com/products/northwind-voice/reviews", title: "Northwind Voice Reviews" },
      { url: "https://vocalyze.io/blog/ecommerce-voice", title: "Voice AI for ecommerce" },
    ],
    expected: { Talkly: { rank: 1, sentiment: "neutral" } },
  },
  {
    id: "I",
    prompt: "how much do ai voice agents for shopify cost",
    intent: "pricing",
    style: "browser",
    responseText: [
      "Pricing models vary a lot:",
      "Per minute: Dialsy AI and Vocalyze charge per call minute; most plans start with a 7-day free trial.",
      "Performance-based: Northwind Voice takes a percentage of recovered revenue, so it is not expensive if calls don't convert.",
      "Flat monthly: Talkly is not the cheapest, but it is not limited by call volume.",
    ].join("\n"),
    citations: [],
    expected: {
      "Dialsy AI": { rank: 1, sentiment: "neutral" },
      Vocalyze: { rank: 2, sentiment: "neutral" },
      "Northwind Voice": { rank: 3, sentiment: "neutral" },
      Talkly: { rank: 4, sentiment: "neutral" },
    },
  },
  {
    id: "J",
    prompt: "sms vs phone calls for cart recovery which converts better",
    intent: "dilemma",
    style: "browser",
    responseText: [
      "Phone calls usually convert better than SMS for high-AOV carts, while SMS wins on cost. Unlike Talkly, which can get expensive at volume, Northwind only charges when an order is recovered.",
      "For most stores the best option is a hybrid: SMS first, then a call. Northwind is my pick for that hybrid flow.",
    ].join("\n"),
    citations: [],
    expected: {
      Talkly: { rank: 1, sentiment: "negative" },
      "Northwind Voice": { rank: 2, sentiment: "positive" },
    },
  },
  {
    id: "K",
    prompt: "hoop subscriptions alternatives that also call abandoned carts",
    intent: "category",
    style: "browser",
    responseText: [
      "Hoop Subscriptions doesn't place phone calls, so you'd pair it with a voice tool:",
      "Hoop – AI Voice Agents is the best fit if you want everything inside the Shopify admin.",
      "Talkly is another solid choice with deeper Klaviyo reporting.",
    ].join("\n"),
    citations: [],
    expected: {
      "Hoop Voice": { rank: 1, sentiment: "positive" },
      Talkly: { rank: 2, sentiment: "positive" },
    },
  },
];

/** Error / throttle replies engines show instead of answers, with the correct verdict. */
export const REPLIES: Array<{ text: string; verdict: "blocked" | "error" | "store" }> = [
  { text: "Hmm...something seems to have gone wrong. Please try again later or contact support if the problem persists.", verdict: "error" },
  { text: "Unusual activity has been detected from your device. Try again later. (Request ID: 8c1f2a7e4d)", verdict: "blocked" },
  { text: "There was an error generating a response. Regenerate the response to try again, or contact us if the issue persists.", verdict: "error" },
  { text: "You've hit your limit. Please try again later, or log in to continue chatting.", verdict: "blocked" },
  { text: "I'm having a hard time fulfilling your request. Can I help you with something else instead?", verdict: "blocked" },
  { text: "Something went wrong. Please try again later. If the problem persists, check your network connection.", verdict: "error" },
  { text: "Pro search limit reached. Upgrade to a paid plan for more searches, or try again in a few hours.", verdict: "blocked" },
  { text: "Sorry, I can't help with that request. If you have another question about cart recovery tools, let me know.", verdict: "store" },
  { text: "An error occurred in many Shopify checkouts after the 2025 checkout extensibility migration; here is how voice agents handle it...", verdict: "store" },
  { text: "I'm not familiar with a company called Northwind Voice. It may be a newer or smaller company; check its website for details.", verdict: "store" },
];
