import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { runScrape } from './lib/scraper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const BASE_URL = process.env.SCRAPE_BASE_URL || 'https://www.facebook.com';
const HARDCODED_INSTRUCTION = 'Extract marketplace listings as JSON with the shape { "listings": [{ "name": string|null, "url": string|null, "price": string|null, "image_url": string|null }] }.';

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.post('/api/scrape', async (req, res) => {
  try {
    const { query, daysSinceListed, mode } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: 'Missing required field: query' });
    }

    // Validate and normalize daysSinceListed
    const days = parseInt(daysSinceListed, 10);
    if (!Number.isFinite(days) || days <= 0) {
      return res.status(400).json({ error: 'daysSinceListed must be a positive integer' });
    }

    const urlObj = new URL('/marketplace/calgary/search', BASE_URL);
    urlObj.searchParams.set('daysSinceListed', String(days));
    urlObj.searchParams.set('query', query);
    urlObj.searchParams.set('exact', 'false');

    const result = await runScrape({
      url: urlObj.toString(),
      instruction: HARDCODED_INSTRUCTION,
      mode: mode === 'programmatic' ? 'programmatic' : 'llm',
      baseUrl: BASE_URL
    });

    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
}); 