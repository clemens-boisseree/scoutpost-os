-- 00059_scout_run_diagnostics.sql
-- Internal run diagnostics for scout lifecycle hardening.
-- Keeps legacy scout_runs columns intact while adding richer stage/error/
-- notification state that operators can inspect without reading Edge logs.

ALTER TABLE public.scout_runs
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS error_class TEXT,
  ADD COLUMN IF NOT EXISTS notification_status TEXT,
  ADD COLUMN IF NOT EXISTS notification_reason TEXT,
  ADD COLUMN IF NOT EXISTS notification_provider_id TEXT,
  ADD COLUMN IF NOT EXISTS units_created_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS units_merged_count INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE public.scout_runs
    ADD CONSTRAINT scout_runs_stage_check
    CHECK (
      stage IS NULL OR stage IN (
        'dispatch',
        'scrape',
        'diff',
        'extract',
        'dedup',
        'insert_units',
        'notify',
        'credits',
        'finalize'
      )
    );
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.scout_runs
    ADD CONSTRAINT scout_runs_error_class_check
    CHECK (
      error_class IS NULL OR error_class IN (
        'platform',
        'provider',
        'auth',
        'quota',
        'validation',
        'timeout',
        'no_baseline',
        'unknown'
      )
    );
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.scout_runs
    ADD CONSTRAINT scout_runs_notification_status_check
    CHECK (
      notification_status IS NULL OR notification_status IN (
        'not_applicable',
        'pending',
        'sent',
        'skipped',
        'failed'
      )
    );
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

UPDATE public.scout_runs
   SET units_created_count = COALESCE(articles_count, 0),
       units_merged_count = COALESCE(merged_existing_count, 0),
       notification_status = CASE
         WHEN notification_sent THEN 'sent'
         WHEN status = 'success' THEN 'skipped'
         ELSE notification_status
       END
 WHERE units_created_count = 0
   AND units_merged_count = 0
   AND notification_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_scout_runs_recent_error_class
  ON public.scout_runs(error_class, started_at DESC)
  WHERE status = 'error';

CREATE INDEX IF NOT EXISTS idx_scout_runs_notification_status
  ON public.scout_runs(notification_status, started_at DESC)
  WHERE notification_status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_scout_runs_notification_reason
  ON public.scout_runs(notification_reason, started_at DESC)
  WHERE notification_reason IS NOT NULL;

-- Keep pgvector operators resolvable after moving the extension into the
-- extensions schema. db lint parses SECURITY DEFINER functions with their
-- configured search_path, so vector-using RPCs must include extensions.
ALTER FUNCTION public.upsert_canonical_unit(
  UUID,
  TEXT,
  TEXT,
  TEXT[],
  extensions.vector,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  DATE,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  UUID,
  UUID,
  UUID,
  JSONB,
  REAL,
  REAL,
  INT,
  BOOLEAN,
  REAL,
  BOOLEAN,
  TEXT
) SET search_path = public, extensions;

ALTER FUNCTION public.upsert_canonical_unit(
  UUID,
  TEXT,
  TEXT,
  TEXT[],
  extensions.vector,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  DATE,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  UUID,
  UUID,
  UUID,
  JSONB,
  REAL,
  REAL,
  INT
) SET search_path = public, extensions;

ALTER FUNCTION public.semantic_search_units(
  extensions.vector,
  UUID,
  UUID,
  UUID,
  INT,
  TEXT,
  INT
) SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS public.scout_run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scout_run_id UUID NOT NULL REFERENCES public.scout_runs(id) ON DELETE CASCADE,
  scout_id UUID REFERENCES public.scouts(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stage TEXT,
  status TEXT,
  error_class TEXT,
  notification_status TEXT,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scout_run_events_stage_check CHECK (
    stage IS NULL OR stage IN (
      'dispatch',
      'scrape',
      'diff',
      'extract',
      'dedup',
      'insert_units',
      'notify',
      'credits',
      'finalize'
    )
  ),
  CONSTRAINT scout_run_events_status_check CHECK (
    status IS NULL OR status IN ('running', 'success', 'error', 'skipped')
  ),
  CONSTRAINT scout_run_events_error_class_check CHECK (
    error_class IS NULL OR error_class IN (
      'platform',
      'provider',
      'auth',
      'quota',
      'validation',
      'timeout',
      'no_baseline',
      'unknown'
    )
  ),
  CONSTRAINT scout_run_events_notification_status_check CHECK (
    notification_status IS NULL OR notification_status IN (
      'not_applicable',
      'pending',
      'sent',
      'skipped',
      'failed'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_scout_run_events_run_time
  ON public.scout_run_events(scout_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scout_run_events_user_time
  ON public.scout_run_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scout_run_events_error_time
  ON public.scout_run_events(error_class, created_at DESC)
  WHERE error_class IS NOT NULL;

ALTER TABLE public.scout_run_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scout_run_events_user_read ON public.scout_run_events;
CREATE POLICY scout_run_events_user_read
  ON public.scout_run_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.scout_runs r
      WHERE r.id = scout_run_events.scout_run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.reconcile_stale_scout_runs(
  p_running_grace INTERVAL DEFAULT INTERVAL '45 minutes'
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  WITH updated AS (
    UPDATE public.scout_runs
       SET status = 'error',
           stage = COALESCE(stage, 'finalize'),
           error_class = 'timeout',
           error_message = 'run exceeded stale running grace and was reconciled',
           notification_status = COALESCE(notification_status, 'not_applicable'),
           notification_reason = COALESCE(notification_reason, 'stale_running_reconciled'),
           completed_at = NOW()
     WHERE status = 'running'
       AND started_at < NOW() - p_running_grace
     RETURNING id, scout_id, user_id, stage
  ),
  inserted_events AS (
    INSERT INTO public.scout_run_events (
      scout_run_id,
      scout_id,
      user_id,
      stage,
      status,
      error_class,
      notification_status,
      message,
      metadata
    )
    SELECT
      id,
      scout_id,
      user_id,
      stage,
      'error',
      'timeout',
      'not_applicable',
      'run exceeded stale running grace and was reconciled',
      jsonb_build_object('running_grace', p_running_grace::TEXT)
    FROM updated
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted_events;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_stale_scout_runs(INTERVAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_scout_runs(INTERVAL)
  TO service_role;

SELECT cron.unschedule('reconcile-stale-scout-runs')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'reconcile-stale-scout-runs'
);

SELECT cron.unschedule('cleanup-stale-scout-runs')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-stale-scout-runs'
);

SELECT cron.schedule(
  'reconcile-stale-scout-runs',
  '*/15 * * * *',
  'SELECT public.reconcile_stale_scout_runs();'
);
