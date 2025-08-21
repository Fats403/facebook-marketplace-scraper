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
    const { query, daysSinceListed, mode, minPrice, maxPrice, category } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: 'Missing required field: query' });
    }

    const days = parseInt(daysSinceListed, 10);
    if (!Number.isFinite(days) || days <= 0) {
      return res.status(400).json({ error: 'daysSinceListed must be a positive integer' });
    }

    const categoryPath = (typeof category === 'string' && category.trim() !== '') ? category.trim() : '';
    const pathStr = categoryPath ? `/marketplace/calgary/${encodeURIComponent(categoryPath)}` : '/marketplace/calgary/search';
    const urlObj = new URL(pathStr, BASE_URL);
    urlObj.searchParams.set('daysSinceListed', String(days));
    urlObj.searchParams.set('query', query);
    urlObj.searchParams.set('exact', 'false');
    urlObj.searchParams.set('sortBy', 'creation_time_descend');
    urlObj.searchParams.set('radius', '200');

    const min = parseInt(minPrice, 10);
    if (Number.isFinite(min) && min >= 0) {
      urlObj.searchParams.set('minPrice', String(min));
    }
    const max = parseInt(maxPrice, 10);
    if (Number.isFinite(max) && max >= 0) {
      urlObj.searchParams.set('maxPrice', String(max));
    }

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