-- Nox Analytics — Supabase Schema
-- Run this in Supabase SQL Editor after creating a project.

-- ---------------------------------------------------------------------------
-- Events table
-- ---------------------------------------------------------------------------
create table if not exists public.nox_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_type text not null,
  app_version text,
  os text,
  locale text,
  country text,
  session_id text,
  error_code text,
  metadata jsonb default '{}'::jsonb
);

-- Index for dashboard queries
create index if not exists idx_nox_events_created_at on public.nox_events (created_at desc);
create index if not exists idx_nox_events_type on public.nox_events (event_type);
create index if not exists idx_nox_events_country on public.nox_events (country);
create index if not exists idx_nox_events_error_code on public.nox_events (error_code);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

-- Disable all direct table access — only RPC can insert
alter table public.nox_events enable row level security;

-- Drop old policies if they exist
drop policy if exists "Allow anonymous inserts" on public.nox_events;
drop policy if exists "Allow authenticated reads" on public.nox_events;
drop policy if exists "No updates" on public.nox_events;
drop policy if exists "No deletes" on public.nox_events;

-- Only authenticated users can read (dashboard login)
create policy "Allow authenticated reads"
  on public.nox_events
  for select
  to authenticated
  using (true);

-- No direct inserts/updates/deletes for any role (RPC handles inserts)
create policy "No direct inserts" on public.nox_events for insert to anon, authenticated with check (false);
create policy "No updates" on public.nox_events for update to authenticated using (false);
create policy "No deletes" on public.nox_events for delete to authenticated using (false);

-- ---------------------------------------------------------------------------
-- Secure RPC function for inserting events
-- Only callable with the correct secret token
-- ---------------------------------------------------------------------------

create or replace function public.insert_nox_events(
  p_token text,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_event jsonb;
  v_country text;
  v_locale text;
  v_count int;
begin
  -- Validate token (hardcoded — Supabase hides function source from anon users)
  -- IMPORTANT: Replace 'CHANGE_ME_TO_A_STRONG_TOKEN' with your own secret token!
  if p_token is null or p_token != 'CHANGE_ME_TO_A_STRONG_TOKEN' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  -- Rate limit: max 100 events per batch
  v_count := jsonb_array_length(p_events);
  if v_count > 100 then
    return jsonb_build_object('ok', false, 'error', 'too_many_events', 'max', 100);
  end if;

  if v_count = 0 then
    return jsonb_build_object('ok', true, 'count', 0);
  end if;

  -- Insert each event
  foreach v_event in array (select array_agg(x) from jsonb_array_elements(p_events) x)
  loop
    v_locale := v_event->>'locale';
    -- Derive country from locale (e.g. de_DE -> DE, en_US -> US)
    if v_locale is not null and v_locale != '' and position('_' in v_locale) > 0 then
      v_country := split_part(v_locale, '_', 2);
    elsif v_locale is not null and v_locale != '' then
      v_country := v_locale;
    else
      v_country := null;
    end if;

    insert into public.nox_events (
      event_type, app_version, os, locale, country, session_id, error_code, metadata
    ) values (
      v_event->>'event_type',
      v_event->>'app_version',
      v_event->>'os',
      v_locale,
      v_country,
      v_event->>'session_id',
      v_event->>'error_code',
      COALESCE(v_event->'metadata', '{}'::jsonb)
    );
  end loop;

  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_events));
end;
$$;

-- Grant execute to anon (the function itself validates the token)
grant execute on function public.insert_nox_events(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Set the secret token — CHANGE THIS to a strong random string!
-- ---------------------------------------------------------------------------
-- The token is hardcoded in the RPC function above (line: p_token != 'CHANGE_ME_TO_A_STRONG_TOKEN')
-- Replace 'CHANGE_ME_TO_A_STRONG_TOKEN' with your own strong random string (32+ chars)
-- Generate one with: python -c "import secrets; print(secrets.token_urlsafe(32))"
-- Use the same token in the Nox app config (analytics_token)

-- ---------------------------------------------------------------------------
-- Enable realtime for events (optional, for live dashboard)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.nox_events;
