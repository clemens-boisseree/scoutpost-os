/**
 * Public Beat / Location pipeline facade.
 *
 * The current Firecrawl-compatible 8-stage implementation is isolated in
 * `beat_pipeline_legacy.ts` while Exa canaries run. Keeping this facade small
 * makes the production import surface explicit and gives Phase 5 one deletion
 * target after Exa is proven live.
 */

export * from "./beat_pipeline_legacy.ts";
