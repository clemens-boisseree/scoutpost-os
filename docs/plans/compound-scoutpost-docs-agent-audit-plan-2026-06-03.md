---
title: Compound Scoutpost Docs And Agent Audit Plan
status: completed
type: docs-audit
created: 2026-06-03
origin: user request to run ce-doc-review, ce-compound, ce-strategy, and ce-agent-native-audit in a new worktree
branch: docs/compound-scoutpost-audit
---

# Compound Scoutpost Docs And Agent Audit Plan

## Problem Frame

Scoutpost has just changed its benchmark and authentication architecture: product-level scout benchmarks now use shared Supabase user authentication, internal worker smoke checks are separated, and weekly scout health should map cleanly to the four scout types. The repo already has substantial documentation, but the highest risk is drift between product intent, agent surfaces, benchmark scripts, OSS setup, and operational docs.

This plan runs four compound-engineering workflows in an isolated worktree to produce durable strategy, learning, review, and agent-native audit artifacts without disturbing `main`.

## Scope

In scope:

- Create or update `STRATEGY.md` using `ce-strategy`.
- Capture the benchmark/auth cleanup learning using `ce-compound`.
- Audit Scoutpost's CLI, MCP, REST, frontend, and Supabase surfaces against agent-native principles using `ce-agent-native-audit`.
- Review the resulting documents and this plan using `ce-doc-review`.
- Keep all work in the `docs/compound-scoutpost-audit` branch worktree.
- Preserve the current benchmark architecture and product intent; this pass may surface follow-up issues but should not bundle implementation fixes unless the user explicitly asks.

Out of scope:

- Running live scouts or spending credits.
- Closing historical GitHub benchmark issues before live weekly validation.
- Changing benchmark behavior, Supabase migrations, or auth code as part of this documentation/audit pass.
- Committing secrets or embedding secret values in any artifact.

## Worktree

Use the existing isolated worktree:

- Path: `.worktrees/docs/compound-scoutpost-audit`
- Branch: `docs/compound-scoutpost-audit`
- Base: local `main` at `04969c8 fix: split scout benchmarks from worker auth smoke (#213)`

Note: worktree creation could not fetch `origin/main` because sandbox network access could not resolve `github.com`, so the worktree was created from the local `main` ref.

## Existing Inputs To Read

- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `live-scout-verification-plan-2026-06-03.md`
- `.github/workflows/weekly-scout-benchmarks.yml`
- `.github/workflows/qa-matrix.yml`
- `scripts/benchmark-scout-suite.ts`
- `scripts/benchmark-internal-workers.ts`
- `scripts/benchmark-web.ts`
- `scripts/benchmark-beat.ts`
- `scripts/benchmark-social.ts`
- `scripts/benchmark-civic.ts`
- `docs/supabase/benchmarks.md`
- `docs/specs/cron-auth-and-oss-benchmark-hardening.md`
- `docs/oss/newsroom-docker-install.md`
- `docs/mcp/README.md`
- `mcp/README.md`
- `cli/README.md`

## Execution Order

### U1. Preflight And Baseline Inventory

Goal: establish the baseline before producing documents.

Approach:

- Confirm worktree status is clean.
- Confirm no secret files are staged.
- Inventory docs, scripts, workflows, CLI, MCP, and REST surfaces relevant to benchmark and agent use.
- Record any obvious stale documentation targets to feed into later review.

Expected output:

- No code changes.
- A short inventory note in the session summary or, if useful, a section appended to this plan.

Verification:

- `git status --short --branch`
- `git check-ignore -v '*.secret.txt'` only if a secret handoff file is present.

### U2. Run `ce-strategy`

Goal: create `STRATEGY.md` as Scoutpost's durable product anchor.

Decision:

- Run strategy before the audit so the agent-native audit is judged against product intent, not a generic "more tools is better" frame.

Approach:

- Use the first-run path to create `STRATEGY.md`.
- Use the existing repo docs as source material, but keep the required user interview boundary: sections such as target problem, approach, users, key metrics, and tracks need user-confirmed wording.
- Keep the document short. Strategy should not become a benchmark plan or feature backlog.

Expected output:

- `STRATEGY.md`

Review questions to resolve during the run:

- Is Scoutpost primarily framed as newsroom monitoring infrastructure, an agent-native research workspace, or both?
- Which metrics matter most: successful scout runs, verified units, low-noise editorial leads, weekly benchmark health, user retention, or another set?
- Are OSS and SaaS equal strategic tracks, or is OSS primarily a reliability/deployment proof surface?

Verification:

- Confirm `STRATEGY.md` has frontmatter and the required sections.
- Confirm it does not include secrets, tactical issue lists, or unverified product claims.

### U3. Run `ce-agent-native-audit`

Goal: score Scoutpost against the eight agent-native principles and identify gaps that matter for the CLI/MCP/REST product surface.

Decision:

- Run after strategy so gaps are prioritized by product role: journalist-facing monitoring with agent assistance, not abstract agent maximalism.

Approach:

- Load `ce-agent-native-architecture` as required by the audit skill.
- Audit across these surfaces:
  - Frontend user actions in `frontend/`
  - Public REST/API behavior in `backend/`, `supabase/functions/`, and docs
  - CLI behavior in `cli/`
  - MCP behavior in `mcp/`
  - Shared workspace/data model in `supabase/` and docs
- Produce a scored report with concrete file references and recommendations.
- Keep recommendations separate from implementation. File GitHub issues only for confirmed bugs or reliability gaps, not speculative architecture preferences.

Expected output:

- `docs/architecture/agent-native-audit-2026-06-03.md`

Required audit sections:

- Action parity
- Tools as primitives
- Context injection
- Shared workspace
- CRUD completeness
- UI integration
- Capability discovery
- Prompt-native features
- Prioritized recommendations
- Issue candidates, if any

Verification:

- Every major score must cite concrete repo-relative evidence.
- Recommendations must distinguish product-important gaps from merely possible agent features.
- Any proposed issue must include reproduction or a specific missing contract.

### U4. Run `ce-compound`

Goal: document the recently solved benchmark/auth cleanup while context is fresh.

Decision:

- Run after the audit only if the audit does not discover that the benchmark cleanup premise is wrong. If the audit finds a major contradiction, pause and fix the premise first.

Approach:

- Use the context hint: "Scoutpost benchmark authentication cleanup: product scout benchmarks use Supabase user auth, internal worker smoke is separated, weekly benchmarks cover Page, Beat, Civic, Social, Beat asserts Exa, OSS Docker health is separate."
- Prefer full mode unless the session is time constrained.
- Let the workflow create `docs/solutions/` if needed.
- If the discoverability check proposes adding a pointer to `CLAUDE.md` or `AGENTS.md`, accept only if the edit is narrowly scoped and makes future benchmark work easier.

Expected output:

- A new solution/learning document under `docs/solutions/`.
- Possibly a small discoverability pointer in `CLAUDE.md` or `AGENTS.md`.

Verification:

- The doc clearly separates:
  - product scout benchmarks
  - internal worker smoke checks
  - OSS Docker tests
  - weekly asynchronous benchmark automation
- The doc states that historical benchmark issues should not be closed until live weekly validation passes.
- The doc references repo-relative files and does not include secrets.

### U5. Run `ce-doc-review`

Goal: stress-test the plan and generated docs for coherence, feasibility, security boundaries, scope, and stale claims.

Decision:

- Run `ce-doc-review` twice:
  - First on this plan before executing the rest if the user wants a stricter front-loaded review.
  - Final pass on produced docs after `STRATEGY.md`, the agent-native audit report, and the compound learning exist.

Approach:

- Use headless mode for quick plan review if execution should continue without interruption.
- Use interactive mode for final docs if the user wants to decide what to apply.
- Activate security/adversarial lenses where the docs mention auth, secrets, Supabase service role keys, benchmark automation, or deployed functions.

Expected reviewed documents:

- `docs/plans/compound-scoutpost-docs-agent-audit-plan-2026-06-03.md`
- `STRATEGY.md`
- `docs/architecture/agent-native-audit-2026-06-03.md`
- `docs/solutions/workflow-issues/benchmark-auth-model.md`
- Optionally `docs/supabase/benchmarks.md` and `docs/specs/cron-auth-and-oss-benchmark-hardening.md` if review finds drift.

Verification:

- Applied edits are anchored in the reviewed documents.
- Non-applied findings are recorded as open questions or follow-up recommendations.
- No new unreviewed claims are introduced during doc-review fixes.

## Final Verification

Run these checks before reporting completion:

- `git status --short --branch`
- `rg -n "SERVICE_ROLE|INTERNAL_SERVICE_KEY|SUPABASE_SERVICE|secret|token|password" STRATEGY.md docs/architecture docs/solutions docs/plans`
- `deno run --allow-env --allow-run --allow-read=. scripts/benchmark-scout-suite.ts --dry-run`
- `deno run --allow-env scripts/benchmark-qa-matrix.ts`
- If documentation links changed, manually inspect the touched links and headings.

If Deno checks fail because dependencies or network are unavailable, report the exact failure and do not imply runtime verification passed.

## Follow-Up Policy

- Create GitHub issues only for confirmed bugs, broken contracts, or reliability gaps with concrete evidence.
- Do not close benchmark issues #173, #174, #175, #176, #177, or #178 solely based on documentation. Close or comment resolution only after live weekly benchmark validation passes.
- Do not stage or commit the plan unless the user asks for a PR or permanent artifact.

## Executed Outputs

This plan produced:

- `STRATEGY.md`
- `docs/architecture/agent-native-audit-2026-06-03.md`
- `docs/solutions/workflow-issues/benchmark-auth-model.md`
- a narrow benchmark-model discoverability pointer in `CLAUDE.md`

`ce-doc-review` then reviewed the generated artifacts and its accepted fixes were applied to the plan, strategy, benchmark learning, and audit report.
