-- Core tables for multiplayer bingo.

create table phrases (
  id uuid primary key default gen_random_uuid(),
  text text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table games (
  id uuid primary key default gen_random_uuid(),
  short_code text unique not null,
  size smallint not null check (size in (3, 4, 5)),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  winner_player_id uuid
);
create index on games (short_code);

create table players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  nickname text not null,
  card_phrase_ids uuid[] not null,
  created_at timestamptz not null default now()
);
create index on players (game_id);

create table marks (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  position smallint not null,
  created_at timestamptz not null default now(),
  unique (player_id, position)
);
create index on marks (player_id);

alter table games add constraint games_winner_fk
  foreign key (winner_player_id) references players(id) on delete set null;
