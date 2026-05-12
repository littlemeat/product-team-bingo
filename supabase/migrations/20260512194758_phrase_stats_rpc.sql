-- Per-phrase analytics for the admin panel.
-- "Played game" = a game with at least one mark by any player.
-- Window defaults to the last 10 played games.

create or replace function get_phrase_stats(p_window_games int default 10)
returns table (
  phrase_id uuid,
  text text,
  is_active boolean,
  shown_count bigint,
  marked_count bigint,
  mark_rate_pct numeric,
  last_shown_at timestamptz,
  last_marked_at timestamptz,
  created_at timestamptz
)
language sql
security definer
as $$
  with played_games as (
    select g.id, g.created_at
    from games g
    where exists (
      select 1 from players p
      join marks m on m.player_id = p.id
      where p.game_id = g.id
    )
    order by g.created_at desc
    limit p_window_games
  ),
  shown as (
    select unnest(p.card_phrase_ids) as phrase_id,
           max(p.created_at) as last_shown_at,
           count(*) as shown_count
    from players p
    where p.game_id in (select id from played_games)
    group by 1
  ),
  marked as (
    select m.phrase_id,
           max(m.created_at) as last_marked_at,
           count(*) as marked_count
    from marks m
    join players p on p.id = m.player_id
    where p.game_id in (select id from played_games)
      and m.phrase_id is not null
    group by 1
  )
  select
    ph.id as phrase_id,
    ph.text,
    ph.is_active,
    coalesce(s.shown_count, 0) as shown_count,
    coalesce(mk.marked_count, 0) as marked_count,
    case when coalesce(s.shown_count, 0) > 0
         then round(100.0 * coalesce(mk.marked_count, 0) / s.shown_count, 1)
         else 0
    end as mark_rate_pct,
    s.last_shown_at,
    mk.last_marked_at,
    ph.created_at
  from phrases ph
  left join shown s on s.phrase_id = ph.id
  left join marked mk on mk.phrase_id = ph.id
  order by ph.is_active desc, mark_rate_pct desc, shown_count desc;
$$;

grant execute on function get_phrase_stats(int) to anon, authenticated;
