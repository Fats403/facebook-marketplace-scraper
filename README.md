# Facebook Marketplace Scraper

A local web tool to scrape Facebook Marketplace search/category pages, auto-scroll to collect many results (even when logged in), and extract structured listing data using either an LLM or a fast programmatic parser.

## Features

- Optional login: type-like-human into `name="email"` and `name="pass"`, then submit just like a user
- Headful debug mode (watch the browser) or headless mode for background runs
- Smart auto-scroll with cumulative item tracking (works with virtualized feeds)
- Desired item target: stop as soon as we’ve collected N unique listings
- Notification prompt suppression/dismissal after login to prevent blocking
- Two extraction modes:
  - LLM (Gemini): high-quality structured JSON
  - Parser (Cheerio): fast, no-LLM, DOM-based extraction
- Simple local web UI with fields for query/category, location, radius, price range, days since listed, sort exact/newest, optional login, desired items, and debug

## Requirements

- Node.js 18+
- For LLM mode: Google Gemini API key (`GOOGLE_API_KEY` or `GEMINI_API_KEY`)

## Install

```bash
npm install
```

## Environment

Create a `.env` (optional) or export env vars:

- `GOOGLE_API_KEY` or `GEMINI_API_KEY` (required for LLM mode)
- `GEMINI_MODEL` (optional): defaults to `gemini-2.5-pro`
- `PORT` (optional): defaults to `3000`
- `SCRAPE_BASE_URL` (optional): defaults to `https://www.facebook.com`
- `PUPPETEER_SKIP_DOWNLOAD` (optional): set `true` to skip Chromium auto-download

## Run the Web UI (local only)

```bash
npm start
```

Open `http://localhost:3000`, fill out the form, and click Run.

Form fields include:

- Query or Category (one required)
- Location (city slug or numeric ID), radius
- Min/Max Price, Days Since Listed, Sort newest, Exact match
- Extraction Mode: AI (LLM) or Parser
- Email and Password (optional) to log in first
- Desired Items (stop after N unique items)
- Show browser (debug) to watch and log the run

Example of the URL it builds:

```
https://www.facebook.com/marketplace/calgary/search?query=<encoded>&daysSinceListed=<int>&exact=false
```

## API (optional)

`POST /api/scrape`

Body (JSON):

```json
{
  "query": "iphone",
  "category": "bicycles",
  "location": "calgary",
  "locationId": 102190403,
  "radius": 200,
  "minPrice": 100,
  "maxPrice": 500,
  "daysSinceListed": 7,
  "exact": true,
  "sortBy": "creation_time_descend",
  "mode": "programmatic",
  "desiredItemCount": 60,
  "email": "you@example.com",
  "password": "yourPassword123",
  "debug": true
}
```

Response:

```json
{ "htmlLength": 123456, "json": "{\"listings\":[...]}" }
```

## How extraction works

### Programmatic Parser

- Parses a container (or synthetic container) after scrolling completes
- Walks each listing `a[href*="/marketplace/item/"]` and collects:
  - `url` (made absolute using base URL)
  - `image_url` (first `img` inside)
  - `name` (from `img[alt]`, with trailing location stripped)
  - `price` (`$..`, `CA$..`, or `Free` from anchor text)
- Dedupes by URL (or name+image fallback)

### LLM (Gemini)

- Builds a compact JSON context of candidate items and asks the model to emit `{ listings: [...] }` with the same fields as above

## Troubleshooting

- Login fills the email/password fields and submits using Enter on password, then button click fallbacks. If your login UI differs, update the selectors.
- If a notification dialog appears post-login and blocks scrolling, it’s auto-suppressed; if you see a new variation, add the button text to the dismiss list.
- Use the “Show browser (debug)” checkbox to watch the run and view detailed logs, including scrolling and typing.
- If Chromium download fails during install, set `PUPPETEER_SKIP_DOWNLOAD=true` and ensure a compatible Chrome/Chromium is available on your system.

## Legal/Usage Notice

- This tool is for educational and personal use only.
- Ensure you have permission and comply with all applicable laws, site Terms of Service, and robots.txt directives.
- The authors are not responsible for any unauthorized use or damages. Use at your own risk.
