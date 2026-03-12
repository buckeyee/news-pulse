// Vercel serverless cron job: fetches Perplexity Discover feed and
// commits the updated cache to the GitHub repo.

const API_BASE = "https://www.perplexity.ai/rest/discover/feed";
const TOPICS = [
  { tab: "top", limit: 150 },
  { tab: "tech", limit: 50 },
  { tab: "finance", limit: 50 },
];
const REPO = "ppl-ai/news-pulse";
const FILE_PATH = "perplexity_cache.json";
const MIN_STORIES = 30;

async function fetchTopic(tab, limit) {
  const url = `${API_BASE}?tab=${tab}&limit=${limit}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!resp.ok) {
    console.error(`Failed to fetch ${tab}: ${resp.status}`);
    return [];
  }
  const data = await resp.json();
  return data.items || [];
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

async function getExistingFile(token) {
  const resp = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
    { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } }
  );
  if (!resp.ok) return { sha: null, count: 0 };
  const data = await resp.json();
  try {
    const content = JSON.parse(Buffer.from(data.content, "base64").toString());
    return { sha: data.sha, count: (content.stories || []).length };
  } catch {
    return { sha: data.sha, count: 0 };
  }
}

async function commitFile(token, content, sha) {
  const now = new Date().toISOString().replace(/\.\d+Z/, " UTC").replace("T", " ");
  const body = {
    message: `Update Discover cache [${now}]`,
    content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
    committer: { name: "news-pulse-bot", email: "news-pulse-bot@users.noreply.github.com" },
  };
  if (sha) body.sha = sha;

  const resp = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GitHub commit failed: ${resp.status} ${err}`);
  }
}

export default async function handler(req, res) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: "GITHUB_TOKEN not set" });

  // Fetch all topics
  const stories = [];
  for (const { tab, limit } of TOPICS) {
    const items = await fetchTopic(tab, limit);
    for (const item of items) {
      const story = buildStory(item, tab);
      if (story) stories.push(story);
    }
    console.log(`${tab}: ${items.length} items → ${stories.filter(s => s.topic === tab).length} stories`);
  }

  console.log(`Total: ${stories.length} stories`);

  if (stories.length < MIN_STORIES) {
    return res.status(200).json({ skipped: true, reason: `Only ${stories.length} stories (need ${MIN_STORIES}+)` });
  }

  // Check existing cache
  const existing = await getExistingFile(token);
  if (existing.count > 0 && stories.length < existing.count * 0.5) {
    return res.status(200).json({ skipped: true, reason: `New (${stories.length}) < half of existing (${existing.count})` });
  }

  // Build cache
  const topics = { top: [], tech: [], finance: [] };
  for (const s of stories) {
    if (topics[s.topic]) topics[s.topic].push(s);
  }

  const cache = {
    stories,
    cached_at: new Date().toISOString().replace(/\.\d+Z/, "Z"),
    topics,
  };

  // Commit to GitHub
  await commitFile(token, cache, existing.sha);

  return res.status(200).json({ ok: true, stories: stories.length, topics: Object.fromEntries(Object.entries(topics).map(([k, v]) => [k, v.length])) });
}
