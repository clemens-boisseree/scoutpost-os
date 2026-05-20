-- Page Scout canonical hash baselines.
--
-- Keep raw_captures as the baseline store, but add a versioned canonical hash
-- so Page Scout change detection can ignore provider/rendering noise without
-- depending on Firecrawl changeTracking state.

ALTER TABLE public.raw_captures
  ADD COLUMN IF NOT EXISTS canonical_content_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS canonicalizer_version TEXT;

CREATE INDEX IF NOT EXISTS idx_raw_scout_canonical_time
  ON public.raw_captures (scout_id, canonicalizer_version, captured_at DESC)
  WHERE canonical_content_sha256 IS NOT NULL;
