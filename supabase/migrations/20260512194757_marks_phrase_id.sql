-- Denormalize: every mark also stores which phrase was marked.
-- Lets stats queries skip the players.card_phrase_ids[position+1] join.

alter table marks add column phrase_id uuid references phrases(id) on delete set null;

-- Backfill existing marks. PG arrays are 1-indexed, marks.position is 0-indexed.
update marks m
set phrase_id = p.card_phrase_ids[m.position + 1]
from players p
where m.player_id = p.id and m.phrase_id is null;

create index on marks (phrase_id);

-- Enforce NOT NULL after backfill. If anything was missed, this fails and the whole migration rolls back.
alter table marks alter column phrase_id set not null;
