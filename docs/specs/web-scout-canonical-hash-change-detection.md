# Web Scout Canonical Hash Change Detection

## Status

Proposed.

This spec is based on:

- Current Scoutpost code in `supabase/functions/_shared/firecrawl.ts`,
  `supabase/functions/scout-web-execute/index.ts`, and
  `supabase/functions/_shared/web_scout_baseline.ts`.
- Current Supabase schema in `supabase/migrations/00002_tables.sql` and
  `supabase/migrations/00008_phase1_tables.sql`.
- Live Firecrawl audit scripts and reports:
  - `scripts/audit-web-change-detection.ts`
  - `scripts/audit-firecrawl-diff.ts`
  - `scripts/reports/web-change-detection-20260520131609.md`
  - `scripts/reports/firecrawl-diff-20260520132744-66d008/summary.json`
- Firecrawl documentation checked on 2026-05-20:
  - `https://docs.firecrawl.dev/api-reference/endpoint/scrape`
  - `https://docs.firecrawl.dev/features/change-tracking`

## Decision Summary

Move Page Scout change detection away from Firecrawl `changeTracking` and toward
Scoutpost-owned canonical hash comparison, but do not switch to the current raw
`firecrawl_plain` path as-is.

The current raw-hash fallback is too coarse because it hashes Firecrawl markdown
including image URLs, placeholders, relative timestamps, and provider rendering
noise. It also calls Firecrawl `/scrape` without overriding Firecrawl's default
cache window. Firecrawl's current `/scrape` docs state that plain scrapes default
to `maxAge = 172800000` ms, while change tracking bypasses the index cache.

The target detector is:

```text
fresh scrape -> canonicalize markdown -> versioned SHA-256 -> compare latest
stored canonical baseline -> extract/notify only when canonical hash changed
```

The target provider field for local change detection should remain
`provider = 'firecrawl_plain'` for now. Do not add a new provider value unless a
later migration deliberately splits `scrape_provider` from `change_detector`.
The existing `scouts.provider` check constraint only permits `firecrawl` and
`firecrawl_plain`; avoiding a new enum value keeps this change smaller.

## Goals

- Remove Page Scout dependence on Firecrawl's remote stateful
  `changeTracking` baseline system.
- Preserve or improve change-detection accuracy for existing Page Scouts.
- Avoid false notifications caused by scrape noise such as image CDN URL churn
  and relative timestamps.
- Avoid missed notifications caused by Firecrawl's default plain-scrape cache.
- Make Page Scout detection easier to port to other scrape providers.
- Keep the implementation small: no new baseline table, no permanent dual-run
  detector, no broad provider framework before a second provider exists.

## Non-Goals

- Do not replace Firecrawl as the scrape provider in this change.
- Do not change Beat, Civic, Social, Ingest, or PDF extraction behavior.
- Do not add recursive crawling behavior in this change.
- Do not introduce a new durable event-log system for runs.
- Do not run permanent production shadow scrapes that double provider cost.
- Do not migrate existing `firecrawl` scouts by blindly setting
  `provider = 'firecrawl_plain'` without first creating a local baseline.

## Current Architecture

### Firecrawl Wrapper

`supabase/functions/_shared/firecrawl.ts` has one Firecrawl base:

```ts
const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
```

`firecrawlScrape()` sends:

```ts
{
  url,
  formats: opts.formats ?? ["markdown", "rawHtml"],
  onlyMainContent: opts.onlyMainContent ?? true,
  timeout: timeoutMs,
  parsers: [{ type: "pdf", mode: "fast" }]
}
```

It does not currently set `maxAge` or `storeInCache`.

`firecrawlChangeTrackingScrape()` sends:

```ts
formats: ["markdown", "rawHtml", { type: "changeTracking", tag }]
```

and returns `change_status`, `previous_scrape_at`, and `visibility`.

### Page Scout Runtime

`scout-web-execute/index.ts` branches on `scout.provider`:

- `firecrawl_plain`: plain scrape, then `hashChangeStatus()` compares the raw
  markdown hash with the latest `raw_captures.content_sha256`.
- `firecrawl` or `null`: changeTracking scrape with a per-scout tag; on failure
  it falls back to the raw hash path.

`hashChangeStatus()` currently hashes raw markdown:

```ts
const hash = await sha256Hex(markdown);
```

and compares to the most recent `raw_captures.content_sha256`.

### Schema

`scouts.provider` is constrained to:

```sql
provider TEXT CHECK (provider IN ('firecrawl', 'firecrawl_plain'))
```

`raw_captures` currently stores:

```sql
content_md TEXT,
content_sha256 TEXT,
captured_at TIMESTAMPTZ,
expires_at TIMESTAMPTZ
```

There is no canonical hash column today.

## Evidence From Live Audit

The audit compared:

- default plain scrape: current Scoutpost-like plain Firecrawl call
- fresh plain scrape: `maxAge: 0`, `storeInCache: false`
- changeTracking: unique tag, repeated calls

Coverage:

- static page: `https://example.com`
- docs page: Firecrawl docs scrape page
- product site: Scoutpost homepage
- local government events/news pages
- news listings: Politico, BBC
- PDF: Oakland budget PDF
- blocked/paywall: NYTimes

Observed results:

| URL class | Result |
|---|---|
| Static/docs/product pages | Plain hash and changeTracking were stable. |
| Local government events | Firecrawl had transient timeouts; retry remains necessary under either detector. |
| Local government news | One changeTracking run reported `changed` because call 1 returned shorter markdown than call 2; repeat targeted run was stable. |
| Politico listing | One audit showed fresh hash instability; targeted repeat was stable. Treat as intermittent provider noise. |
| BBC listing | Fresh raw hash changed immediately. Diff showed mostly image URL/placeholder churn and relative-time churn. A canonical hash that strips image markdown and normalizes relative timestamps was stable. changeTracking also reported `changed`. |
| PDF Page Scout | Firecrawl returned markdown, but changeTracking status was `removed`; this is not a reliable Page Scout change signal for PDFs. |
| Blocked/paywall | All modes failed. No detector fixes unsupported providers. |

Conclusion:

- `changeTracking` is not a clear accuracy win. It is stateful, slower, and can
  still report provider-noise changes.
- raw hashing is not acceptable as the final detector.
- fresh canonical hashing is the best low-complexity direction.

## Plan Review: Avoiding Bloat

Earlier design ideas included a new provider value, shadow mode over a long
window, and separate baseline state. Reject those for this change.

Use existing primitives:

- Keep `scouts.provider`.
- Keep `raw_captures` as the baseline source.
- Add only the minimum canonical-hash metadata to `raw_captures`.
- Keep existing run lifecycle helpers.
- Keep existing resilient scrape helper and retry behavior.
- Use live audit scripts as operator tools, not production runtime paths.

The smallest durable model is:

```text
raw_captures.content_sha256           -- raw markdown hash, preserved
raw_captures.canonical_content_sha256 -- canonical markdown hash, new
raw_captures.canonicalizer_version    -- e.g. web-md-v1, new
```

No new table is required.

## Target Behavior

### New Web Scouts

On create/schedule baseline:

1. Scrape with a fresh Page Scout scrape policy:
   - `maxAge: 0`
   - `storeInCache: false`
   - formats `["markdown", "rawHtml"]`
   - existing timeout and retry settings
2. Compute:
   - raw `content_sha256`
   - `canonical_content_sha256`
   - `canonicalizer_version = 'web-md-v1'`
3. Insert one `raw_captures` baseline row.
4. Set:
   - `provider = 'firecrawl_plain'`
   - `baseline_established_at = now()`
   - optional `config.web_change_detector = 'canonical_hash'`
   - optional `config.web_canonicalizer_version = 'web-md-v1'`

Do not run double-probe for new Page Scouts once this path is enabled.

### Existing `provider = 'firecrawl_plain'` Scouts

These scouts already have a local raw baseline.

Migration rule:

1. Find the latest `raw_captures` row for the scout.
2. If that row has `content_md`, compute and store
   `canonical_content_sha256` and `canonicalizer_version`.
3. If no usable capture exists, do not guess. On the next run, scrape fresh and
   create a baseline-only run before switching the scout to canonical detection.

Runtime rule after migration:

- Compare new canonical hash against latest baseline row for the same
  `canonicalizer_version`.
- Preserve raw hash for diagnostics and unit occurrence dedup; do not repurpose
  `content_sha256`.

### Existing `provider = 'firecrawl'` Scouts

These scouts have a remote Firecrawl baseline and may not have a local current
baseline. They need guarded migration.

Safe migration on next scheduled run:

1. Run one final changeTracking scrape using the existing provider path.
2. If changeTracking returns `same`:
   - use the returned markdown as the current local baseline
   - insert `raw_captures` with raw and canonical hashes
   - update `provider = 'firecrawl_plain'`
   - mark the run as success/no-change/migrated
   - do not notify
3. If changeTracking returns `changed` or `new`:
   - process the run normally through extraction/dedup/notification
   - after successful processing, insert/update the local canonical baseline
   - update `provider = 'firecrawl_plain'`
4. If changeTracking fails:
   - do not silently migrate
   - fall back to the existing plain path only for that run if current behavior
     already does so
   - if the fallback scrape succeeds, it may process a real change, but it
     should not be treated as a clean baseline migration unless the run is
     explicitly marked `baseline_initialized` or `migration_inconclusive`
   - keep the scout eligible for a later migration attempt

This avoids suppressing changes that occurred between the last Firecrawl remote
baseline and the migration run.

## Canonicalization v1

Add a small shared helper:

```text
supabase/functions/_shared/web_content_canonical.ts
```

Export:

```ts
export const WEB_CANONICALIZER_VERSION = "web-md-v1";
export function canonicalizeWebMarkdown(markdown: string): string;
export async function webCanonicalHash(markdown: string): Promise<string>;
```

`web-md-v1` should be conservative. It should remove high-noise markdown while
preserving text, links, headings, publication dates, and article URLs.

Rules:

1. Normalize line endings to `\n`.
2. Trim trailing whitespace.
3. Collapse 3+ blank lines to 2.
4. Normalize relative time strings:
   - `34 mins ago`
   - `1 hour ago`
   - `Updated 2 minutes ago`
5. Remove or normalize image markdown:
   - `![alt](image-url)`
   - linked image wrappers where the link target is preserved if it points to
     an article URL
6. Normalize obvious placeholder/static asset URLs.
7. Preserve ordinary markdown links:
   - `[headline](https://source.example/story)`
8. Preserve visible text and headings.

Do not use an LLM for canonicalization.

Do not canonicalize by stripping all URLs. Article links are signal.

## Firecrawl Scrape Policy

Extend `ScrapeOptions`:

```ts
maxAgeMs?: number;
storeInCache?: boolean;
```

For Page Scout change detection only, call Firecrawl with:

```ts
maxAge: 0,
storeInCache: false
```

Keep other callers unchanged unless separately audited. Beat and Civic have
different cost and freshness tradeoffs.

## Code Changes

### 1. Migration

Add a migration that:

```sql
ALTER TABLE raw_captures
  ADD COLUMN IF NOT EXISTS canonical_content_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS canonicalizer_version TEXT;

CREATE INDEX IF NOT EXISTS idx_raw_scout_canonical_time
  ON raw_captures (scout_id, canonicalizer_version, captured_at DESC)
  WHERE canonical_content_sha256 IS NOT NULL;
```

Optional, only if needed for operational reporting:

```sql
ALTER TABLE scout_runs
  ADD COLUMN IF NOT EXISTS migration_note TEXT;
```

Prefer existing `error_message`, `status`, `scraper_status`, `criteria_status`,
and existing diagnostics before adding more run columns.

### 2. Firecrawl Wrapper

Update `firecrawlScrape()` so `maxAge` and `storeInCache` can be passed through.

Do not change default behavior globally.

### 3. Canonical Helper

Add `_shared/web_content_canonical.ts` with tests:

```text
supabase/functions/_shared/web_content_canonical_test.ts
```

Test cases:

- whitespace-only changes produce same canonical hash
- relative timestamps produce same canonical hash
- BBC image placeholder/CDN substitutions produce same canonical hash
- article link changes produce different canonical hash
- headline/body text changes produce different canonical hash

### 4. Baseline Insert

Update:

- `web_scout_baseline.ts`
- `scout-web-execute/index.ts::insertRawCapture`

to write both raw and canonical hashes for Page Scout captures.

Do not require canonical columns for Beat/Civic raw captures immediately. They
can leave the fields null.

### 5. Hash Change Status

Replace Page Scout raw comparison with canonical comparison when a canonical
baseline exists:

```text
latest raw_captures row
  where scout_id = scoutId
    and canonicalizer_version = WEB_CANONICALIZER_VERSION
    and canonical_content_sha256 is not null
  order by captured_at desc
```

If no canonical baseline exists:

- for `provider = 'firecrawl_plain'`, attempt to backfill from latest
  `content_md`
- if backfill is impossible, return `new` only in a controlled baseline
  initialization path, not as a normal notification-producing change

### 6. Existing ChangeTracking Migration

Add a migration helper function in Page Scout execution, not a broad background
job at first:

```ts
async function maybeMigrateChangeTrackingScoutToCanonical(...)
```

This function runs only for web scouts with `provider = 'firecrawl'`.

Acceptance criteria:

- A `same` CT result creates a local canonical baseline and suppresses
  notification.
- A `changed` CT result processes normally, then switches the scout after
  successful baseline write.
- A CT provider failure does not switch the scout.
- A failed local baseline write does not switch the scout.

### 7. New Scout Default

Once the canonical path is covered by tests:

- change Page Scout test/create flow so new scouts default to
  `provider = 'firecrawl_plain'`
- stop returning double-probe-derived provider for new web scout tests when the
  feature flag is enabled
- remove double-probe only in a later cleanup PR after migrated scout counts are
  low enough

## Feature Flags

Use one rollback flag. Do not add separate mode flags unless production data
proves the single switch is insufficient:

```text
WEB_SCOUT_CANONICAL_HASH_ENABLED=false
```

Implementation may default this path on after deploy, but the flag must remain
available as an explicit rollback switch while legacy `firecrawl` scouts exist.

Rollout:

1. Deploy columns and canonical helper.
2. Enable canonical hash for newly created `firecrawl_plain` baselines in
   non-prod/local.
3. Enable for new Page Scouts in production.
4. Let successful legacy `firecrawl` runs migrate to canonical baselines.
5. Monitor provider counts and run outcomes.
6. Remove double-probe only after follow-up evidence.

Avoid permanent shadow mode in production. Use the audit scripts for targeted
sampling instead.

## Accuracy Rules

Never update the local baseline before the run has reached the correct terminal
decision.

Rules:

- If canonical hash is same: no extraction, no notification, no baseline write
  needed.
- If canonical hash changed: extract, dedup, store units, then write the new
  baseline only after successful processing.
- If extraction fails: do not advance baseline.
- If unit insert fails: do not advance baseline.
- If notification fails after units are stored: baseline may advance, because
  the editorial facts are already persisted and notification retry is a
  separate concern.
- If scrape returns empty markdown: fail as provider error; do not baseline.
- If canonical content is empty after normalization but raw markdown is not:
  fail closed for v1 and log `canonical_empty`.

## Provider Agnosticism

This change makes web scouts more provider-agnostic because change detection no
longer requires provider-specific state.

The minimal provider contract becomes:

```ts
interface ScrapeSnapshot {
  requestedUrl: string;
  sourceUrl: string;
  title?: string | null;
  markdown: string;
  rawHtml?: string | null;
  metadata?: Record<string, unknown>;
  fetchedAt: string;
}
```

Firecrawl remains the only provider for now, but future providers only need to
return this shape. They do not need to implement `changeTracking`,
`previousScrapeAt`, `changeStatus`, or tags.

Do not add a full provider factory in this change. Instead, keep the Page Scout
detector written against the `ScrapeSnapshot` shape and dependency-inject the
scrape function in tests.

## Future Recursive / Feedback-Aware Scouts

Canonical hashing helps future recursive scouts because Scoutpost owns the
content memory instead of delegating it to Firecrawl.

This change should not implement recursion, but it should avoid blocking it.

Future feedback state can build from:

- exact source URL per raw capture
- canonical content hash over time
- which subpage URLs produced units
- which units were verified, rejected, merged, or ignored
- which source paths repeatedly produced scrape noise
- which source paths repeatedly produced high-value facts

Possible future policy object:

```json
{
  "web_memory": {
    "useful_path_patterns": [],
    "ignored_path_patterns": [],
    "noise_patterns": [],
    "last_high_signal_urls": [],
    "crawl_depth": 1,
    "max_subpages_per_run": 10
  }
}
```

Keep recursive behavior capped and same-host by default. Do not let this
canonical-hash change expand crawl breadth.

## Tests

### Unit Tests

Add:

```text
supabase/functions/_shared/web_content_canonical_test.ts
```

Update:

```text
supabase/functions/_shared/web_scout_baseline_test.ts
supabase/functions/_shared/firecrawl_test.ts
supabase/functions/scout-web-execute/_test.ts
```

Required assertions:

- `firecrawlScrape()` passes `maxAge` and `storeInCache` only when supplied.
- baseline insert includes canonical hash/version for web captures.
- existing `firecrawl_plain` scout with canonical baseline returns `same`.
- changed body text returns `changed`.
- image URL churn returns `same`.
- missing canonical baseline can backfill from existing `content_md`.
- existing `firecrawl` scout switches only after local baseline write.

### Live Operator Audit

Keep live audits manual and gated. They spend Firecrawl credits and depend on
external sites.

Recommended command:

```bash
set -a; source .env; set +a
deno run --allow-env --allow-net --allow-write=scripts/reports \
  scripts/audit-web-change-detection.ts --delay-ms=10000
```

Targeted diff:

```bash
set -a; source .env; set +a
deno run --allow-env --allow-net --allow-write=scripts/reports \
  scripts/audit-firecrawl-diff.ts https://www.bbc.com/news
```

Do not run these in CI by default.

## Operational Metrics

Track during rollout:

- count of active web scouts by provider
- count of web scouts with latest canonical baseline
- canonical `same` vs `changed` rate
- raw changed but canonical same count
- canonical changed but no units extracted count
- scrape timeout/error rate
- CT migration success/failure count
- notification volume before/after rollout

These can be logs first. Add dashboards only if the rollout shows ambiguity.

## Rollback

Rollback must be simple:

1. Set `WEB_SCOUT_CANONICAL_HASH_ENABLED=false`.
2. Existing `firecrawl` scouts continue using changeTracking.
3. Migrated scouts with `provider = 'firecrawl_plain'` continue using the
   legacy raw hash path if canonical is disabled.
4. Do not drop canonical columns. They are inert when unused.

If canonical hashing causes noisy notifications:

- disable canonical flag
- inspect `raw_captures` rows for noisy source URLs
- add a canonicalizer v2 only after preserving v1 behavior for existing
  baselines

## Cleanup Criteria

Do not delete double-probe in the first implementation PR.

Delete double-probe only after all are true:

- new web scouts have defaulted to canonical hash for at least one production
  rollout window
- active `provider = 'firecrawl'` web scouts are near zero or explicitly
  exempted
- audit scripts show canonical hash suppresses known image/timestamp noise
- no increase in Page Scout false-positive support reports
- docs are updated to remove old FastAPI/DynamoDB references

## Documentation Updates

Update `docs/features/web-scouts.md`.

Known stale points:

- It still names old FastAPI/DynamoDB files as key files.
- It describes double-probe as the standard provider detection path.
- It says Page Scout uses Firecrawl changeTracking by default.
- It does not mention Firecrawl plain scrape caching.
- It does not describe canonical hash baselines.

The updated doc should state:

- Page Scouts use fresh scrape + canonical hash for local change detection.
- Firecrawl changeTracking is legacy for older scouts during migration.
- Raw captures store versioned canonical baselines.
- Firecrawl remains the scrape provider, but change detection is local.

## Open Questions

1. What should the exact `maxAge` be for Page Scout scheduled runs?

   Proposed answer: `0` for change detection. If cost/latency becomes a
   problem, evaluate a small value such as 5 minutes, but not Firecrawl's
   default 2 days.

2. Should `storeInCache` be `false`?

   Proposed answer: yes for scheduled Page Scout detection. The product needs
   fresh source state more than Firecrawl cache reuse. Other scout types should
   be audited separately.

3. Should PDFs be allowed as Page Scouts?

   Current behavior allows them via Firecrawl. The audit showed changeTracking
   can return `removed` for a PDF while markdown exists. Canonical hash is
   likely safer for PDFs, but PDF canonicalization may need a separate v2 if
   real PDF noise appears.

4. Should provider be renamed?

   Not in this change. Long term, `provider` conflates scrape provider and
   change detector. A later cleanup can split:

   ```text
   scrape_provider = firecrawl | local_faas | ...
   change_detector = canonical_hash | provider_change_tracking
   ```

   Do not do this until a second scrape provider exists.

## Acceptance Criteria

- New Page Scouts can establish baselines without double-probe.
- Existing `firecrawl_plain` scouts can compare canonical hashes without false
  first-run notifications.
- Existing `firecrawl` scouts migrate only after a local canonical baseline is
  written.
- Firecrawl plain Page Scout detection does not use the default 2-day cache.
- BBC-style image CDN churn does not produce a canonical change.
- Headline/body/link changes do produce a canonical change.
- No code path advances a baseline after failed extraction or failed unit
  insertion.
- Rollback is an env flag, not a database restore.
- `docs/features/web-scouts.md` matches the implemented architecture.
