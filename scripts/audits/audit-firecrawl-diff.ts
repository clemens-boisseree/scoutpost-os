/**
 * Targeted Firecrawl markdown diff helper for noisy change-detection cases.
 *
 * Usage:
 *   set -a; source .env; set +a
 *   deno run --allow-env --allow-net --allow-write=scripts/reports \
 *     scripts/audits/audit-firecrawl-diff.ts "https://www.bbc.com/news"
 */

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";

function key(): string {
  const k = Deno.env.get("FIRECRAWL_API_KEY");
  if (!k) throw new Error("FIRECRAWL_API_KEY is not set");
  return k;
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function scrape(url: string, patch: Record<string, unknown>) {
  const started = performance.now();
  const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "rawHtml"],
      onlyMainContent: true,
      timeout: 60_000,
      ...patch,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text).data ?? {};
  const markdown = data.markdown ?? "";
  return {
    elapsedMs: Math.round(performance.now() - started),
    markdown,
    hash: await sha256(markdown),
    len: markdown.length,
    title: data.metadata?.title ?? null,
    changeTracking: data.changeTracking ?? null,
  };
}

function lines(md: string): string[] {
  return md.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function lineSummary(a: string, b: string): Record<string, unknown> {
  const aLines = lines(a);
  const bLines = lines(b);
  const aSet = new Set(aLines);
  const bSet = new Set(bLines);
  const removed = aLines.filter((line) => !bSet.has(line));
  const added = bLines.filter((line) => !aSet.has(line));
  let firstDifferentIndex = -1;
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) {
      firstDifferentIndex = i;
      break;
    }
  }
  return {
    line_count_a: aLines.length,
    line_count_b: bLines.length,
    removed_count: removed.length,
    added_count: added.length,
    overlap_ratio: aLines.length || bLines.length
      ? (aLines.filter((line) => bSet.has(line)).length /
        Math.max(aLines.length, bLines.length))
      : 1,
    first_different_index: firstDifferentIndex,
    first_a: firstDifferentIndex >= 0
      ? aLines[firstDifferentIndex] ?? null
      : null,
    first_b: firstDifferentIndex >= 0
      ? bLines[firstDifferentIndex] ?? null
      : null,
    removed_examples: removed.slice(0, 20),
    added_examples: added.slice(0, 20),
  };
}

async function main() {
  const url = Deno.args[0];
  if (!url) throw new Error("usage: audit-firecrawl-diff.ts <url>");
  const runId = `${
    new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
  }-${crypto.randomUUID().slice(0, 6)}`;
  const dir = `scripts/reports/firecrawl-diff-${runId}`;
  await Deno.mkdir(dir, { recursive: true });

  const freshPatch = { maxAge: 0, storeInCache: false };
  const tag = `sp-diff-${runId}-${crypto.randomUUID().slice(0, 6)}`;
  const ctPatch = {
    formats: ["markdown", "rawHtml", { type: "changeTracking", tag }],
  };

  console.log(`URL: ${url}`);
  const fresh1 = await scrape(url, freshPatch);
  const fresh2 = await scrape(url, freshPatch);
  const ct1 = await scrape(url, ctPatch);
  const ct2 = await scrape(url, ctPatch);

  await Deno.writeTextFile(`${dir}/fresh1.md`, fresh1.markdown);
  await Deno.writeTextFile(`${dir}/fresh2.md`, fresh2.markdown);
  await Deno.writeTextFile(`${dir}/ct1.md`, ct1.markdown);
  await Deno.writeTextFile(`${dir}/ct2.md`, ct2.markdown);

  const summary = {
    url,
    runId,
    tag,
    fresh: {
      first: {
        elapsedMs: fresh1.elapsedMs,
        len: fresh1.len,
        hash: fresh1.hash,
      },
      second: {
        elapsedMs: fresh2.elapsedMs,
        len: fresh2.len,
        hash: fresh2.hash,
      },
      same: fresh1.hash === fresh2.hash,
      diff: lineSummary(fresh1.markdown, fresh2.markdown),
    },
    changeTracking: {
      first: {
        elapsedMs: ct1.elapsedMs,
        len: ct1.len,
        hash: ct1.hash,
        changeTracking: ct1.changeTracking,
      },
      second: {
        elapsedMs: ct2.elapsedMs,
        len: ct2.len,
        hash: ct2.hash,
        changeTracking: ct2.changeTracking,
      },
      same: ct1.hash === ct2.hash,
      diff: lineSummary(ct1.markdown, ct2.markdown),
    },
  };
  await Deno.writeTextFile(
    `${dir}/summary.json`,
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${dir}`);
}

if (import.meta.main) await main();
