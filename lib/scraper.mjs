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
    debug = false,
    useKeyboardFallback = true,
    arrowDownPressesPerRound = 40,
  } = options;

  // Select a robust scroll root element and record initial height
  await page.evaluate((selector) => {
    function isScrollable(el) {
      if (!el) return false;
      const cs = getComputedStyle(el);
      const overflowY = cs.overflowY;
      const span = el.scrollHeight - el.clientHeight;
      return (
        span > 4 &&
        (overflowY === "auto" ||
          overflowY === "scroll" ||
          overflowY === "overlay")
      );
    }
    const container = document.querySelector(selector);
    const docEl =
      document.scrollingElement || document.documentElement || document.body;
    const candidates = new Set();
    if (container) candidates.add(container);
    for (const sel of [
      '[role="feed"]',
      '[data-pagelet="MainFeed"]',
      "[aria-label]",
      "main",
      "section",
      "div",
    ]) {
      for (const n of Array.from(document.querySelectorAll(sel))) {
        candidates.add(n);
      }
    }
    let best = null;
    let bestSpan = 0;
    candidates.add(docEl);
    for (const n of candidates) {
      if (!n) continue;
      if (!isScrollable(n)) continue;
      const span = n.scrollHeight - n.clientHeight;
      if (span > bestSpan) {
        best = n;
        bestSpan = span;
      }
    }
    window.__SCROLL_EL__ = best || docEl;
    try {
      const el = window.__SCROLL_EL__;
      const desc = el
        ? `${el.tagName.toLowerCase()}#${el.id || ""}.${Array.from(
            el.classList || []
          ).join(".")}`
        : "document";
      console.log("[scroll] selected root:", desc);
    } catch {}
  }, containerSelector);
  let lastHeight = await page.evaluate(() => {
    const docEl =
      document.scrollingElement || document.documentElement || document.body;
    const el = window.__SCROLL_EL__ || docEl;
    return el ? el.scrollHeight : docEl.scrollHeight;
  });
  let stall = 0;

  for (let i = 0; i < maxScrolls; i++) {
    // Incremental scroll on chosen root and ensure last child is visible
    await page.evaluate(() => {
      const docEl =
        document.scrollingElement || document.documentElement || document.body;
      const el = window.__SCROLL_EL__ || docEl;
      try {
        const increment = Math.max(200, Math.floor(window.innerHeight * 0.9));
        el.scrollTop = Math.min(el.scrollTop + increment, el.scrollHeight);
        el.dispatchEvent(new Event("scroll", { bubbles: true }));
      } catch {}
      try {
        el.lastElementChild &&
          el.lastElementChild.scrollIntoView({ block: "end" });
      } catch {}
      try {
        window.dispatchEvent(new Event("scroll"));
      } catch {}
    });

    await new Promise((r) => setTimeout(r, delayMs));

    // Mouse wheel fallback to trigger observers
    try {
      await page.mouse.move(200, 200);
      await page.mouse.wheel({ deltaY: 1200 });
    } catch {}

    // ArrowDown fallback: some pages only advance on key events
    if (useKeyboardFallback) {
      try {
        // Try to focus the scroll container (or body) to ensure key events are handled
        await page
          .evaluate((selector) => {
            const el = document.querySelector(selector) || document.body;
            if (el && typeof el.focus === "function") {
              el.focus();
              try {
                el.dispatchEvent(new Event("focus", { bubbles: true }));
              } catch {}
            }
          }, containerSelector)
          .catch(() => {});

        if (debug)
          console.log(`[scroll] ArrowDown x${arrowDownPressesPerRound}`);
        for (let k = 0; k < arrowDownPressesPerRound; k++) {
          await page.keyboard.press("ArrowDown");
          await new Promise((r) => setTimeout(r, 10));
        }
      } catch {}
    }

    // Maintain cumulative seen anchors and count
    const cumulativeCount = await page
      .evaluate((sel) => {
        const selector = sel || 'a[href*="/marketplace/item/"]';
        const anchors = Array.from(document.querySelectorAll(selector));
        if (!window.__SEEN_ITEMS__) window.__SEEN_ITEMS__ = {};
        for (const a of anchors) {
          const href = a.getAttribute("href") || "";
          const img = a.querySelector("img");
          const imgSrc = img?.getAttribute("src") || "";
          const key = `${href}|${imgSrc}`;
          if (!window.__SEEN_ITEMS__[key]) {
            window.__SEEN_ITEMS__[key] = a.outerHTML;
          }
        }
        return Object.keys(window.__SEEN_ITEMS__).length;
      }, itemSelector)
      .catch(() => undefined);

    if (debug && typeof cumulativeCount === "number") {
      console.log(`[scroll] iteration ${i}: cumulative=${cumulativeCount}`);
    }

    // Optional keyboard fallback to trigger lazy loaders attached to key events
    if (useKeyboardFallback && i % 3 === 0) {
      try {
        await page.keyboard.press("End");
      } catch {}
    }

    if (itemSelector) {
      try {
        // Prefer cumulative count when available; fallback to visible count
        let count = cumulativeCount;
        if (typeof count !== "number") {
          count = await page.$$eval(itemSelector, (els) => els.length);
        }
        if (debug) console.log(`[scroll] iteration ${i}: items=${count}`);
        if (count >= targetCount) break;
      } catch {
        /* ignore */
      }
    }

    const newHeight = await page.evaluate(() => {
      const docEl =
        document.scrollingElement || document.documentElement || document.body;
      const el = window.__SCROLL_EL__ || docEl;
      return el ? el.scrollHeight : docEl.scrollHeight;
    });
    if (debug)
      console.log(
        `[scroll] iteration ${i}: height ${lastHeight} -> ${newHeight}`
      );
    if (newHeight <= lastHeight) {
      stall += 1;
      if (stall >= stallRounds) break;
    } else {
      stall = 0;
      lastHeight = newHeight;
    }
  }
}

async function typeLikeHuman(page, selector, text, opts = {}) {
  const { minDelayMs = 70, maxDelayMs = 160 } = opts || {};
  const handle = await page.$(selector);
  if (!handle) return false;
  try {
    await handle.focus();
  } catch {
    return false;
  }
  try {
    await handle.click({ clickCount: 3 });
    // Clear value directly on the element to avoid sending Backspace to the wrong field
    await handle.evaluate((el) => {
      if (el && "value" in el) {
        el.value = "";
        try {
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } catch {}
        try {
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } catch {}
      }
    });
  } catch {}
  for (const ch of String(text)) {
    const jitter = Math.floor(
      minDelayMs + Math.random() * Math.max(0, maxDelayMs - minDelayMs)
    );
    await handle.type(ch, { delay: jitter });
  }
  return true;
}

export async function getHtml(targetUrl, options = {}) {
  const {
    waitSelector,
    listItemSelector,
    desiredItemCount = 30,
    containerSelector = 'div[role="main"]',
    // Optional login flow
    loginEmail,
    loginPassword,
    baseUrl: explicitBaseUrl,
    debug = false,
  } = options;

  const browser = await puppeteer.launch({
    headless: debug ? false : true,
    slowMo: debug ? 50 : 0,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-notifications",
    ],
  });
  try {
    const page = await browser.newPage();
    if (debug) {
      page.on("console", (msg) => {
        const type = msg.type();
        const text = msg.text();
        console.log(`[page:${type}]`, text);
      });
      page.on("requestfailed", (req) => {
        console.warn(
          "[request failed]",
          req.method(),
          req.url(),
          req.failure()?.errorText
        );
      });
      page.on("response", (res) => {
        if (res.status() >= 400) {
          console.warn("[response]", res.status(), res.url());
        }
      });
    }

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );

    // Go directly to the requested URL first
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });

    // If credentials provided, attempt login on the current page (best-effort)
    if (
      typeof loginEmail === "string" &&
      loginEmail.trim() !== "" &&
      typeof loginPassword === "string" &&
      loginPassword !== ""
    ) {
      try {
        // Wait for login inputs to appear (best-effort)
        await page
          .waitForSelector('input[name="email"]', { timeout: 20000 })
          .catch(() => {});
        await page
          .waitForSelector('input[name="pass"]', { timeout: 20000 })
          .catch(() => {});

        // Fill values if inputs exist (type with random delays)
        const hasEmail = await page.$('input[name="email"]');
        const hasPass = await page.$('input[name="pass"]');
        if (hasEmail && hasPass) {
          const emailTyped = await typeLikeHuman(
            page,
            'input[name="email"]',
            loginEmail.trim(),
            {
              minDelayMs: 60,
              maxDelayMs: 140,
            }
          );

          // Move focus to password via Tab and type password there (only method)
          try {
            await page.click('input[name="email"]').catch(() => {});
            let passFocused = false;
            for (let i = 0; i < 8; i++) {
              await page.keyboard.press("Tab");
              await new Promise((r) => setTimeout(r, 80));
              passFocused = await page.evaluate(() => {
                const ae = document.activeElement;
                const n = ae?.getAttribute?.("name");
                const t = ae?.getAttribute?.("type");
                return n === "pass" || t === "password";
              });
              if (passFocused) break;
            }

            if (passFocused) {
              // Ensure the password input is definitely focused
              await page.click('input[name="pass"]').catch(() => {});

              // Type each character with jitter and log if debug
              for (let idx = 0; idx < String(loginPassword).length; idx++) {
                const ch = String(loginPassword)[idx];
                const jitter = Math.floor(60 + Math.random() * 80);
                if (debug) {
                  console.log(
                    `[login] typing pass char ${idx}: ${JSON.stringify(
                      ch
                    )} code=${ch.charCodeAt(0)}`
                  );
                }
                await page.keyboard.type(ch, { delay: jitter });
              }

              // Verify length only (no retype)
              const typedLen = await page.evaluate(() => {
                const el = document.querySelector('input[name="pass"]');
                return el && typeof el.value === "string" ? el.value.length : 0;
              });
              if (debug) {
                console.log(
                  `[login] pass length typed=${typedLen} expected=${
                    String(loginPassword).length
                  }`
                );
              }

              // Attempt to submit: Enter on password, then click login button, then fallback to form submit
              let submitted = false;
              try {
                await page.focus('input[name="pass"]').catch(() => {});
                await page.keyboard.press("Enter");
                if (debug)
                  console.log("[login] submitted via Enter on password");
                submitted = true;
              } catch {}

              if (!submitted) {
                try {
                  const sel = 'button[name="login"]';
                  const btn = await page.$(sel);
                  if (btn) {
                    if (debug)
                      console.log("[login] clicking button[name=login]");
                    await btn.click({ delay: 50 });
                    submitted = true;
                  }
                } catch {}
              }

              if (!submitted) {
                try {
                  const sel = 'button[type="submit"], input[type="submit"]';
                  const btn = await page.$(sel);
                  if (btn) {
                    if (debug)
                      console.log("[login] clicking generic submit button");
                    await btn.click({ delay: 50 });
                    submitted = true;
                  }
                } catch {}
              }

              if (!submitted) {
                if (debug)
                  console.log("[login] falling back to form.requestSubmit");
                submitted = await page.evaluate(() => {
                  const emailEl = document.querySelector('input[name="email"]');
                  const passEl = document.querySelector('input[name="pass"]');
                  const form =
                    passEl?.form ||
                    emailEl?.form ||
                    passEl?.closest?.("form") ||
                    emailEl?.closest?.("form");
                  if (form) {
                    if (typeof form.requestSubmit === "function") {
                      form.requestSubmit();
                    } else {
                      form.submit();
                    }
                    return true;
                  }
                  return false;
                });
              }

              // Wait for navigation or network to settle, but don't fail hard
              await Promise.race([
                page.waitForNavigation({
                  waitUntil: "networkidle2",
                  timeout: 30000,
                }),
                (async () => {
                  await new Promise((r) => setTimeout(r, 5000));
                })(),
              ]).catch(() => {});
            }
          } catch {}

          // Attempt to submit via nearest form if present
          const submitted = await page.evaluate(() => {
            const emailEl = document.querySelector('input[name="email"]');
            const passEl = document.querySelector('input[name="pass"]');
            const form =
              passEl?.form ||
              emailEl?.form ||
              passEl?.closest?.("form") ||
              emailEl?.closest?.("form");
            if (form) {
              if (typeof form.requestSubmit === "function") {
                form.requestSubmit();
              } else {
                form.submit();
              }
              return true;
            }
            const btn = document.querySelector(
              'button[type="submit"], input[type="submit"]'
            );
            if (btn) {
              btn.click();
              return true;
            }
            return false;
          });

          // Wait for navigation or network to settle, but don't fail hard
          await Promise.race([
            page.waitForNavigation({
              waitUntil: "networkidle2",
              timeout: 30000,
            }),
            (async () => {
              await new Promise((r) => setTimeout(r, 5000));
            })(),
          ]).catch(() => {});
        }
      } catch {
        // Best-effort login; proceed to target regardless
      }
    }

    if (waitSelector) {
      await page
        .waitForSelector(waitSelector, { timeout: 20000 })
        .catch(() => {});
    }

    await page
      .waitForSelector(containerSelector, { timeout: 20000 })
      .catch(() => {});

    if (debug) {
      console.log("[debug] starting autoScroll...");
    }
    await autoScroll(page, {
      listItemSelector,
      desiredItemCount,
      containerSelector,
      debug,
      useKeyboardFallback: true,
    });
    if (debug) {
      console.log("[debug] finished autoScroll");
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Prefer cumulative anchors if collected during scrolling
    const cumulativeAnchors = await page
      .evaluate(() => Object.values(window.__SEEN_ITEMS__ || {}))
      .catch(() => []);
    if (Array.isArray(cumulativeAnchors) && cumulativeAnchors.length > 0) {
      const synthetic = `<div id="synthetic-container">${cumulativeAnchors.join(
        ""
      )}</div>`;
      return synthetic;
    }

    const mainHtml = await page
      .$eval(containerSelector, (el) => el.outerHTML)
      .catch(() => null);
    if (mainHtml) return mainHtml;

    const content = await page.content();
    if (debug) {
      // Give some time to observe the state before closing
      await new Promise((r) => setTimeout(r, 2000));
    }
    return content;
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
  loginEmail,
  loginPassword,
  debug = false,
}) {
  const html = await getHtml(url, {
    waitSelector,
    listItemSelector: listItemSelector || 'a[href*="/marketplace/item/"]',
    desiredItemCount: desiredItemCount || (mode === "programmatic" ? 60 : 40),
    baseUrl,
    loginEmail,
    loginPassword,
    debug,
  });

  if (mode === "programmatic") {
    const parsed = extractProgrammatically(html, { baseUrl });
    return { htmlLength: html.length, json: JSON.stringify(parsed) };
  }

  const json = await extractWithLLM(html, url, instruction);
  return { htmlLength: html.length, json };
}
