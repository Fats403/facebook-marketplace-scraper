import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { runScrape } from "./lib/scraper.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const BASE_URL = process.env.SCRAPE_BASE_URL || "https://www.facebook.com";
const HARDCODED_INSTRUCTION =
  'Extract marketplace listings as JSON with the shape { "listings": [{ "name": string|null, "url": string|null, "price": string|null, "image_url": string|null }] }.';

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.post("/api/scrape", async (req, res) => {
  try {
    const {
      query,
      daysSinceListed,
      mode,
      minPrice,
      maxPrice,
      category,
      exact,
      sortBy,
      radius,
      location,
      locationId,
      email,
      password,
      desiredItemCount,
      debug,
      postFilter,
    } = req.body || {};

    const queryText = typeof query === "string" ? query.trim() : "";
    const hasQuery = queryText.length > 0;
    const hasCategory = typeof category === "string" && category.trim() !== "";
    if (!hasQuery && !hasCategory) {
      return res
        .status(400)
        .json({ error: "Provide either query or category" });
    }

    const days = parseInt(daysSinceListed, 10);
    if (!Number.isFinite(days) || days <= 0) {
      return res
        .status(400)
        .json({ error: "daysSinceListed must be a positive integer" });
    }

    const locationSlug =
      typeof location === "string" && location.trim() !== ""
        ? location.trim()
        : "calgary";
    let locationSegment = encodeURIComponent(locationSlug);
    if (
      typeof locationId === "number" &&
      Number.isFinite(locationId) &&
      locationId > 0
    ) {
      locationSegment = encodeURIComponent(String(locationId));
    } else if (typeof locationId === "string" && locationId.trim() !== "") {
      locationSegment = encodeURIComponent(locationId.trim());
    }

    const categoryPath = hasCategory
      ? `/${encodeURIComponent(category.trim())}`
      : "/search";
    const pathStr = `/marketplace/${locationSegment}${categoryPath}`;

    const urlObj = new URL(pathStr, BASE_URL);
    urlObj.searchParams.set("daysSinceListed", String(days));
    if (hasQuery) {
      urlObj.searchParams.set("query", queryText);
    }

    if (exact === true) {
      urlObj.searchParams.set("exact", "true");
    }
    if (typeof sortBy === "string" && sortBy.trim() !== "") {
      urlObj.searchParams.set("sortBy", sortBy.trim());
    }
    const radiusNum = parseInt(radius, 10);
    if (Number.isFinite(radiusNum) && radiusNum > 0 && radiusNum <= 300) {
      urlObj.searchParams.set("radius", String(radiusNum));
    }

    const min = parseInt(minPrice, 10);
    if (Number.isFinite(min) && min >= 0) {
      urlObj.searchParams.set("minPrice", String(min));
    }
    const max = parseInt(maxPrice, 10);
    if (Number.isFinite(max) && max >= 0) {
      urlObj.searchParams.set("maxPrice", String(max));
    }

    const result = await runScrape({
      url: urlObj.toString(),
      instruction: HARDCODED_INSTRUCTION,
      mode: mode === "programmatic" ? "programmatic" : "llm",
      baseUrl: BASE_URL,
      loginEmail:
        typeof email === "string" && email.trim() !== ""
          ? email.trim()
          : undefined,
      loginPassword:
        typeof password === "string" && password !== "" ? password : undefined,
      desiredItemCount:
        Number.isFinite(parseInt(desiredItemCount, 10)) &&
        parseInt(desiredItemCount, 10) > 0
          ? parseInt(desiredItemCount, 10)
          : undefined,
      debug: debug === true,
      postFilter:
        typeof postFilter === "string" && postFilter.trim() !== ""
          ? postFilter.trim()
          : undefined,
    });

    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
