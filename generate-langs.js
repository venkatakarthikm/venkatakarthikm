#!/usr/bin/env node
/**
 * Self-hosted "Top Languages" SVG generator — no Vercel dependency.
 *
 * Usage:
 *   GH_TOKEN=ghp_xxx node generate-langs.js <username> [outputPath]
 *
 * Uses the same token as generate-trophies.js (public_repo, read:user scopes).
 */

const https = require("https");

const USERNAME = process.argv[2];
const OUTPUT_PATH = process.argv[3] || "langs.svg";
const TOKEN = process.env.GH_TOKEN;

if (!USERNAME) {
  console.error("Usage: GH_TOKEN=xxx node generate-langs.js <username> [outputPath]");
  process.exit(1);
}
if (!TOKEN) {
  console.error("Missing GH_TOKEN environment variable. Create one at https://github.com/settings/tokens");
  process.exit(1);
}

function restGet(path) {
  return new Promise((resolve, reject) => {
    https.get(
      {
        hostname: "api.github.com",
        path,
        headers: {
          "User-Agent": "self-hosted-langs-generator",
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

// Official-ish GitHub linguist colors for common languages. Falls back to grey.
const LANG_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Java: "#b07219",
  Kotlin: "#A97BFF",
  Python: "#3572A5",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Dockerfile: "#384d54",
  Shell: "#89e051",
  "C++": "#f34b7d",
  C: "#555555",
  Go: "#00ADD8",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Rust: "#dea584",
  Swift: "#F05138",
};
const FALLBACK_COLOR = "#8b949e";

async function getLanguageBreakdown(username) {
  let page = 1;
  const langBytes = {};

  while (true) {
    const repos = await restGet(`/users/${username}/repos?per_page=100&page=${page}`);
    if (!Array.isArray(repos) || repos.length === 0) break;

    for (const repo of repos) {
      if (repo.fork) continue; // skip forked repos, only count original work
      const langs = await restGet(`/repos/${username}/${repo.name}/languages`);
      if (langs && typeof langs === "object" && !langs.message) {
        for (const [lang, bytes] of Object.entries(langs)) {
          langBytes[lang] = (langBytes[lang] || 0) + bytes;
        }
      }
    }

    if (repos.length < 100) break;
    page++;
  }

  const total = Object.values(langBytes).reduce((a, b) => a + b, 0);
  const breakdown = Object.entries(langBytes)
    .map(([lang, bytes]) => ({
      lang,
      bytes,
      pct: total > 0 ? (bytes / total) * 100 : 0,
      color: LANG_COLORS[lang] || FALLBACK_COLOR,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 7); // top 7 languages

  return breakdown;
}

function renderSVG(breakdown, username) {
  const width = 340;
  const barHeight = 12;
  const rowHeight = 24;
  const paddingTop = 40;
  const height = paddingTop + breakdown.length * rowHeight + 16;

  // Segmented proportion bar at the top
  let x = 20;
  const barWidth = width - 40;
  const segments = breakdown
    .map((d) => {
      const segW = (d.pct / 100) * barWidth;
      const rect = `<rect x="${x}" y="20" width="${segW}" height="${barHeight}" fill="${d.color}" />`;
      x += segW;
      return rect;
    })
    .join("");

  const rows = breakdown
    .map((d, i) => {
      const y = paddingTop + i * rowHeight;
      return `
    <circle cx="26" cy="${y + 5}" r="5" fill="${d.color}" />
    <text x="40" y="${y + 10}" font-size="13" fill="#C9D1D9" font-family="sans-serif">${d.lang}</text>
    <text x="${width - 60}" y="${y + 10}" font-size="13" fill="#8b949e" font-family="sans-serif" text-anchor="end">${d.pct.toFixed(2)}%</text>`;
    })
    .join("");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <title>${username}'s most used languages</title>
  <rect width="${width}" height="${height}" rx="10" fill="#161B22" stroke="#30363d" stroke-width="1"/>
  <text x="20" y="16" font-size="12" fill="#C9D1D9" font-family="sans-serif" font-weight="bold">Most Used Languages</text>
  <rect x="20" y="20" width="${barWidth}" height="${barHeight}" rx="6" fill="#21262d" />
  <clipPath id="barclip"><rect x="20" y="20" width="${barWidth}" height="${barHeight}" rx="6" /></clipPath>
  <g clip-path="url(#barclip)">${segments}</g>
  ${rows}
</svg>`;
}

(async () => {
  console.error(`Fetching language breakdown for ${USERNAME}...`);
  const breakdown = await getLanguageBreakdown(USERNAME);
  console.error("Breakdown:", breakdown.map(d => `${d.lang}: ${d.pct.toFixed(1)}%`).join(", "));

  const svg = renderSVG(breakdown, USERNAME);
  require("fs").writeFileSync(OUTPUT_PATH, svg);
  console.error(`Wrote ${OUTPUT_PATH}`);
})().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
