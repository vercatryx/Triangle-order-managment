-- Single RPC for login identity lookup: one round-trip instead of 4–5 table queries.
-- Run in Supabase SQL Editor.
-- Normalizes email as: lower(trim(regexp_replace(email, '\s+', '', 'g'))).

CREATE OR REPLACE FUNCTION lookup_login_identity(
  p_username_trimmed text,   -- for admin: exact match on username
  p_email_normalized text   -- for vendor/navigator/client: normalized email (lowercase, no spaces)
)
RETURNS TABLE (
  account_type text,
  account_id text,
  service_type text,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Admins (by username, case-sensitive as stored)
  RETURN QUERY
  SELECT
    'admin'::text,
    a.id::text,
    NULL::text,
    NULL::boolean
  FROM admins a
  WHERE a.username = p_username_trimmed;

  -- 2. Vendors (by normalized email)
  RETURN QUERY
  SELECT
    'vendor'::text,
    v.id::text,
    NULL::text,
    v.is_active
  FROM vendors v
  WHERE v.email IS NOT NULL
    AND regexp_replace(lower(trim(v.email)), '\s+', '', 'g') = p_email_normalized;

  -- 3. Navigators (by normalized email)
  RETURN QUERY
  SELECT
    'navigator'::text,
    n.id::text,
    NULL::text,
    NULL::boolean
  FROM navigators n
  WHERE n.email IS NOT NULL
    AND regexp_replace(lower(trim(n.email)), '\s+', '', 'g') = p_email_normalized;

  -- 4. Clients (by normalized email)
  RETURN QUERY
  SELECT
    'client'::text,
    c.id,
    c.service_type,
    NULL::boolean
  FROM clients c
  WHERE c.email IS NOT NULL
    AND regexp_replace(lower(trim(c.email)), '\s+', '', 'g') = p_email_normalized;
END;
$$;

COMMENT ON FUNCTION lookup_login_identity(text, text) IS
  'Returns matching login accounts for given username (admin) and normalized email (vendor/navigator/client). Used by login identity check.';
