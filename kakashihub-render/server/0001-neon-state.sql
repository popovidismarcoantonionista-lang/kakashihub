CREATE TABLE IF NOT EXISTS public.fuga_state (
  id text PRIMARY KEY CHECK (id = 'primary'),
  revision bigint NOT NULL DEFAULT 1,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fuga_jobs (
  id text PRIMARY KEY,
  kind text NOT NULL,
  source_id text,
  clip_id text,
  workflow_run_id text,
  status text NOT NULL,
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  step text,
  error text,
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
