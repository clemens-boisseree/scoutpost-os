---
name: Scoutpost
last_updated: 2026-06-03
---

# Scoutpost Strategy

## Target problem

Journalists and small newsrooms need to monitor pages, beats, social profiles, and civic documents continuously, but the useful signals are scattered across unstable sources and arrive faster than a human can check manually. The hard part is not collecting more data; it is turning noisy, changing source material into source-linked leads that remain inspectable and editorially verifiable.

## Our approach

Scoutpost treats monitoring as a set of durable scouts that produce atomic, source-linked information units rather than ungrounded summaries. The product wins by keeping automation on the collection, extraction, deduplication, scheduling, and notification side while preserving a clear human verification boundary before anything becomes publishable fact.

## Who it's for

**Primary:** Local journalists and newsroom operators - They're hiring Scoutpost to maintain a persistent watch on beats, public bodies, web pages, and social accounts without replacing editorial judgment.

**Secondary:** Technical newsroom teams and self-hosted operators - They're hiring Scoutpost to run the same monitoring workflow through the app, CLI, MCP, REST API, and OSS deployment path.

## Key metrics

- **Successful scout run rate** - Share of scheduled and manual runs that reach a terminal non-error state by scout type; measured from `scout_runs` and weekly benchmark reports.
- **Actionable unit yield** - Number of non-duplicate, source-linked information units generated per successful run; measured from `information_units`, `unit_occurrences`, and scout-run diagnostics.
- **Verification conversion** - Share of generated units that a journalist verifies or uses in reporting; rejection rate is measured only where explicit rejection notes/status are present.
- **Noise and duplicate rate** - Share of runs or units rejected because they are stale, off-topic, duplicated, or unsupported by the source; measured through editorial status plus benchmark canaries.
- **Deployment health** - Weekly health of SaaS benchmarks and OSS Docker smoke tests; measured separately so product regressions and self-hosting regressions do not mask each other.

## Tracks

### Scout reliability

Make Page, Beat, Social, and Civic scouts predictable across preview, scheduled execution, Run Now, retries, and cleanup.

_Why it serves the approach:_ Durable monitoring only earns trust if every scout type has explicit run lifecycle, diagnostics, and benchmark coverage.

### Editorial verification and traceability

Keep every unit tied to source URLs, timestamps, scout runs, raw captures or provider evidence, and human verification state.

_Why it serves the approach:_ Scoutpost's core boundary is that automation produces leads, while journalists decide what is publishable.

### Agent and API parity

Progressively maintain parity across the UI, CLI, MCP, and REST surfaces without giving agents a separate data model or weaker contracts.

_Why it serves the approach:_ Technical newsroom users should be able to automate Scoutpost without bypassing product rules, credit accounting, auth, or verification. Current parity gaps are tracked in `docs/architecture/agent-native-audit-2026-06-03.md`.

### OSS and SaaS operability

Keep the hosted product, Supabase Edge Functions, local coding workflow, and open Docker setup healthy through separate tests, secrets contracts, and setup documentation.

_Why it serves the approach:_ A monitoring platform fails if it cannot be operated reliably by both the hosted team and self-hosted newsroom users.

## Not working on

- Replacing human editorial verification with automatic publication decisions.
- Treating OSS Docker smoke tests and live SaaS scout benchmarks as the same health signal.
- Adding new scout surfaces until the existing Page, Beat, Social, and Civic paths have clear benchmark and parity coverage.
