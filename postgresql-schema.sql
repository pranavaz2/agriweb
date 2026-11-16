-- PostgreSQL schema for Purayidakrishi contact enquiries, course registrations,
-- and private payment-proof files stored as BYTEA in PostgreSQL.
-- Run this file once against the target PostgreSQL database.

CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  email text NOT NULL,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 2 AND 180),
  message text NOT NULL CHECK (char_length(message) BETWEEN 5 AND 3000),
  language text NOT NULL DEFAULT 'ml' CHECK (language IN ('en', 'ml')),
  status text NOT NULL DEFAULT 'new',
  consent_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  phone text NOT NULL CHECK (char_length(phone) BETWEEN 8 AND 20),
  location text NOT NULL CHECK (char_length(location) BETWEEN 2 AND 160),
  email text,
  course text NOT NULL,
  language text NOT NULL DEFAULT 'ml' CHECK (language IN ('en', 'ml')),
  status text NOT NULL DEFAULT 'enquiry_received',
  consent_at timestamptz NOT NULL DEFAULT now()
);

-- Proof files remain private because file bytes are stored in the database,
-- not exposed through a public object-storage URL. One optional proof per registration.
CREATE TABLE IF NOT EXISTS public.registration_payment_proofs (
  registration_id uuid PRIMARY KEY REFERENCES public.registrations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  original_filename text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 160),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  file_size integer NOT NULL CHECK (file_size BETWEEN 1 AND 5242880),
  file_data bytea NOT NULL
);

CREATE INDEX IF NOT EXISTS contacts_created_at_idx ON public.contacts (created_at DESC);
CREATE INDEX IF NOT EXISTS registrations_created_at_idx ON public.registrations (created_at DESC);
CREATE INDEX IF NOT EXISTS registrations_phone_idx ON public.registrations (phone);

-- Private admin dashboard accounts and expiring database-backed sessions.
CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_username_lower_uq ON public.admin_users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_username_uq ON public.admin_users (username);

CREATE TABLE IF NOT EXISTS public.admin_sessions (
  token_hash char(64) PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx ON public.admin_sessions (expires_at);
