-- Publish games row changes via Realtime so clients see winner_player_id flips.

alter publication supabase_realtime add table games;
