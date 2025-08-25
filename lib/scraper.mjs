import "dotenv/config";
import puppeteer from "puppeteer";
import { GoogleGenAI, Type } from "@google/genai";
import * as cheerio from "cheerio";

async function autoScroll(page, options = {}) {
  const {
    listItemSelector: itemSelector,
    desiredItemCount: targetCount = 30,
    maxScrolls = 50,
    delayMs = 800,
    stallRounds = 3,
    containerSelector = 'div[role="main"]',
    overlaySelector = null,
    removeOverlay = true,
  } = options;

  // Optionally remove or hide overlay that blocks scroll
  if (overlaySelector) {
    await page.evaluate(
      (selector, shouldRemove) => {
        const nodes = Array.from(document.querySelectorAll(selector));
        if (!nodes.length) return;
        for (const el of nodes) {
          if (shouldRemove) {
            el.remove();
          } else {
            el.style.pointerEvents = "none";
            el.style.display = "none";
            el.style.visibility = "hidden";
          }
        }
      },
      overlaySelector,
      removeOverlay
    );
  }

  // Resolve scroll container; fall back to document
  const hasContainer = await page.$(containerSelector);
  let lastHeight = await page.evaluate((selector) => {
    const container = document.querySelector(selector);
    const el = container || document.scrollingElement || document.body;
    return el.scrollHeight;
  }, containerSelector);
  let stall = 0;

  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate((selector) => {
      const container = document.querySelector(selector);
      const el =
        container ||
        document.scrollingElement ||
        document.documentElement ||
        document.body;
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    }, containerSelector);

    await new Promise((r) => setTimeout(r, delayMs));

    if (itemSelector) {
      try {
        const count = await page.$$eval(itemSelector, (els) => els.length);
        if (count >= targetCount) break;
      } catch {
        /* ignore */
      }
    }

    const newHeight = await page.evaluate((selector) => {
      const container = document.querySelector(selector);
      const el = container || document.scrollingElement || document.body;
      return el.scrollHeight;
    }, containerSelector);
    if (newHeight <= lastHeight) {
      stall += 1;
      if (stall >= stallRounds) break;
    } else {
      stall = 0;
      lastHeight = newHeight;
    }
  }
}

export async function getHtml(targetUrl, options = {}) {
  const {
    waitSelector,
    listItemSelector,
    desiredItemCount = 30,
    containerSelector = 'div[role="main"]',
    overlaySelector = '[class^="__fb-light-mode"]',
    removeOverlay = true,
  } = options;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );
    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 120000 });

    if (waitSelector) {
      await page
        .waitForSelector(waitSelector, { timeout: 20000 })
        .catch(() => {});
    }

    await page
      .waitForSelector(containerSelector, { timeout: 20000 })
      .catch(() => {});

    await autoScroll(page, {
      listItemSelector,
      desiredItemCount,
      containerSelector,
      overlaySelector,
      removeOverlay,
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const mainHtml = await page
      .$eval(containerSelector, (el) => el.outerHTML)
      .catch(() => null);
    if (mainHtml) return mainHtml;

    return await page.content();
  } finally {
    await browser.close();
  }
}

function normalizePrice(text) {
  if (!text) return null;
  const match = text.match(/((?:CA\$|\$)\s?[\d,.]+(?:\.\d{2})?|\bFree\b)/i);
  return match ? match[1].trim() : null;
}

function cleanTitleFromAlt(altText) {
  if (!altText) return null;
  // Remove trailing location like " in Calgary, AB"
  const cleaned = altText.replace(/\s+in\s+[^,]+,\s*[A-Z]{2,}\s*$/i, "").trim();
  return cleaned || altText;
}

export function extractProgrammatically(html, { baseUrl } = {}) {
  const $ = cheerio.load(html);
  const listings = [];

  $('a[href*="/marketplace/item/"]').each((_, el) => {
    const anchor = $(el);
    const href = anchor.attr("href") || null;
    const url = href
      ? href.startsWith("http")
        ? href
        : baseUrl
        ? new URL(href, baseUrl).toString()
        : href
      : null;

    const firstImg = anchor.find("img").first();
    const imageUrl = firstImg.attr("src") || null;
    const altText = firstImg.attr("alt") || null;

    // Gather all text inside anchor for price detection
    const textContent = anchor.text().replace(/\s+/g, " ").trim();
    const price = normalizePrice(textContent);

    const name = cleanTitleFromAlt(altText) || null;

    listings.push({
      name: name || null,
      url: url || null,
      price: price || null,
      image_url: imageUrl || null,
    });
  });

  // Deduplicate by URL when possible
  const seen = new Set();
  const deduped = listings.filter((item) => {
    const key = item.url || `${item.name}|${item.image_url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { listings: deduped };
}

function buildCompactListingContext(html, { baseUrl, maxItems = 80 } = {}) {
  const $ = cheerio.load(html);
  const candidates = [];

  $('a[href*="/marketplace/item/"]').each((_, el) => {
    if (candidates.length >= maxItems) return false;
    const anchor = $(el);
    const href = anchor.attr("href") || null;
    const absUrl = href
      ? href.startsWith("http")
        ? href
        : baseUrl
        ? new URL(href, baseUrl).toString()
        : href
      : null;

    const firstImg = anchor.find("img").first();
    const imageUrl = firstImg.attr("src") || null;
    const altText = firstImg.attr("alt") || null;

    const textContent = anchor.text().replace(/\s+/g, " ").trim();
    const price = normalizePrice(textContent);
    const name = cleanTitleFromAlt(altText) || null;

    candidates.push({
      href: absUrl,
      text: textContent,
      image: imageUrl,
      alt: altText,
      name,
      priceText: price,
    });
  });

  // Deduplicate by href or by name+image combination
  const seen = new Set();
  const deduped = [];
  for (const c of candidates) {
    const key = c.href || `${c.name}|${c.image}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  return deduped.slice(0, maxItems);
}

export async function extractWithLLM(html, targetUrl, naturalInstruction) {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing GOOGLE_API_KEY or GEMINI_API_KEY environment variable"
    );
  }

  const genAI = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || "gemini-2.5-pro";

  let baseUrl;
  try {
    baseUrl = new URL(targetUrl).origin;
  } catch {}

  const compact = buildCompactListingContext(html, { baseUrl, maxItems: 80 });
  const prompt = `Task:\n${naturalInstruction}\n\nYou are given pre-extracted listing candidates (compact context). Use them to produce the final structured JSON.\nOnly use the fields provided; do not hallucinate.\n\nCompactContext(JSON):\n${JSON.stringify(
    compact
  )}`;

  const config = {
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        listings: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, nullable: true },
              url: { type: Type.STRING, nullable: true },
              price: { type: Type.STRING, nullable: true },
              image_url: { type: Type.STRING, nullable: true },
            },
            required: ["name", "url", "price", "image_url"],
            propertyOrdering: ["name", "url", "price", "image_url"],
          },
        },
      },
      required: ["listings"],
      propertyOrdering: ["listings"],
    },
    temperature: 0.2,
  };

  const result = await genAI.models.generateContent({
    model,
    contents: prompt,
    config,
  });

  return result.text;
}

export async function runScrape({
  url,
  instruction,
  waitSelector,
  listItemSelector,
  desiredItemCount,
  mode = "llm",
  baseUrl,
}) {
  const html = await getHtml(url, {
    waitSelector,
    listItemSelector,
    desiredItemCount,
  });

  if (mode === "programmatic") {
    const parsed = extractProgrammatically(html, { baseUrl });
    return { htmlLength: html.length, json: JSON.stringify(parsed) };
  }

  const json = await extractWithLLM(html, url, instruction);
  return { htmlLength: html.length, json };
}
