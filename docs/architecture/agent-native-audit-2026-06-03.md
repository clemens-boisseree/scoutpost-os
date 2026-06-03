# Agent-Native Architecture Audit: Scoutpost

Date: 2026-06-03
Branch: `docs/compound-scoutpost-audit`
Scope: UI, CLI, MCP, REST/Edge Functions, Supabase workspace model, docs, and AgentSPEX.

## Verdict

Scoutpost is meaningfully agent-capable but not yet fully agent-native. The strongest property is shared workspace: agents, CLI, UI, and REST mostly operate on the same Supabase-backed scouts, units, projects, entities, ingests, reflections, and run records. The weakest property is runtime context injection: agents can discover static tools and setup instructions, but they do not receive a live workspace summary, verification queue, credit state, recent run state, or user preferences unless they call separate tools and infer the context themselves.

Two MCP contract bugs were found during the audit and should be fixed before expanding the tool surface:

- `merge_entities` sends `keeper_id`, but `supabase/functions/entities/index.ts` validates `keep_id`.
- `create_reflection` forwards caller arguments directly, but `supabase/functions/reflections/index.ts` requires `generated_by`.

## Scores

| Principle | Score | Confidence | Summary |
| --- | ---: | --- | --- |
| Action parity | 21/34 counted actions, 62% | High | Core scout and unit lifecycle is covered; preview/test flows, API-key management, user preferences, and some workspace artifacts are missing. |
| Tools as primitives | 18/26 MCP tools, 69% | High | Many tools are CRUD/read primitives, but lifecycle/editorial shortcuts and ingest/entity merge are workflow-shaped. |
| Context injection | 3/10 | High | Static setup context exists; live workspace context is not injected through MCP or CLI. |
| Shared workspace | 8/10 | High | UI, CLI, MCP, and REST mostly share Supabase data and user scoping. |
| CRUD completeness | MCP 63%, API 72%, CLI 60% | High | Scouts/projects are strong; reflections, entities, API keys, runs, ingests/raw captures, and preferences are uneven. |
| UI integration | 5/10 | High | UI reflects in-app changes well; external agent changes rely on refresh/focus rather than realtime updates. |
| Capability discovery | 5.5/7 | High | Strong skill/Agents/CLI/MCP docs, but README and MCP docs drift from current tool surface. |
| Prompt-native features | 4.5/10 | Moderate-high | AgentSPEX points in the right direction, but production scout behavior remains code-defined in Edge Functions. |

## Counting Methodology

Action parity counted 34 user/API actions found in `frontend/src`, `frontend/src/lib/api-client.ts`, `supabase/functions/*`, and residual `backend/app/routers/*` surfaces. Twenty-one are covered by CLI and/or MCP: list/get/create/update/run/pause/resume/delete scouts, create each of the four scout types, list/search/get/verify/reject/mark-used/delete units, project list/create/get/delete, ingest URL/text, reflection list/create/search, entity search/list, and entity merge. Partial coverage was counted as not fully covered for the numerator when one of CLI or MCP was missing for an otherwise agent-relevant action.

The 34 counted actions were:

1. list scouts
2. get/open scout detail
3. create/schedule Page Scout
4. create/schedule Beat Scout
5. create/schedule Social Scout
6. create/schedule Civic Scout
7. update scout fields
8. run scout now
9. pause scout
10. resume scout
11. delete scout
12. create scout from template
13. test Page Scout scrape
14. preview Beat search
15. test Social profile/baseline
16. discover Civic URLs
17. test Civic extraction
18. list units
19. search units
20. get/open unit
21. verify unit
22. reject unit
23. mark unit used
24. delete unit
25. list/create/get/delete projects
26. update project
27. ingest URL/text
28. list/create/search reflections
29. get/delete reflections
30. search/list entities
31. merge entities
32. create/get entity
33. show current user/account state
34. update user preferences/onboarding/tour state

The 26 MCP tools were counted from the `TOOLS` array in `supabase/functions/mcp-server/rpc.ts`: `list_scouts`, `create_scout`, `get_scout`, `update_scout`, `run_scout`, `pause_scout`, `resume_scout`, `delete_scout`, `list_units`, `search_units`, `get_unit`, `verify_unit`, `reject_unit`, `mark_unit_used`, `delete_unit`, `list_projects`, `create_project`, `get_project`, `update_project`, `delete_project`, `ingest_content`, `list_reflections`, `create_reflection`, `search_reflections`, `search_entities`, and `merge_entities`.

CRUD completeness was counted per entity-operation availability across API, CLI, and MCP. The main entities were scouts, information units, projects, reflections, entities, ingests/raw captures, API keys, user preferences, and runs. Operations that are intentionally pipeline-created rather than directly user-created, such as information-unit creation, were documented as product constraints rather than automatic defects.

## Action Parity

Core scout management is covered across UI, CLI, and MCP:

- UI and API create/list/get/update/run/pause/resume/delete scouts through `frontend/src/lib/api-client.ts`, `supabase/functions/scouts/index.ts`, and workspace components.
- CLI covers the same core scout lifecycle in `cli/commands/scouts.ts`.
- MCP covers the same lifecycle through `list_scouts`, `create_scout`, `get_scout`, `update_scout`, `run_scout`, `pause_scout`, `resume_scout`, and `delete_scout` in `supabase/functions/mcp-server/rpc.ts`.

Core unit lifecycle is also covered:

- UI can list/search/open/verify/reject/delete units through `frontend/src/lib/stores/workspace/units.ts`, `frontend/src/lib/components/workspace/UnitRow.svelte`, and `frontend/src/lib/components/workspace/UnitDrawer.svelte`.
- CLI covers list/show/search/verify/reject/mark-used/delete in `cli/commands/units.ts`.
- MCP covers list/search/get/verify/reject/mark-used/delete in `supabase/functions/mcp-server/rpc.ts`.

Main parity gaps:

- Preview/test flows are UI/API-only: Page scrape test, Beat preview search, Social profile/baseline test, Civic URL discovery, and Civic extraction test.
- API-key management is UI/API-only even though API keys are the agent onboarding mechanism.
- User preferences/onboarding state is UI/API-only; CLI has `user me`, but MCP has no user/preferences tool.
- Reflection get/delete and entity create/get are API-only or missing from MCP/CLI.
- Export user data/delete account and feedback submission are not exposed to agents.

Recommended next parity work:

1. Add CLI/MCP preview tools: `test_page_scout`, `preview_beat_search`, `test_social_profile`, `discover_civic_urls`, `test_civic_extraction`.
2. Add `scout keys list/create/revoke` and consider MCP API-key tools only if scoped carefully.
3. Add MCP `get_user`, `update_preferences`, and an explicit high-friction `export_user_data` path.
4. Fill workspace artifact parity: `get_reflection`, `delete_reflection`, `create_entity`, `get_entity`, and run diagnostics.

## Tools As Primitives

The local stdio MCP bridge is correctly primitive. `mcp/lib/bridge.ts` forwards newline-delimited JSON-RPC messages unchanged and only handles transport/auth injection.

The remote MCP catalog in `supabase/functions/mcp-server/rpc.ts` is mixed:

- Primitive-like tools: scout CRUD, unit list/search/get/delete, project CRUD, reflection list/create/search, entity search.
- Workflow/shortcut tools: `run_scout`, `pause_scout`, `resume_scout`, `verify_unit`, `reject_unit`, `mark_unit_used`, `ingest_content`, and `merge_entities`.

These workflow tools are not automatically wrong. `verify_unit` and `reject_unit` use journalist vocabulary and preserve the editorial boundary. But the surface should also expose generic primitives where agents need composability, especially `update_unit` and reflection/entity CRUD.

Confirmed contract bugs:

- `merge_entities` declares `keeper_id` and forwards it unchanged, but `supabase/functions/entities/index.ts` validates `keep_id`. The MCP tool will likely fail for valid callers.
- `create_reflection` requires only `scope_description` and `content`, then forwards the body unchanged. `supabase/functions/reflections/index.ts` requires `generated_by`, so MCP reflection creation will likely fail.

## Context Injection

Current context injection is mostly setup-time:

- `frontend/src/lib/utils/agent-targets.ts`, `frontend/src/lib/components/modals/AgentsModal.svelte`, and `frontend/src/lib/components/views/ApiView.svelte` provide endpoint, MCP URL, skill URL, and anon-key setup context.
- `supabase/functions/_shared/auth.ts` resolves the caller to a user or API-key owner.
- MCP tool schemas include useful static vocabulary, especially for scouts and units.

Missing runtime context:

- MCP `initialize` returns static capabilities only.
- `tools/list` returns static tools only.
- There are no MCP resources or tools for a compact workspace summary.
- CLI runtime context is local config and credentials, not workspace state.
- AgentSPEX YAML references context fields such as criteria/location/source mode, but the backend `StepContext` does not yet carry the full runtime context those prompts imply.

Recommended context primitives:

- Add MCP `get_workspace_context` or MCP resources for active projects, active scouts, recent runs, unverified-unit queue, credit state, and user preferences.
- Add a Scoutpost context builder for AgentSPEX or its Supabase-native successor.
- Keep setup prompts as bootstrap context, not as the only source of live state.

## Shared Workspace

This is Scoutpost's strongest agent-native property.

Evidence:

- Core tables are shared Supabase Postgres tables: `scouts`, `scout_runs`, `information_units`, `entities`, `projects`, `raw_captures`, `ingests`, and related tables.
- CLI commands call the same `/functions/v1/*` Edge Functions as the app.
- MCP tools forward to those same Edge Functions rather than bypassing resource handlers.
- API keys resolve to a caller identity and write into the same user-scoped workspace.
- RLS and explicit `user_id` scoping are documented in `docs/supabase/rls-reference.md`.

Residual risk:

- API-key auth uses service-role-backed helpers and depends on handlers applying caller scoping correctly. That can be acceptable, but it deserves regression tests because a missed `user_id` filter would be an agent-surface security bug.
- AgentSPEX is not yet production-wired into the shared workspace; its current backend tools are largely stubs.

Test gap:

- API-key scoped writes should have regression coverage for representative mutating handlers, especially scouts, units, projects, ingests, reflections, and entities. This is not a confirmed bug in the audited code, but it is the main security-sensitive test gap behind shared workspace confidence.

## CRUD Completeness

| Entity | API | CLI | MCP | Gaps |
| --- | --- | --- | --- | --- |
| Scouts | CRUD + run/pause/resume | CRUD + run/pause/resume | CRUD + run/pause/resume | Good coverage. |
| Information units | Read/update/delete/search | Read/update/delete/search | Read/update/delete/search | No generic create; creation is intentionally through scout/ingest pipelines. Add generic update for composability. |
| Projects | CRUD | Create/read/delete | CRUD | CLI lacks update. |
| Reflections | Create/read/delete/search | Missing | List/create/search only | MCP create likely broken; MCP lacks get/delete; CLI missing. |
| Entities | Create/read/merge/list | Missing | Search/merge only | MCP merge likely broken; MCP lacks create/get. |
| Ingests/raw captures | Create workflow | Create workflow | Create workflow | No first-class read/list/delete lifecycle. |
| API keys | Create/list/revoke | Missing | Missing | High-priority CLI gap because keys onboard agents. |
| User preferences | Read/update | `user me` only | Missing | Add preferences update/read to CLI/MCP. |
| Runs | Read diagnostics | Missing | Missing | Add run diagnostics for agent troubleshooting. |

## UI Integration

In-app mutations update the UI well:

- Scout store actions update local state after create/update/delete.
- Unit verify/reject/delete handlers patch or remove rows locally.
- Run Now polls every two seconds and reloads units after completion.

External agent mutations are weaker:

- No Supabase Realtime, SSE, WebSocket, or `postgres_changes` subscription was found in the inspected frontend.
- CLI/MCP-created scouts or unit mutations become visible only after focus/visibility refresh, manual refresh, or reload.
- There is no visible agent activity feed showing API-key/MCP mutations.

Recommended UI work:

- Add scoped realtime or SSE for `scouts`, `scout_runs`, `information_units`, `unit_occurrences`, `ingests`, and project membership.
- Add an activity feed for agent/API-key actions with actor, source, timestamp, and affected object.
- Reconcile open unit/scout drawers when external updates affect the selected object.

## Capability Discovery

Strong existing discovery:

- Public product skill in `frontend/static/skills/scoutpost.md`.
- `/skills` route and `skills.txt`.
- Agents modal and per-agent recipes in `frontend/src/lib/utils/agent-recipes.ts`.
- CLI docs in `cli/README.md`.
- MCP docs in `docs/mcp/` and `mcp/README.md`.
- Machine discovery through MCP `tools/list`.

Drift/gaps:

- `README.md` barely surfaces agent access beyond the CLI.
- `docs/mcp/architecture.md` describes an older, smaller tool set and names `ingest_units`, while code exposes `ingest_content` and many more tools.
- `docs/mcp/endpoints.md` expects `serverInfo.name = "scoutpost"`, but `supabase/functions/mcp-server/rpc.ts` sets `SERVER_NAME = "cojournalist"`.
- Suggested prompts are mostly setup verification, not task galleries.

Recommended discovery work:

- Generate or test a canonical capability manifest from `TOOLS` in `supabase/functions/mcp-server/rpc.ts`.
- Render that manifest into MCP docs, `/skills`, `skills.txt`, README, and the Agents modal.
- Add task-level prompts: create scouts, run scouts with credit confirmation, triage unverified units, search contradictions, mark used, and prepare article packets.

## Documentation Drift To Rewrite

The agent-native surface is harder to trust because several high-level docs still describe the pre-cutover AWS/DynamoDB/EventBridge architecture. These are not just historical notes: they sit in files future agents and contributors are likely to read before changing Scoutpost.

Rewrite these during implementation:

| Area | Files | Current stale signal | Desired replacement |
| --- | --- | --- | --- |
| Repo operating guide | `CLAUDE.md` | Tech-stack and flow sections still name DynamoDB, EventBridge Scheduler, Lambda, `aws/`, `SCRAPER#`, and `TIME#` records as current architecture. | Make Supabase Postgres, Edge Functions, pg_cron/pg_net, and current benchmark/auth model the default; move AWS wording into an explicitly historical section only if still needed. |
| Civic feature docs | `docs/features/civic.md` | Describes `/api/civic/execute`, `/api/scrapers/monitoring`, Lambda triggers, DynamoDB `SCRAPER#`/`PROMISE#` records, and `promise-checker-lambda`. | Rewrite around `supabase/functions/civic/index.ts`, `civic-test`, `civic-execute`, `civic-extract-worker`, `civic_extraction_queue`, `promises`, `scout_runs`, and Supabase scheduling. |
| Social feature docs | `docs/features/social.md` | Describes EventBridge/Lambda, `/api/social/execute`, DynamoDB `POSTS#` snapshots, and legacy execution flow. | Rewrite around `social-kickoff`, `apify-callback`, `apify-reconcile`, `apify_run_queue`, `post_snapshots`, canonical unit dedup, and current Supabase auth. |
| MCP docs | `docs/mcp/architecture.md`, `docs/mcp/endpoints.md` | Tool list is stale (`ingest_units`, smaller surface); endpoint example expects `serverInfo.name = "scoutpost"` while code returns `cojournalist`. | Generate or validate docs from `supabase/functions/mcp-server/rpc.ts`; fix branding and tool-count drift. |
| FastAPI endpoint docs | `docs/architecture/fastapi-endpoints.md` | File has a cutover warning but still contains long current-looking sections for Lambda-triggered `/api/social/execute`, `/api/civic/execute`, `/api/scrapers/monitoring`, and EventBridge scheduling. | Split historical FastAPI material from the current public/Edge Function contract, or replace with a concise current API map plus links to Supabase docs. |
| OSS architecture docs | `docs/oss/architecture.md`, `docs/oss/edge-functions.md`, `docs/oss/adapter-pattern.md`, `docs/oss/license-key.md` | Several sections describe SaaS remaining on AWS indefinitely, Lambda-to-Edge mapping, AWS adapters, and DynamoDB license storage recommendations that conflict with the post-cutover repo framing. | Reconcile OSS docs with the current Supabase-first architecture and clearly label any preserved migration history. |

This rewrite should be its own documentation PR or the docs portion of the small reliability PR. It should not be mixed into behavioral fixes unless the touched behavior depends on the corrected contract.

## Prompt-Native Features

Scoutpost has prompt-native foundations but production behavior is still mostly code-defined.

What works:

- The public Scoutpost skill is the right kind of agent instruction surface.
- Agent setup recipes are outcome-oriented and agent-specific.
- AgentSPEX documents declarative YAML workflows with prompt templates and tool references.

Gaps:

- AgentSPEX appears prototype/test-level rather than production runtime.
- Production scout execution still uses hardcoded worker dispatch in `supabase/functions/execute-scout/index.ts`.
- Production prompt text lives inline in TypeScript Edge Functions, so behavioral prompt changes require code edits and deploys.
- `criteria` and `custom_filter_prompt` are useful inputs to hardcoded pipelines, not replaceable feature prompts.

Recommended prompt-native path:

1. Move production prompt text into versioned prompt/spec files, starting with Beat, Civic, Social, and Page extraction prompts.
2. Decide whether AgentSPEX becomes the production runtime or remains a prototype. If it remains a prototype, document that boundary.
3. If AgentSPEX graduates, make workers adapters behind prompt-defined workflows rather than separate hardcoded behavior islands.

## Issue Candidates

Create GitHub issues or PRs for these confirmed defects/gaps:

1. **MCP `merge_entities` sends the wrong keeper field** — [#217](https://github.com/buriedsignals/scoutpost/issues/217).
   Evidence: `supabase/functions/mcp-server/rpc.ts` declares `keeper_id`; `supabase/functions/entities/index.ts` requires `keep_id`.

2. **MCP `create_reflection` cannot satisfy the reflections API schema** — [#215](https://github.com/buriedsignals/scoutpost/issues/215).
   Evidence: `supabase/functions/mcp-server/rpc.ts` forwards only caller args; `supabase/functions/reflections/index.ts` requires `generated_by`.

3. **MCP docs and server branding are stale** — [#218](https://github.com/buriedsignals/scoutpost/issues/218).
   Evidence: `docs/mcp/architecture.md` lists an older tool surface and `ingest_units`; `docs/mcp/endpoints.md` expects `serverInfo.name = "scoutpost"`; code sets `SERVER_NAME = "cojournalist"`.

4. **High-level docs still describe the pre-cutover AWS/DynamoDB runtime as current** — [#216](https://github.com/buriedsignals/scoutpost/issues/216).
   Evidence: `CLAUDE.md`, `docs/features/civic.md`, `docs/features/social.md`, `docs/architecture/fastapi-endpoints.md`, and multiple `docs/oss/*` files still name Lambda/EventBridge/DynamoDB/SCRAPER#/POSTS#/PROMISE# flows while the current runtime is Supabase Edge Functions and Postgres.

## Recommended Next PRs

1. **Small reliability PR:** fix `merge_entities`, `create_reflection`, MCP server name, and stale MCP docs; add direct MCP tests.
2. **Docs rewrite PR:** update the stale AWS/DynamoDB/EventBridge docs listed above so future agents read the current Supabase runtime by default.
3. **Agent parity PR:** add CLI/API-key management, run diagnostics, and MCP user/preferences/context tools.
4. **Discovery PR:** generate or validate a capability manifest and render it into docs and the Agents modal.
5. **Realtime/UI PR:** add external-agent mutation visibility and selected-object reconciliation.
6. **Prompt-native architecture PR:** externalize production prompts and decide AgentSPEX's production role.
