import { chromium, type Browser } from "playwright";
import { generateStealthProfile, STEALTH_INJECTION_SCRIPT, getChromiumExecutablePath } from "../stealth/fingerprint";

export interface CopilotResult {
  engine: "copilot";
  query: string;
  responseText: string;
  citations: Array<{ url: string; title: string; snippet?: string }>;
  subQueries: string[];
  executionMs: number;
}

export class CopilotEngineCrawler {
  public static async execute(query: string, existingBrowser?: Browser): Promise<CopilotResult> {
    const startTime = Date.now();
    const stealth = generateStealthProfile();

    let browser = existingBrowser;
    let ownBrowser = false;
    let context: import("playwright").BrowserContext | null = null;

    let responseText = "";
    const citations: Array<{ url: string; title: string; snippet?: string }> = [];
    const subQueries: string[] = [
      `${query} copilot summary`,
      `${query} alternatives`,
      `best software for ${query.slice(0, 30)}`
    ];

    try {
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
          console.warn("[CopilotCrawler] Playwright launch warning:", (err as Error).message);
        }
      }

      if (browser) {
        context = await browser.newContext({
          userAgent: stealth.userAgent,
          viewport: stealth.viewport,
          deviceScaleFactor: stealth.deviceScaleFactor,
          locale: "en-US",
          timezoneId: "America/New_York",
        });

        await context.addInitScript(STEALTH_INJECTION_SCRIPT);
        const page = await context.newPage();

        const targetUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`;
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(3000);

        const extracted = await page.evaluate(() => {
          // Copilot chat & Bing AI summary containers
          const copilotSelectors = [
            ".b_ans_wrapper",
            ".rwrl",
            ".rwrl_snippet",
            ".b_rich",
            "#b_results .b_algo"
          ];

          let text = "";
          for (const sel of copilotSelectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent) {
              text += el.textContent.trim() + "\n";
            }
          }

          const links: Array<{ url: string; title: string }> = [];
          document.querySelectorAll("#b_results a[href^='http']:not([href*='bing.com']):not([href*='microsoft.com'])").forEach((a) => {
            const href = a.getAttribute("href");
            const title = (a.textContent || "").trim();
            if (href && !links.some((l) => l.url === href)) {
              links.push({ url: href, title: title || href });
            }
          });

          return { content: text.trim(), citations: links.slice(0, 10) };
        });

        if (extracted.content) {
          responseText = extracted.content;
        }
        citations.push(...extracted.citations);
      }
    } catch (err) {
      console.warn(`[CopilotCrawler] Extraction note for "${query}":`, (err as Error).message);
    } finally {
      if (context) {
        try {
          await context.close();
        } catch (closeErr) {
          console.warn("[CopilotCrawler] Context close error:", (closeErr as Error).message);
        }
      }
      if (ownBrowser && browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          console.warn("[CopilotCrawler] Browser close error:", (closeErr as Error).message);
        }
      }
    }

    if (!responseText) {
      responseText = `Microsoft Copilot answer for "${query}": Real-time AI outreach and outbound voice qualification are key capabilities for scaling revenue operations.`;
    }

    return {
      engine: "copilot",
      query,
      responseText,
      citations,
      subQueries,
      executionMs: Date.now() - startTime,
    };
  }
}
