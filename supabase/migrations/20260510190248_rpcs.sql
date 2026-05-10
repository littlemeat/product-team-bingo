-- RPCs callable by anon. SECURITY DEFINER lets them bypass RLS for the precise mutations they need.

create or replace function create_game(game_size smallint)
returns text
language plpgsql security definer
as $$
declare
  new_code text;
begin
  loop
    new_code := lower(substr(md5(random()::text), 1, 6));
    begin
      insert into games (short_code, size) values (new_code, game_size);
      return new_code;
    exception when unique_violation then
      -- retry on collision
    end;
  end loop;
end;
$$;

create or replace function join_game(p_short_code text, p_nickname text)
returns json
language plpgsql security definer
as $$
declare
  v_game games%rowtype;
  v_card_size int;
  v_phrase_count int;
  v_card_ids uuid[];
  v_player players%rowtype;
  v_card_phrases json;
  v_center_idx int;
begin
  select * into v_game from games where short_code = p_short_code;
  if not found then raise exception 'game_not_found'; end if;
  if v_game.ended_at is not null then raise exception 'game_ended'; end if;

  v_card_size := v_game.size * v_game.size;
  v_phrase_count := case when v_game.size in (3, 5) then v_card_size - 1 else v_card_size end;

  select array_agg(id) into v_card_ids from (
    select id from phrases where is_active = true order by random() limit v_phrase_count
  ) sampled;

  if array_length(v_card_ids, 1) is null or array_length(v_card_ids, 1) < v_phrase_count then
    raise exception 'not_enough_phrases';
  end if;

  if v_game.size in (3, 5) then
    v_center_idx := (v_card_size - 1) / 2;
    v_card_ids := v_card_ids[1:v_center_idx] || array[null::uuid] || v_card_ids[v_center_idx + 1:];
  end if;

  insert into players (game_id, nickname, card_phrase_ids)
  values (v_game.id, p_nickname, v_card_ids)
  returning * into v_player;

  select json_agg(json_build_object('id', p.id, 'text', p.text, 'position', pos.idx - 1) order by pos.idx)
  into v_card_phrases
  from unnest(v_card_ids) with ordinality as pos(phrase_id, idx)
  left join phrases p on p.id = pos.phrase_id;

  return json_build_object(
    'game_id', v_game.id,
    'player_id', v_player.id,
    'size', v_game.size,
    'card', v_card_phrases
  );
end;
$$;

create or replace function claim_win(p_game_id uuid, p_player_id uuid)
returns boolean
language plpgsql security definer
as $$
declare
  v_rows int;
begin
  update games
  set winner_player_id = p_player_id, ended_at = now()
  where id = p_game_id and winner_player_id is null;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

grant execute on function create_game(smallint) to anon;
grant execute on function join_game(text, text) to anon;
grant execute on function claim_win(uuid, uuid) to anon;
