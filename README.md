# Facebook Marketplace Scraper

A very basic local web/CLI tool to scrape marketplace pages, optionally auto-scroll for more results, and extract listing data using either an LLM or a programmatic HTML parser.

Currently only works in a logged-out state so you can only retreive about ~24 listings or so.

## Features

- Headless scraping with Puppeteer, scoped to `div[role="main"]`
- Auto-scroll to load more listings
- Two extraction modes:
  - LLM (OpenAI): schema-like JSON extraction
  - Parser (Cheerio): fast, no-LLM, DOM-based extraction
- Simple local web UI to enter a query and days filter

## Requirements

- Node.js 18+
- An OpenAI API key (for LLM mode)

## Install

```bash
npm install
```

## Environment

Create a `.env` (optional) or export env vars:

- `OPENAI_API_KEY` (required for LLM mode)
- `OPENAI_MODEL` (optional) defaults to `gpt-5-nano`
- `PORT` (optional): defaults to `3000`
- `PUPPETEER_SKIP_DOWNLOAD` (optional): set to `true` to skip Chromium auto-download if Puppeteer install/download fails

## Run the Web UI (local only)

```bash
npm start
```

Visit `http://localhost:3000`.

- Enter a search query and choose a "Days Since Listed" filter.
- Choose Extraction Mode: "AI (LLM)" or "Parser".
- Click Run to scrape and extract; click Reset to clear the UI.

The server builds a URL like:

```
https://www.facebook.com/marketplace/calgary/search?query=<encoded>&daysSinceListed=<int>&exact=false
```

### Programmatic Parser

- Uses Cheerio to extract per-listing data by walking each listing link `a[href*="/marketplace/item/"]` and collecting:
  - `url`: anchor `href` (relative made absolute using base URL)
  - `image_url`: first `img` within the anchor
  - `name`: `alt` text of the image (location suffix trimmed)
  - `price`: regex match in the anchor text (e.g., `$..`, `CA$..`, `Free`)
- Results are deduped by URL.

## Troubleshooting

- Puppeteer issues:
  - macOS may need additional permissions; the project runs Chromium bundled with Puppeteer.
  - The script uses `--no-sandbox` flags by default for convenience.
  - If Chromium auto-download fails during install, set `PUPPETEER_SKIP_DOWNLOAD=true` in your `.env` to skip the download and use a system-installed Chrome/Chromium.

## Legal/Usage Notice

- This tool is provided for educational and personal use only.
- You are solely responsible for how you use it. Ensure you have permission to access and scrape any site you target, and comply with all applicable laws, site Terms of Service, and robots.txt directives.
- The author and contributors are not responsible for any unauthorized use, misuse, or damages resulting from the use of this tool. Use at your own risk.