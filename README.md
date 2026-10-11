# PrismGEO: Generative Engine Optimization (GEO) & AI Visibility Suite

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Next.js 15](https://img.shields.io/badge/Next.js-15.5-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![SQLite WAL](https://img.shields.io/badge/Database-SQLite%20WAL-003B57?logo=sqlite)](https://sqlite.org/)
[![Zero-Cost Stealth](https://img.shields.io/badge/Cost-100%25%20Zero--Cost%20Stealth-emerald)](https://playwright.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/IliasSami/prism-geo/pulls)
[![Author: Ilias Sami](https://img.shields.io/badge/Author-Ilias%20Sami-sky?logo=safari)](https://iliassami.com)

**PrismGEO** is the premier, open-source, local-first Generative Engine Observability (GEO) and Answer Engine Optimization (AEO) tracking platform. Designed for modern agencies, growth leaders, and technical SEOs, PrismGEO continuously audits brand presence, footnote citations, competitor share of voice, and reverse-RAG attribution across the world's leading generative answer engines—**with 100% zero recurring API costs**.

---

## 🚀 Key Highlights & Architectural Philosophy

* 🛡️ **100% Zero-Cost Local Stealth Browsing:** Requires **zero paid API keys** for search engines. Crawling executes through an automated headless Chromium orchestration layer with authentic fingerprint spoofing (`PluginArray`, Apple M3 WebGL renderer emulation, and residential browser profiles).
* 🔑 **Optional BYOK (Bring Your Own Key) Architecture:** Flexibly connect official OpenAI, Google Gemini, Anthropic Claude, Perplexity Sonar, or OpenRouter keys for accelerated direct API audits or hybrid failover.
* 🏢 **Multi-Tenant Agency Workspaces:** Track unlimited clients and campaigns from a single dashboard. 1-click client switching, tenant-isolated data partitioning, and custom competitor matrices.
* 📊 **Empirical Mathematical Parity with Enterprise Tools:** Full mathematical and statistical alignment with renowned enterprise platforms (**Profound**, **SE Ranking AI Overviews Tracker**, **Otterly.ai**, and **BrightEdge Athena**).
* 🎯 **Reverse-RAG Passage Matching:** Automatically decomposes cited web pages and maps exact text chunks using tokenized, stop-word filtered Cosine TF-IDF vector similarity.
* 🌲 **Query Fan-Out Interception:** Intercepts secondary exploratory queries dispatched by agentic RAG engines during multi-turn answer synthesis.
* 💾 **100% Local-First Data Ownership:** Self-contained relational persistence powered by SQLite 3 with Write-Ahead Logging (WAL). Zero cloud lock-in, 1-click database backup downloads, and full RFC 4180 CSV exports.

---

## 🤖 Supported Generative Search Engines

| Engine | Generative Surface | Crawling Protocol | Output Extraction |
| :--- | :--- | :--- | :--- |
| **Perplexity AI** | Sonar & Live Search | Headless Stealth Playwright / BYOK | Footnote citations, query fan-out trees, domain rank |
| **Google AI Overviews** | Search Generative Box | Headless Stealth Playwright | Unwrapped canonical URLs, title snippets, anchor text |
| **ChatGPT Search** | OpenAI Web Search | Headless Stealth Playwright / BYOK | Grounded markdown links, primary entity recommendations |
| **Microsoft Copilot** | Bing Grounded Index | Headless Stealth Playwright | SERP citation links, footnote markers |
| **Google Gemini** | Google Search Grounding | Headless Stealth Playwright / BYOK | Search grounding tools, query decomposition |

---

## 📐 Enterprise Metrics & Mathematical Formulations

Unlike naive scraping tools that report brittle $N=1$ snapshots, PrismGEO employs multi-session Monte Carlo sampling ($N \ge 5$ to $15$) to compute calibrated variance bands and probabilistic metrics:

### 1. Calibrated Exponential Prominence Decay
Models the cognitive decay of user attention across generative answers. Citations in the front 30% of a response receive $\ge 0.70$ prominence score:
$$\text{Prominence}(\text{pos}) = \exp(-\lambda \cdot \text{pos}) \quad \text{where } \lambda = 1.189$$

### 2. Effective Visibility Index ($EVI$)
Combines mention frequency with calibrated prominence to prevent low-sample conditioning anomalies:
$$EVI = P(\text{Mention}) \times \text{Prominence}_{\text{weighted}}$$

### 3. Yates-Corrected Wilson 95% Confidence Intervals
Calculates robust, asymmetric variance bands across small and large Monte Carlo sample sizes:
$$CI_{95\%} = \frac{\hat{p} + \frac{z^2}{2n} \pm \left(z \sqrt{\frac{\hat{p}(1-\hat{p})}{n} + \frac{z^2}{4n^2}} + \frac{1}{2n}\right)}{1 + \frac{z^2}{n}}$$

### 4. Tri-Part Citation Share of Voice (CSoV)
Separates direct competitor citations from editorial directory and user-generated content (Reddit, G2, Capterra, Forbes) to eliminate denominator distortion:
$$\text{CSoV}_{\text{Competitive}} = \frac{\text{Citations}_{\text{Brand}} + \alpha}{\sum \text{Citations}_{\text{Competitors}} + \text{Citations}_{\text{Brand}} + K\alpha}$$
$$\text{Editorial Dilution Rate} = \frac{\text{Citations}_{\text{UGC / Editorial}}}{\text{Total Citations Grounded}} \times 100\%$$

### 5. 5-Class Contextual Stance Classification
Categorizes how generative models recommend a brand:
* `RECOMMENDED_PRIMARY` ($+1.0$ weight) — Chosen as the #1 or top pick.
* `RECOMMENDED_ALTERNATIVE` ($+0.6$ weight) — Cited as a viable alternative or runner-up.
* `NEUTRAL_MENTION` ($0.0$ weight) — Factual or incidental inclusion.
* `WARNING_LIMITATION` ($-1.0$ weight) — Cited with notable drawbacks, high cost, or complexity.
* `OMITTED` ($0.0$ weight) — Excluded from generative synthesis.

---

## 🖥️ User Experience & Information Architecture

Inspired by minimalist, high-density enterprise software, PrismGEO organizes complex observability into 7 core modules:

```text
PrismGEO Enterprise Suite
├── 1. Overview (/)                      # Executive KPI cards, cross-engine health, quick-action crawl runner
├── 2. Share of Voice (/sov)             # Competitive leaderboard, EVI matrix, and Wilson 95% confidence bands
├── 3. Citations & Sources (/citations)  # Grounded external URLs and Cosine TF-IDF reverse-RAG passage chunks
├── 4. Responses & Fan-Out (/responses)  # Raw generative transcripts, query fan-out trees, and token attribution
├── 5. Prompts & Scenarios (/prompts)    # ICP buyer dilemmas, search psychology, and win/loss rates
├── 6. Opportunities (/opportunities)    # Prioritized AEO action plan, missing answer blocks, content briefs
└── 7. Settings & Hub (/settings)        # Multi-client manager, BYOK keys, Monte Carlo sliders, database backups
```

---

## ⚡ Quickstart & Installation

### Prerequisites
* **Node.js**: `v20.x` or higher
* **pnpm**: `v9.x` or higher (`npm install -g pnpm`)
* **Python**: `3.10+` (optional, for batch campaign execution scripts)

### 1. Clone & Install
```bash
git clone https://github.com/IliasSami/prism-geo.git
cd prism-geo
pnpm install
```

### 2. Install Playwright Chromium
```bash
pnpm --filter @prismgeo/crawler exec playwright install chromium
```

### 3. Build Monorepo
```bash
pnpm build
```

### 4. Start Local Dashboard
```bash
pnpm dev
# Or run optimized production server:
pnpm --filter @prismgeo/web start -p 3333
```

Open [http://localhost:3333](http://localhost:3333) in your browser.

---

## 🛠️ Step-by-Step Client Onboarding

PrismGEO includes a self-serve onboarding wizard at `/setup`:
1. **Target Entity Grounding:** Enter Brand Name, Primary Domain, Aliases, and Value Propositions.
2. **Competitive Benchmark:** Add 3 to 10 market rivals to calculate CSoV.
3. **Engine Calibration:** Select active search engines and toggle between Zero-Cost Stealth or BYOK keys.
4. **ICP Prompts Generation:** Configure seed prompt volume and Monte Carlo sample size ($N$).

---

## 📦 Data Export & Offline Backups

PrismGEO guarantees complete data sovereignty:
* **Download SQLite Database:** Checkpoint WAL and stream the `.db` file directly via `GET /api/backup`.
* **Export Citations (CSV):** Clean RFC 4180 CSV export via `GET /api/export?format=csv&type=citations`.
* **Export Full Audit (JSON):** Complete audit snapshot via `GET /api/export?format=json&type=full`.

---

## 🤝 Contributing

Contributions, bug reports, and pull requests are warmly welcomed! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on code style, monorepo structure, and testing guidelines.

---

## 📜 License & Compliance

PrismGEO is released under the permissive [MIT License](LICENSE).
It operates strictly with zero telemetry, zero vendor lock-in, and adheres to all GitHub open-source community standards.

---

## 👨‍💻 Author & Maintainer

Created and maintained with highest standards by **Ilias Ahmed (Ilias Sami)**.
* **Website:** [iliassami.com](https://iliassami.com)
* **GitHub:** [@IliasSami](https://github.com/IliasSami)
* **Specialization:** Generative Engine Optimization (GEO), Answer Engine Optimization (AEO), and Technical SEO Architecture.
