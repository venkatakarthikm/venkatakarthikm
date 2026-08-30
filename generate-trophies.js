#!/usr/bin/env node
/**
 * GitHub Profile Trophy Generator — self-hosted, no Vercel dependency.
 *
 * Usage:
 *   GH_TOKEN=ghp_xxx node generate-trophies.js <username> [outputPath]
 *
 * Requires a GitHub Personal Access Token (classic) with "public_repo" and
 * "read:user" scopes so we can use the GraphQL API for commit history.
 * Create one at: https://github.com/settings/tokens
 *
 * Output: an SVG file you can commit to your repo and reference directly
 * in your README — no live server, no rate limits, no downtime.
 */

const https = require("https");

const USERNAME = process.argv[2];
const OUTPUT_PATH = process.argv[3] || "trophies.svg";
const TOKEN = process.env.GH_TOKEN;

if (!USERNAME) {
  console.error("Usage: GH_TOKEN=xxx node generate-trophies.js <username> [outputPath]");
  process.exit(1);
}
if (!TOKEN) {
  console.error("Missing GH_TOKEN environment variable. Create one at https://github.com/settings/tokens");
  process.exit(1);
}

// ---------- Small HTTP helpers (no external deps) ----------

function restGet(path) {
  return new Promise((resolve, reject) => {
    https.get(
      {
        hostname: "api.github.com",
        path,
        headers: {
          "User-Agent": "self-hosted-trophy-generator",
          Authorization: `token ${TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    ).on("error", reject);
  });
}

function graphql(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request(
      {
        hostname: "api.github.com",
        path: "/graphql",
        method: "POST",
        headers: {
          "User-Agent": "self-hosted-trophy-generator",
          Authorization: `bearer ${TOKEN}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------- Stat collection ----------

async function getUserStats(username) {
  const user = await restGet(`/users/${username}`);
  if (user.message) throw new Error(`GitHub API error: ${user.message}`);

  // Paginate through repos to sum stars and count repos
  let page = 1;
  let stars = 0;
  let repoCount = 0;
  while (true) {
    const repos = await restGet(`/users/${username}/repos?per_page=100&page=${page}`);
    if (!Array.isArray(repos) || repos.length === 0) break;
    repoCount += repos.length;
    stars += repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
    if (repos.length < 100) break;
    page++;
  }

  // GraphQL: total commit contributions across every year since account creation
  const createdYear = new Date(user.created_at).getFullYear();
  const currentYear = new Date().getFullYear();
  let totalCommits = 0;
  let totalPRs = 0;
  let totalIssues = 0;
  let totalReviews = 0;

  for (let year = createdYear; year <= currentYear; year++) {
    const from = `${year}-01-01T00:00:00Z`;
    const to = `${year}-12-31T23:59:59Z`;
    const query = `
      query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            totalCommitContributions
            totalPullRequestContributions
            totalIssueContributions
            totalPullRequestReviewContributions
          }
        }
      }`;
    const res = await graphql(query, { login: username, from, to });
    const c = res?.data?.user?.contributionsCollection;
    if (c) {
      totalCommits += c.totalCommitContributions;
      totalPRs += c.totalPullRequestContributions;
      totalIssues += c.totalIssueContributions;
      totalReviews += c.totalPullRequestReviewContributions;
    }
  }

  const yearsActive = currentYear - createdYear + 1;

  return {
    followers: user.followers || 0,
    repos: repoCount,
    stars,
    commits: totalCommits,
    pullRequests: totalPRs,
    issues: totalIssues,
    reviews: totalReviews,
    yearsActive,
  };
}

// ---------- Ranking ----------

// Threshold tiers, low to high. Tune these to taste.
const TIERS = [
  { name: "C", color: "#4C566A" },
  { name: "B", color: "#5E81AC" },
  { name: "A", color: "#81A1C1" },
  { name: "AA", color: "#88C0D0" },
  { name: "AAA", color: "#A3BE8C" },
  { name: "S", color: "#EBCB8B" },
  { name: "SS", color: "#D08770" },
  { name: "SSS", color: "#BF616A" },
];

function rankFor(value, thresholds) {
  let idx = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (value >= thresholds[i]) idx = i + 1;
  }
  idx = Math.min(idx, TIERS.length - 1);
  return TIERS[idx];
}

const TROPHY_DEFS = [
  { key: "followers", label: "Followers", icon: "\u{1F465}", thresholds: [1, 5, 10, 25, 50, 100, 300, 1000] },
  { key: "repos", label: "Repositories", icon: "\u{1F4C1}", thresholds: [1, 5, 10, 20, 35, 50, 80, 120] },
  { key: "stars", label: "Stars", icon: "\u{2B50}", thresholds: [1, 5, 15, 30, 60, 120, 300, 700] },
  { key: "commits", label: "Commits", icon: "\u{1F4BB}", thresholds: [10, 50, 150, 400, 800, 1500, 3000, 6000] },
  { key: "pullRequests", label: "Pull Requests", icon: "\u{1F500}", thresholds: [1, 5, 15, 30, 60, 100, 200, 400] },
  { key: "issues", label: "Issues", icon: "\u{2753}", thresholds: [1, 5, 10, 20, 40, 70, 120, 200] },
  { key: "reviews", label: "Reviews", icon: "\u{1F441}", thresholds: [1, 3, 8, 15, 30, 50, 90, 150] },
  { key: "yearsActive", label: "Experience", icon: "\u{1F4C5}", thresholds: [1, 2, 3, 4, 5, 6, 8, 10] },
];

// ---------- SVG rendering ----------

function renderSVG(stats, username) {
  const cols = 4;
  const cardW = 200;
  const cardH = 130;
  const gap = 12;
  const rows = Math.ceil(TROPHY_DEFS.length / cols);
  const width = cols * cardW + (cols - 1) * gap;
  const height = rows * cardH + (rows - 1) * gap;

  const cards = TROPHY_DEFS.map((def, i) => {
    const value = stats[def.key] ?? 0;
    const tier = rankFor(value, def.thresholds);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * (cardW + gap);
    const y = row * (cardH + gap);

    return `
    <g transform="translate(${x},${y})">
      <rect width="${cardW}" height="${cardH}" rx="10" fill="#161B22" stroke="${tier.color}" stroke-width="2"/>
      <text x="16" y="30" font-size="22" font-family="sans-serif">${def.icon}</text>
      <text x="50" y="30" font-size="14" fill="#C9D1D9" font-family="sans-serif" font-weight="bold">${def.label}</text>
      <text x="16" y="70" font-size="30" fill="${tier.color}" font-family="sans-serif" font-weight="bold">${value}</text>
      <text x="16" y="105" font-size="16" fill="${tier.color}" font-family="monospace" font-weight="bold">Rank ${tier.name}</text>
    </g>`;
  }).join("");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="transparent"/>
  <title>${username}'s GitHub Trophies</title>
  ${cards}
</svg>`;
}

// ---------- Main ----------

(async () => {
  console.error(`Fetching stats for ${USERNAME}...`);
  const stats = await getUserStats(USERNAME);
  console.error("Stats:", stats);

  const svg = renderSVG(stats, USERNAME);
  require("fs").writeFileSync(OUTPUT_PATH, svg);
  console.error(`Wrote ${OUTPUT_PATH}`);
})().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
