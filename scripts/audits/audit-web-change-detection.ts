/**
 * Live audit: compare Page Scout hash detection against Firecrawl changeTracking.
 *
 * This script deliberately calls Firecrawl directly rather than the Scoutpost
 * Edge Functions so it can isolate provider behavior without database, credits,
 * LLM extraction, or notification effects.
 *
 * Usage:
 *   set -a; source .env; set +a
 *   deno run --allow-env --allow-net --allow-write=scripts/reports \
 *     scripts/audits/audit-web-change-detection.ts
 */

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
const DEFAULT_DELAY_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 45_000;

interface UrlCase {
  name: string;
  url: string;
  class: string;
  expectation: "stable" | "dynamic" | "may_fail";
}

const CASES: UrlCase[] = [
  {
    name: "example.com static control",
    url: "https://example.com",
    class: "static",
    expectation: "stable",
  },
  {
    name: "Firecrawl docs scrape page",
    url: "https://docs.firecrawl.dev/api-reference/endpoint/scrape",
    class: "docs",
    expectation: "stable",
  },
  {
    name: "Scoutpost homepage",
    url: "https://www.scoutpost.ai",
    class: "product site",
    expectation: "stable",
  },
  {
    name: "Neunkirch events",
    url: "https://www.neunkirch.ch/freizeit/veranstaltungen.html/23",
    class: "local gov/events",
    expectation: "dynamic",
  },
  {
    name: "Aesch current information",
    url: "https://www.aesch.bl.ch/aktuellesinformationen",
    class: "local gov/news",
    expectation: "dynamic",
  },
  {
    name: "Politico congress section",
    url: "https://www.politico.com/news/congress",
    class: "news listing",
    expectation: "dynamic",
  },
  {
    name: "BBC news",
    url: "https://www.bbc.com/news",
    class: "news listing/js",
    expectation: "dynamic",
  },
  {
    name: "Oakland budget PDF",
    url: "https://www.oaklandca.gov/documents/fy-2023-25-budget-book.pdf",
    class: "pdf",
    expectation: "stable",
  },
  {
    name: "NYTimes likely blocked",
    url:
      "https://www.nytimes.com/2025/01/15/us/politics/trump-executive-orders.html",
    class: "blocked/paywall",
    expectation: "may_fail",
  },
];

type FormatSpec = "markdown" | "rawHtml" | Record<string, unknown>;

interface ScrapeAttempt {
  ok: boolean;
  status: number | null;
  elapsed_ms: number;
  markdown_len: number;
  raw_hash: string | null;
  normalized_hash: string | null;
  warning?: string | null;
  title?: string | null;
  source_url?: string | null;
  error?: string | null;
  change?: {
    previousScrapeAt?: string | null;
    changeStatus?: string | null;
    visibility?: string | null;
    present: boolean;
  };
}

interface CaseResult {
  test: UrlCase;
  default_plain_1: ScrapeAttempt;
  default_plain_2: ScrapeAttempt;
  fresh_plain_1: ScrapeAttempt;
  fresh_plain_2: ScrapeAttempt;
  change_1: ScrapeAttempt;
  change_2: ScrapeAttempt;
  change_3: ScrapeAttempt;
  verdict: {
    current_plain_raw_same: boolean | null;
    fresh_plain_raw_same: boolean | null;
    current_plain_normalized_same: boolean | null;
    fresh_plain_normalized_same: boolean | null;
    double_probe_stored: boolean | null;
    after_delay_stored: boolean | null;
    change_second_status: string | null;
    change_third_status: string | null;
    notes: string[];
  };
}

function apiKey(): string {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) throw new Error("FIRECRAWL_API_KEY is not set");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM|am|pm)?\b/g, "<TIME>")
    .replace(/\b\d+\s+(?:seconds?|minutes?|hours?)\s+ago\b/gi, "<REL_TIME>")
    .trim();
}

async function scrape(
  url: string,
  bodyPatch: Record<string, unknown>,
): Promise<ScrapeAttempt> {
  const started = performance.now();
  const body = {
    url,
    formats: ["markdown", "rawHtml"] as FormatSpec[],
    onlyMainContent: true,
    timeout: DEFAULT_TIMEOUT_MS,
    ...bodyPatch,
  };
  let res: Response;
  try {
    res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      status: null,
      elapsed_ms: Math.round(performance.now() - started),
      markdown_len: 0,
      raw_hash: null,
      normalized_hash: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const elapsed = Math.round(performance.now() - started);
  let json: Record<string, unknown> = {};
  let text = "";
  try {
    text = await res.text();
    json = text ? JSON.parse(text) : {};
  } catch {
    // Keep text below for error context.
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      elapsed_ms: elapsed,
      markdown_len: 0,
      raw_hash: null,
      normalized_hash: null,
      error: text.slice(0, 500),
    };
  }

  const data = (json.data ?? {}) as Record<string, unknown>;
  const markdown = typeof data.markdown === "string" ? data.markdown : "";
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const rawHash = markdown ? await sha256(markdown) : null;
  const normalized = normalizeMarkdown(markdown);
  const normalizedHash = normalized ? await sha256(normalized) : null;
  const ct = (data.changeTracking ?? null) as Record<string, unknown> | null;

  return {
    ok: true,
    status: res.status,
    elapsed_ms: elapsed,
    markdown_len: markdown.length,
    raw_hash: rawHash,
    normalized_hash: normalizedHash,
    warning: typeof data.warning === "string" ? data.warning : null,
    title: typeof metadata.title === "string" ? metadata.title : null,
    source_url: typeof metadata.sourceURL === "string"
      ? metadata.sourceURL
      : typeof metadata.url === "string"
      ? metadata.url
      : null,
    change: ct
      ? {
        present: true,
        previousScrapeAt: typeof ct.previousScrapeAt === "string"
          ? ct.previousScrapeAt
          : null,
        changeStatus: typeof ct.changeStatus === "string"
          ? ct.changeStatus
          : null,
        visibility: typeof ct.visibility === "string" ? ct.visibility : null,
      }
      : undefined,
  };
}

function sameHash(
  a: ScrapeAttempt,
  b: ScrapeAttempt,
  normalized = false,
): boolean | null {
  if (!a.ok || !b.ok) return null;
  const key = normalized ? "normalized_hash" : "raw_hash";
  if (!a[key] || !b[key]) return null;
  return a[key] === b[key];
}

function buildVerdict(r: Omit<CaseResult, "verdict">): CaseResult["verdict"] {
  const notes: string[] = [];
  const currentPlainSame = sameHash(r.default_plain_1, r.default_plain_2);
  const freshPlainSame = sameHash(r.fresh_plain_1, r.fresh_plain_2);
  const currentPlainNormSame = sameHash(
    r.default_plain_1,
    r.default_plain_2,
    true,
  );
  const freshPlainNormSame = sameHash(r.fresh_plain_1, r.fresh_plain_2, true);
  const doubleProbeStored = r.change_2.ok
    ? Boolean(r.change_2.change?.previousScrapeAt)
    : null;
  const afterDelayStored = r.change_3.ok
    ? Boolean(r.change_3.change?.previousScrapeAt)
    : null;
  const secondStatus = r.change_2.change?.changeStatus ?? null;
  const thirdStatus = r.change_3.change?.changeStatus ?? null;

  if (currentPlainSame === true && freshPlainSame === false) {
    notes.push(
      "default plain scrape was stable while fresh plain scrape changed; Firecrawl cache may mask changes",
    );
  }
  if (currentPlainSame === false) {
    notes.push(
      "current Scoutpost plain hash would detect a change on immediate re-scrape",
    );
  }
  if (freshPlainSame === false) {
    notes.push("fresh hash path is noisy on immediate re-scrape for this URL");
  }
  if (freshPlainSame === false && freshPlainNormSame === true) {
    notes.push("simple normalization removed the fresh hash difference");
  }
  if (doubleProbeStored === false) {
    notes.push("changeTracking double-probe did not confirm baseline storage");
  }
  if (afterDelayStored === false) {
    notes.push("changeTracking baseline was not visible after delay");
  }
  if (secondStatus === "changed" || thirdStatus === "changed") {
    notes.push(
      "changeTracking reported changed during immediate/delayed re-check",
    );
  }
  if (!r.default_plain_1.ok || !r.fresh_plain_1.ok || !r.change_1.ok) {
    notes.push("one or more first scrape modes failed");
  }

  return {
    current_plain_raw_same: currentPlainSame,
    fresh_plain_raw_same: freshPlainSame,
    current_plain_normalized_same: currentPlainNormSame,
    fresh_plain_normalized_same: freshPlainNormSame,
    double_probe_stored: doubleProbeStored,
    after_delay_stored: afterDelayStored,
    change_second_status: secondStatus,
    change_third_status: thirdStatus,
    notes,
  };
}

async function runCase(
  test: UrlCase,
  runId: string,
  delayMs: number,
): Promise<CaseResult> {
  console.log(`\n== ${test.name}`);
  console.log(`   ${test.url}`);
  const tag = `sp-audit-${runId}-${crypto.randomUUID().slice(0, 8)}`;

  const defaultPlain1 = await scrape(test.url, {});
  console.log(`   default plain #1: ${brief(defaultPlain1)}`);
  const defaultPlain2 = await scrape(test.url, {});
  console.log(`   default plain #2: ${brief(defaultPlain2)}`);

  const freshPatch = { maxAge: 0, storeInCache: false };
  const freshPlain1 = await scrape(test.url, freshPatch);
  console.log(`   fresh plain #1:   ${brief(freshPlain1)}`);
  const freshPlain2 = await scrape(test.url, freshPatch);
  console.log(`   fresh plain #2:   ${brief(freshPlain2)}`);

  const changePatch = {
    formats: ["markdown", "rawHtml", { type: "changeTracking", tag }],
  };
  const change1 = await scrape(test.url, changePatch);
  console.log(`   CT #1:            ${brief(change1)}`);
  const change2 = await scrape(test.url, changePatch);
  console.log(`   CT #2:            ${brief(change2)}`);
  await sleep(delayMs);
  const change3 = await scrape(test.url, changePatch);
  console.log(`   CT #3 +delay:     ${brief(change3)}`);

  const withoutVerdict = {
    test,
    default_plain_1: defaultPlain1,
    default_plain_2: defaultPlain2,
    fresh_plain_1: freshPlain1,
    fresh_plain_2: freshPlain2,
    change_1: change1,
    change_2: change2,
    change_3: change3,
  };
  return { ...withoutVerdict, verdict: buildVerdict(withoutVerdict) };
}

function brief(a: ScrapeAttempt): string {
  if (!a.ok) {
    return `FAIL status=${a.status ?? "net"} ${a.elapsed_ms}ms ${
      a.error?.slice(0, 90) ?? ""
    }`;
  }
  const ct = a.change
    ? ` ct=${a.change.changeStatus ?? "?"}/prev=${
      a.change.previousScrapeAt ? "yes" : "no"
    }`
    : "";
  const warn = a.warning ? " warning" : "";
  return `OK ${a.elapsed_ms}ms len=${a.markdown_len} hash=${
    a.raw_hash?.slice(0, 10) ?? "none"
  }${ct}${warn}`;
}

function boolCell(v: boolean | null): string {
  if (v === true) return "yes";
  if (v === false) return "no";
  return "n/a";
}

function report(results: CaseResult[], runId: string): string {
  const lines: string[] = [];
  lines.push(`# Web Change Detection Audit`);
  lines.push("");
  lines.push(`Run: \`${runId}\``);
  lines.push(`Date: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary Table");
  lines.push("");
  lines.push(
    "| Case | Class | Default hash same | Fresh hash same | Fresh normalized same | CT probe stored | CT after delay stored | CT statuses | Notes |",
  );
  lines.push("|---|---|---:|---:|---:|---:|---:|---|---|");
  for (const r of results) {
    lines.push(
      [
        r.test.name,
        r.test.class,
        boolCell(r.verdict.current_plain_raw_same),
        boolCell(r.verdict.fresh_plain_raw_same),
        boolCell(r.verdict.fresh_plain_normalized_same),
        boolCell(r.verdict.double_probe_stored),
        boolCell(r.verdict.after_delay_stored),
        `${r.verdict.change_second_status ?? "n/a"} -> ${
          r.verdict.change_third_status ?? "n/a"
        }`,
        r.verdict.notes.join("; ") || "",
      ].map((cell) => `| ${String(cell).replace(/\|/g, "\\|")} `).join("") +
        "|",
    );
  }
  lines.push("");
  lines.push("## Per-Case Detail");
  for (const r of results) {
    lines.push("");
    lines.push(`### ${r.test.name}`);
    lines.push("");
    lines.push(`URL: ${r.test.url}`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(r, null, 2));
    lines.push("```");
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const delayMs = Number(
    Deno.args.find((a) => a.startsWith("--delay-ms="))?.split("=")[1] ??
      DEFAULT_DELAY_MS,
  );
  const only = Deno.args.find((a) => a.startsWith("--only="))?.split("=")[1]
    ?.toLowerCase();
  const cases = only
    ? CASES.filter((c) =>
      c.name.toLowerCase().includes(only) ||
      c.class.toLowerCase().includes(only)
    )
    : CASES;

  console.log(`Web change detection audit ${runId}`);
  console.log(`Cases: ${cases.length}; CT delay: ${delayMs}ms`);
  const results: CaseResult[] = [];
  for (const test of cases) {
    results.push(await runCase(test, runId, delayMs));
  }

  await Deno.mkdir("scripts/reports", { recursive: true });
  const jsonPath = `scripts/reports/web-change-detection-${runId}.json`;
  const mdPath = `scripts/reports/web-change-detection-${runId}.md`;
  await Deno.writeTextFile(
    jsonPath,
    JSON.stringify({ runId, results }, null, 2),
  );
  await Deno.writeTextFile(mdPath, report(results, runId));
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

if (import.meta.main) {
  await main();
}
