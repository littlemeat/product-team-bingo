-- Forward compatibility with Supabase's Oct 30 2026 change: new tables in
-- public will require explicit GRANTs to be exposed via the Data API.
--
-- Our existing tables still inherit the legacy default until that date, but
-- making the grants explicit now means the schema is self-contained for any
-- future recreation/clone, and any new tables we add after Oct 30 won't break
-- silently if we forget. RLS continues to do the real access control on top.
--
-- Grants below mirror what the frontend actually does + what current RLS
-- policies allow (anon SELECTs everywhere; INSERTs on games/players/marks via
-- direct REST as a fallback to the SECURITY DEFINER RPCs).

grant select on phrases to anon, authenticated;
grant select, insert on games to anon, authenticated;
grant select, insert on players to anon, authenticated;
grant select, insert on marks to anon, authenticated;
