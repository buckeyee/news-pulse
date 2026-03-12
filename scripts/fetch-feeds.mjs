// Fetches Perplexity Discover feeds and writes perplexity_cache.json.
// Uses Node.js built-in fetch (undici) which has a different TLS
// fingerprint than Python/curl — may bypass Cloudflare blocking.

const API_BASE = "https://www.perplexity.ai/rest/discover/feed";
const TOPICS = [
  { tab: "top", limit: 150 },
  { tab: "tech", limit: 50 },
  { tab: "finance", limit: 50 },
];
const MIN_STORIES = 30;

import { readFileSync, writeFileSync, existsSync } from "fs";

async function fetchTopic(tab, limit) {
  const url = `${API_BASE}?tab=${tab}&limit=${limit}`;
  console.log(`Fetching ${url} ...`);
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) {
      console.error(`  Error ${resp.status} for ${tab}`);
      return [];
    }
    const data = await resp.json();
    const items = data.items || [];
    console.log(`  Got ${items.length} items for ${tab}`);
    return items;
  } catch (e) {
    console.error(`  Error fetching ${tab}: ${e.message}`);
    return [];
  }
}

function buildStory(item, topic) {
  const title = (item.title || "").trim();
  if (!title) return null;

  const slug = item.slug || "";
  const uuid = item.uuid || "";
  const url = slug
    ? `https://www.perplexity.ai/page/${slug}`
    : uuid
      ? `https://www.perplexity.ai/page/${uuid}`
      : null;
  if (!url) return null;

  let pubDate = item.published_timestamp || item.updated_datetime || "";
  if (pubDate) {
    pubDate = pubDate.split(".")[0];
    if (!pubDate.endsWith("Z")) pubDate = pubDate.replace("+00:00", "") + "Z";
  }

  let sourceCount = "";
  const preview = item.web_results_preview;
  if (preview && typeof preview === "object" && preview.total_count) {
    sourceCount = `${preview.total_count} sources`;
  }

  const description = (item.summary || item.first_answer || "").trim();

  return { title, url, description, source: "Perplexity", topic, pubDate, sourceCount };
}

// Fetch all topics
const stories = [];
for (const { tab, limit } of TOPICS) {
  const items = await fetchTopic(tab, limit);
  for (const item of items) {
    const story = buildStory(item, tab);
    if (story) stories.push(story);
  }
  console.log(`  Total for ${tab}: ${stories.filter((s) => s.topic === tab).length}`);
}

console.log(`Fetched: ${stories.length} stories`);

if (stories.length < MIN_STORIES) {
  console.error(`Only ${stories.length} stories (need ${MIN_STORIES}+). Keeping existing cache.`);
  process.exit(0);
}

// Check existing cache
let existingCount = 0;
if (existsSync("perplexity_cache.json")) {
  try {
    const existing = JSON.parse(readFileSync("perplexity_cache.json", "utf8"));
    existingCount = (existing.stories || []).length;
  } catch {}
}
console.log(`Existing cache: ${existingCount} stories`);

if (existingCount > 0 && stories.length < existingCount * 0.5) {
  console.error(`New (${stories.length}) < half of existing (${existingCount}). Keeping cache.`);
  process.exit(0);
}

// Build and write cache
const topics = { top: [], tech: [], finance: [] };
for (const s of stories) if (topics[s.topic]) topics[s.topic].push(s);

const cache = {
  stories,
  cached_at: new Date().toISOString().replace(/\.\d+Z/, "Z"),
  topics,
};

writeFileSync("perplexity_cache.json", JSON.stringify(cache, null, 2));
console.log(`Wrote ${stories.length} stories to perplexity_cache.json`);
