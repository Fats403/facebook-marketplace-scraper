import 'dotenv/config';
import puppeteer from 'puppeteer';
import OpenAI from 'openai';
import * as cheerio from 'cheerio';

function truncate(input, max = 120000) {
  if (!input) return '';
  return input.length <= max ? input : input.slice(0, max);
}

async function autoScroll(page, options = {}) {
  const {
    listItemSelector: itemSelector,
    desiredItemCount: targetCount = 30,
    maxScrolls = 50,
    delayMs = 800,
    stallRounds = 3
  } = options;

  let lastHeight = await page.evaluate(() => (document.scrollingElement || document.body).scrollHeight);
  let stall = 0;

  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement || document.body;
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
    });

    await new Promise(r => setTimeout(r, delayMs));

    if (itemSelector) {
      try {
        const count = await page.$$eval(itemSelector, els => els.length);
        if (count >= targetCount) break;
      } catch { /* ignore */ }
    }

    const newHeight = await page.evaluate(() => (document.scrollingElement || document.body).scrollHeight);
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
    desiredItemCount = 30
  } = options;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 120000 });

    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 20000 }).catch(() => {});
    }

    await page.waitForSelector('div[role="main"]', { timeout: 20000 }).catch(() => {});

    await autoScroll(page, { listItemSelector, desiredItemCount });

    await new Promise(resolve => setTimeout(resolve, 2000));

    const mainHtml = await page.$eval('div[role="main"]', el => el.outerHTML).catch(() => null);
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
  const cleaned = altText.replace(/\s+in\s+[^,]+,\s*[A-Z]{2,}\s*$/i, '').trim();
  return cleaned || altText;
}

export function extractProgrammatically(html, { baseUrl } = {}) {
  const $ = cheerio.load(html);
  const listings = [];

  $('a[href*="/marketplace/item/"]').each((_, el) => {
    const anchor = $(el);
    const href = anchor.attr('href') || null;
    const url = href ? (href.startsWith('http') ? href : (baseUrl ? new URL(href, baseUrl).toString() : href)) : null;

    const firstImg = anchor.find('img').first();
    const imageUrl = firstImg.attr('src') || null;
    const altText = firstImg.attr('alt') || null;

    // Gather all text inside anchor for price detection
    const textContent = anchor.text().replace(/\s+/g, ' ').trim();
    const price = normalizePrice(textContent);

    const name = cleanTitleFromAlt(altText) || null;

    listings.push({
      name: name || null,
      url: url || null,
      price: price || null,
      image_url: imageUrl || null
    });
  });

  // Deduplicate by URL when possible
  const seen = new Set();
  const deduped = listings.filter(item => {
    const key = item.url || `${item.name}|${item.image_url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { listings: deduped };
}

export async function extractWithLLM(html, targetUrl, naturalInstruction) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const truncated = truncate(html);

  const prompt = `
Task:
${naturalInstruction}

Requirements:
- Output only JSON (no markdown, no commentary).
- Use null when a requested field is missing.
- When extracting lists, use arrays of objects with consistent keys.
- The JSON should be returned with this exact format { "listings": [{"name": "<name>", "url": "<url>", "price": "<price>", "image_url": "<url>"}, ...] }

Context (HTML, truncated if large):
${truncated}
  `.trim();

  const res = await client.responses.create({
    model: 'gpt-5-mini',
    input: prompt,
    instructions: 'You are a precise data extractor that outputs strictly valid JSON',
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' }
  });

  return res.output_text;
}

export async function runScrape({ url, instruction, waitSelector, listItemSelector, desiredItemCount, mode = 'llm', baseUrl }) {
  const html = await getHtml(url, { waitSelector, listItemSelector, desiredItemCount });

  if (mode === 'programmatic') {
    const parsed = extractProgrammatically(html, { baseUrl });
    return { htmlLength: html.length, json: JSON.stringify(parsed) };
  }

  const json = await extractWithLLM(html, url, instruction);
  return { htmlLength: html.length, json };
} 