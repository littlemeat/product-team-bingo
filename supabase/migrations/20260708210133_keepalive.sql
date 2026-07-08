-- Keepalive: single-row table + write-ping RPC. Anon read-only pings don't
-- count as "sufficient activity" against Supabase free-tier pause detection —
-- writes do. The daily GitHub Actions cron calls keepalive_ping() which
-- UPDATEs last_ping, which registers as real database activity.

create table if not exists public.keepalive (
  id        boolean primary key default true check (id),  -- single-row guard
  last_ping timestamptz not null default now()
);

insert into public.keepalive (id) values (true)
on conflict do nothing;

-- RLS on with no policies: the table is unreachable via direct REST from anon;
-- everything goes through the SECURITY DEFINER RPC below.
alter table public.keepalive enable row level security;

create or replace function public.keepalive_ping()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  update public.keepalive set last_ping = now() where id returning last_ping;
$$;

revoke all on function public.keepalive_ping() from public;
grant execute on function public.keepalive_ping() to anon, authenticated;
