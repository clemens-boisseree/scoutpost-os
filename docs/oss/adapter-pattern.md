# Adapter Pattern Status

> **Status:** Historical migration note. Scoutpost's current runtime is Supabase-first. AWS/DynamoDB/EventBridge adapters are not a live parallel backend.

This file used to describe a dual-backend architecture where the private SaaS deployment ran on AWS while the OSS deployment ran on Supabase. That was the migration plan before the 2026-04-22 cutover.

The current implementation no longer asks new code to choose between `DEPLOYMENT_TARGET=aws` and `DEPLOYMENT_TARGET=supabase` for scout storage/scheduling. Scout scheduling, execution, run records, units, social snapshots, civic queues, promises, projects, entities, reflections, API keys, and MCP resources live in Supabase Postgres and Supabase Edge Functions.

## What Remains Useful

FastAPI still uses dependency injection for auth, user context, admin routes, local MuckRock broker behavior, and test seams. Keep that local DI where it makes tests and local development cleaner.

Do not revive broad storage/scheduler ports just to preserve the old dual-backend plan. Add an abstraction only when:

- two current implementations actually exist,
- the abstraction removes concrete duplication,
- tests need a narrow seam, or
- the public contract is intentionally provider-independent.

## Current Runtime References

| Concern | Current source |
| --- | --- |
| Scout CRUD and schedules | `supabase/functions/scouts/`, `supabase/functions/manage-schedule/` |
| Scheduled execution | `supabase/functions/execute-scout/` |
| Page scouts | `supabase/functions/scout-web-execute/` |
| Beat/location scouts | `supabase/functions/scout-beat-execute/` |
| Social scouts | `supabase/functions/social-kickoff/`, `apify-callback`, `apify-reconcile` |
| Civic scouts | `supabase/functions/civic-execute/`, `civic-extract-worker` |
| Canonical units and dedup | `supabase/functions/_shared/unit_dedup.ts`, `supabase/functions/units/` |
| CLI | `cli/` |
| MCP | `supabase/functions/mcp-server/`, `mcp/` |

## Migration History

The old adapter plan mapped DynamoDB records such as `SCRAPER#`, `TIME#`, `POSTS#`, and `PROMISE#` to normalized Postgres tables. That mapping is useful only when reading old issues, old PRs, or migration artifacts. For new work, use the Supabase table names and docs:

- `docs/supabase/scouts-runs.md`
- `docs/supabase/social-apify.md`
- `docs/supabase/civic-pipeline.md`
- `docs/supabase/rls-reference.md`
