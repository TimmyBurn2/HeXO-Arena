CREATE INDEX `games_tournament_finish_idx` ON `games` (`finish_seq`) WHERE "games"."pairing_id" is not null;--> statement-breakpoint
CREATE INDEX `games_duels_finish_idx` ON `games` (`finish_seq`) WHERE "games"."duel_id" is not null;--> statement-breakpoint
CREATE INDEX `games_no_event_finish_idx` ON `games` (`finish_seq`) WHERE +"games"."duel_id" is null and +"games"."pairing_id" is null;