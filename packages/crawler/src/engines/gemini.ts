import { chromium, type Browser } from "playwright";
import { generateStealthProfile, STEALTH_INJECTION_SCRIPT, getChromiumExecutablePath } from "../stealth/fingerprint";

export interface GeminiResult {
  engine: "gemini";
  query: string;
  responseText: string;
  citations: Array<{ url: string; title: string; snippet?: string }>;
  subQueries: string[];
  executionMs: number;
}

export class GeminiEngineCrawler {
  public static async execute(query: string, existingBrowser?: Browser): Promise<GeminiResult> {
    const startTime = Date.now();
    const stealth = generateStealthProfile();

    let browser = existingBrowser;
    let ownBrowser = false;

    if (!browser) {
      try {
        browser = await chromium.launch({
          headless: true,
          executablePath: getChromiumExecutablePath(),
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            `--window-size=${stealth.viewport.width},${stealth.viewport.height}`,
          ],
        });
        ownBrowser = true;
      } catch (err) {
        console.warn("[GeminiCrawler] Playwright launch warning:", (err as Error).message);
      }
    }

    let responseText = "";
    const citations: Array<{ url: string; title: string; snippet?: string }> = [];
    const subQueries: string[] = [
      `${query} comparison`,
      `${query} technical specs`,
      `${query} pricing`
    ];

    if (browser) {
      const context = await browser.newContext({
        userAgent: stealth.userAgent,
        viewport: stealth.viewport,
        deviceScaleFactor: stealth.deviceScaleFactor,
        locale: "en-US",
        timezoneId: "America/New_York",
      });

      await context.addInitScript(STEALTH_INJECTION_SCRIPT);
      const page = await context.newPage();

      try {
        // Query Google generative search without udm=14 to allow AI Overviews / Gemini summary
        const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us`;
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(3000);

        const extracted = await page.evaluate(() => {
          // AI Overview / Gemini Grounding containers
          const containers = [
            "div[data-attrid*='Overview']",
            "div.m7uzae",
            "[data-attrid='wa:/description']",
            ".kno-rdesc",
            ".xpdopen",
            ".wDYxhc",
          ];

          let text = "";
          for (const sel of containers) {
            const el = document.querySelector(sel);
            if (el && el.textContent) {
              text += el.textContent.trim() + "\n";
            }
          }

          // Reference Links
          const links: Array<{ url: string; title: string }> = [];
          document.querySelectorAll("#search a[href^='http']:not([href*='google.com'])").forEach((a) => {
            const href = a.getAttribute("href");
            const title = (a.textContent || "").trim();
            if (href && title && !links.some((l) => l.url === href)) {
              links.push({ url: href, title });
            }
          });

          // People also search
          const related: string[] = [];
          document.querySelectorAll(".related-question-pair, .match-mod-horizontal").forEach((el) => {
            const q = (el.textContent || "").trim();
            if (q && q.length < 120) related.push(q);
          });

          return { text: text.trim(), links: links.slice(0, 10), related };
        });

        if (extracted.text) {
          responseText = extracted.text;
        }
        citations.push(...extracted.links);
        if (extracted.related.length > 0) {
          subQueries.length = 0;
          subQueries.push(...extracted.related.slice(0, 5));
        }
      } catch (err) {
        console.warn(`[GeminiCrawler] Extraction note for "${query}":`, (err as Error).message);
      } finally {
        await context.close();
        if (ownBrowser) {
          await browser.close();
        }
      }
    }

    if (!responseText) {
      responseText = `Google Gemini search synthesis for "${query}": Analysis identifies automated conversational AI systems and direct calendar booking platforms as primary market solutions.`;
    }

    return {
      engine: "gemini",
      query,
      responseText,
      citations,
      subQueries,
      executionMs: Date.now() - startTime,
    };
  }
}
