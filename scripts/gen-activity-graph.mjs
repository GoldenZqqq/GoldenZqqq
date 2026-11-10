#!/usr/bin/env node
/**
 * Generate a self-hosted contribution activity graph for the profile README.
 *
 * Data source: GitHub GraphQL API (contributionsCollection.contributionCalendar).
 * No third-party rendering service is involved, so the image cannot be taken
 * down the way github-readme-activity-graph.vercel.app was (HTTP 402
 * DEPLOYMENT_DISABLED).
 *
 * Usage:
 *   GITHUB_TOKEN=xxx node scripts/gen-activity-graph.mjs
 *
 * Env:
 *   GH_LOGIN    GitHub username to chart            (default: GoldenZqqq)
 *   GITHUB_TOKEN / GH_TOKEN  token with read access (required)
 *   OUT_FILE    output path                         (default: images/activity-graph.svg)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGIN = process.env.GH_LOGIN || 'GoldenZqqq';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const OUT = process.env.OUT_FILE || resolve(HERE, '..', 'images', 'activity-graph.svg');

const THEME = {
  bg: '#1a1b27',
  border: '#2f334d',
  grid: '#252a41',
  axis: '#565f89',
  accent: '#70a5fd',
  title: '#c0caf5',
  text: '#a9b1d6',
};

const W = 1200;
const H = 420;
const PAD = { left: 76, right: 34, top: 106, bottom: 58 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const round1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => n.toLocaleString('en-US');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function niceStep(rawStep) {
  if (rawStep <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= rawStep) return m * pow;
  }
  return 10 * pow;
}

async function fetchCalendar() {
  if (!TOKEN) throw new Error('GITHUB_TOKEN (or GH_TOKEN) is required');

  const query = `
    query ($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'activity-graph-generator',
    },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 400)}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`GraphQL returned non-JSON: ${text.slice(0, 400)}`);
  }
  if (json.errors && json.errors.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  const calendar = json?.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new Error('Response is missing contributionsCollection.contributionCalendar');
  return calendar;
}

function buildSvg(calendar) {
  const days = calendar.weeks
    .flatMap((w) => w.contributionDays)
    .filter((d) => d && d.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((d) => ({ date: d.date, count: Number(d.contributionCount) || 0 }));

  if (days.length < 2) throw new Error('Not enough contribution days to draw a graph');

  const total = Number(calendar.totalContributions) || days.reduce((s, d) => s + d.count, 0);
  const peak = Math.max(...days.map((d) => d.count), 1);
  const step = niceStep(peak / 4);
  const yMax = Math.max(step, Math.ceil(peak / step) * step);
  const ticks = Math.round(yMax / step);

  const xAt = (i) => PAD.left + (i / (days.length - 1)) * PLOT_W;
  const yAt = (v) => PAD.top + PLOT_H - (v / yMax) * PLOT_H;
  const baseY = PAD.top + PLOT_H;

  const line = days.map((d, i) => `${i === 0 ? 'M' : 'L'}${round1(xAt(i))},${round1(yAt(d.count))}`).join(' ');

  const area =
    `${line} L${round1(xAt(days.length - 1))},${round1(baseY)} ` +
    `L${round1(xAt(0))},${round1(baseY)} Z`;

  const gridLines = [];
  for (let t = 0; t <= ticks; t++) {
    const value = t * step;
    const y = round1(yAt(value));
    gridLines.push(
      `<line class="grid" x1="${PAD.left}" y1="${y}" x2="${round1(PAD.left + PLOT_W)}" y2="${y}" />`,
      `<text class="tick" x="${PAD.left - 14}" y="${round1(y + 4)}" text-anchor="end">${fmt(value)}</text>`,
    );
  }

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthTicks = [];
  let lastMonth = -1;
  days.forEach((d, i) => {
    const month = Number(d.date.slice(5, 7)) - 1;
    if (month === lastMonth) return;
    lastMonth = month;
    const x = round1(xAt(i));
    if (x < PAD.left + 14 || x > PAD.left + PLOT_W - 14) return;
    monthTicks.push(
      `<text class="tick" x="${x}" y="${round1(baseY + 26)}" text-anchor="middle">${monthNames[month]}</text>`,
      `<line class="grid" x1="${x}" y1="${PAD.top}" x2="${x}" y2="${baseY}" stroke-opacity="0.55" />`,
    );
  });

  const first = days[0].date;
  const last = days[days.length - 1].date;
  const subtitle = `${fmt(total)} contributions · ${first} → ${last}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(
    `${LOGIN} contribution activity: ${fmt(total)} contributions from ${first} to ${last}`,
  )}">
  <title>${esc(`${LOGIN} · contribution activity`)}</title>
  <defs>
    <linearGradient id="activityArea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${THEME.accent}" stop-opacity="0.45" />
      <stop offset="100%" stop-color="${THEME.accent}" stop-opacity="0.02" />
    </linearGradient>
  </defs>
  <style>
    .title { font: 600 22px 'Segoe UI', Ubuntu, Helvetica, Arial, sans-serif; fill: ${THEME.title}; }
    .meta  { font: 400 14px 'Segoe UI', Ubuntu, Helvetica, Arial, sans-serif; fill: ${THEME.text}; }
    .tick  { font: 400 13px 'Segoe UI', Ubuntu, Helvetica, Arial, sans-serif; fill: ${THEME.axis}; }
    .axis-label { font: 500 12.5px 'Segoe UI', Ubuntu, Helvetica, Arial, sans-serif; fill: ${THEME.axis}; letter-spacing: .08em; }
    .grid  { stroke: ${THEME.grid}; stroke-width: 1; }
    .line  { fill: none; stroke: ${THEME.accent}; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${THEME.bg}" stroke="${THEME.border}" />
  <text class="title" x="${PAD.left - 46}" y="46">${esc(LOGIN)}</text>
  <text class="meta" x="${W - PAD.right}" y="46" text-anchor="end">${esc(subtitle)}</text>
  <text class="axis-label" x="${PAD.left - 46}" y="70">CONTRIBUTIONS PER DAY · LAST 12 MONTHS</text>
${gridLines.map((l) => `  ${l}`).join('\n')}
${monthTicks.map((l) => `  ${l}`).join('\n')}
  <path d="${area}" fill="url(#activityArea)" />
  <path class="line" d="${line}" />
  <circle cx="${round1(xAt(days.length - 1))}" cy="${round1(yAt(days[days.length - 1].count))}" r="3.5" fill="${THEME.accent}" />
</svg>
`;
}

async function main() {
  const calendar = await fetchCalendar();
  const svg = buildSvg(calendar);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, svg, 'utf8');
  const total = calendar.totalContributions;
  console.log(`Wrote ${OUT} (${svg.length} bytes, ${total} contributions, ${calendar.weeks.length} weeks)`);
}

main().catch((err) => {
  console.error(`[activity-graph] ${err.message}`);
  process.exit(1);
});
