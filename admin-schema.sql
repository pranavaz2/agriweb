-- Admin dashboard authentication and session tables.
-- Run this against the existing Purayidakrishi PostgreSQL database.

CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_users_username_lower_uq
  ON public.admin_users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_username_uq
  ON public.admin_users (username);

CREATE TABLE IF NOT EXISTS public.admin_sessions (
  token_hash char(64) PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx
  ON public.admin_sessions (expires_at);

-- The dashboard status workflow uses these values. Existing rows are preserved.
ALTER TABLE public.registrations ALTER COLUMN status SET DEFAULT 'enquiry_received';
ALTER TABLE public.contacts ALTER COLUMN status SET DEFAULT 'new';
