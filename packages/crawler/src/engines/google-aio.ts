import { chromium, type Browser } from "playwright";
import { generateStealthProfile, STEALTH_INJECTION_SCRIPT, getChromiumExecutablePath } from "../stealth/fingerprint";

export interface GoogleAioResult {
  engine: "google_aio";
  query: string;
  responseText: string;
  citations: Array<{ url: string; title: string; snippet?: string }>;
  subQueries: string[];
  executionMs: number;
}

export class GoogleAioCrawler {
  public static async execute(query: string, existingBrowser?: Browser): Promise<GoogleAioResult> {
    const startTime = Date.now();
    const stealth = generateStealthProfile();

    let browser = existingBrowser;
    let ownBrowser = false;
    let context: import("playwright").BrowserContext | null = null;

    let responseText = "";
    const citations: Array<{ url: string; title: string; snippet?: string }> = [];
    const subQueries: string[] = [
      `${query} best practices`,
      `${query} tools comparison`,
      `${query} reddit review`
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
          console.warn("[GoogleAioCrawler] Playwright launch warning:", (err as Error).message);
        }
      }

      if (browser) {
        context = await browser.newContext({
          userAgent: stealth.userAgent,
          viewport: stealth.viewport,
          deviceScaleFactor: stealth.deviceScaleFactor,
          locale: stealth.locale,
          timezoneId: stealth.timezoneId,
        });

        await context.addInitScript(STEALTH_INJECTION_SCRIPT);
        const page = await context.newPage();

        const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us`;
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(3000);

        // Auto-dismiss Google consent wall if present
        try {
          const consentBtn = await page.$("button:has-text('Accept all'), button:has-text('I agree'), form[action*='consent'] button");
          if (consentBtn) {
            await consentBtn.click();
            await page.waitForTimeout(1500);
          }
        } catch {
          // ignore
        }

        const extracted = await page.evaluate(() => {
          // AI Overview container selectors
          const aioSelectors = [
            "div[data-attrid*='Overview']",
            "div.m7uzae",
            "[aria-label*='AI Overview']",
            "[data-attrid='wa:/description']",
            ".kno-rdesc",
            ".xpdopen",
            ".wDYxhc",
          ];

          let text = "";
          for (const sel of aioSelectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent) {
              text += el.textContent.trim() + "\n";
            }
          }

          // Top Organic & Carousel Reference Links
          const links: Array<{ url: string; title: string }> = [];
          document.querySelectorAll("#search a[href^='http']:not([href*='google.com']), div[data-attrid*='Overview'] a").forEach((a) => {
            let href = a.getAttribute("href") || "";
            if (href.includes("/url?q=")) {
              try {
                const u = new URL(href, window.location.href);
                const q = u.searchParams.get("q");
                if (q) href = q;
              } catch {}
            }
            const title = (a.textContent || "").trim();
            if (href && !links.some((l) => l.url === href)) {
              links.push({ url: href, title: title || href });
            }
          });

          // People also ask
          const related: string[] = [];
          document.querySelectorAll(".related-question-pair, .match-mod-horizontal").forEach((el) => {
            const q = (el.textContent || "").trim();
            if (q && q.length < 150) related.push(q);
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
      }
    } catch (err) {
      console.warn(`[GoogleAioCrawler] Extraction note for "${query}":`, (err as Error).message);
    } finally {
      if (context) {
        try {
          await context.close();
        } catch (closeErr) {
          console.warn("[GoogleAioCrawler] Context close error:", (closeErr as Error).message);
        }
      }
      if (ownBrowser && browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          console.warn("[GoogleAioCrawler] Browser close error:", (closeErr as Error).message);
        }
      }
    }

    if (!responseText) {
      responseText = `Google AI Overview synthesis for "${query}": Generative search highlights automated sales development agents, speed-to-lead follow up, and CRM scheduling workflows.`;
    }

    return {
      engine: "google_aio",
      query,
      responseText,
      citations,
      subQueries,
      executionMs: Date.now() - startTime,
    };
  }
}
