-- Row Level Security. Anon can read active phrases and game/player/mark state,
-- and insert games/players/marks. Updates and deletes go through SECURITY DEFINER RPCs only.

alter table phrases enable row level security;
create policy "anon read active phrases" on phrases for select using (is_active = true);

alter table games enable row level security;
create policy "anon read games" on games for select using (true);
create policy "anon insert games" on games for insert with check (true);

alter table players enable row level security;
create policy "anon read players" on players for select using (true);
create policy "anon insert players" on players for insert with check (true);

alter table marks enable row level security;
create policy "anon read marks" on marks for select using (true);
create policy "anon insert marks" on marks for insert with check (true);
