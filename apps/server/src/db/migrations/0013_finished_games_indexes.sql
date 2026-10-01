DROP INDEX `games_user_id_idx`;--> statement-breakpoint
DROP INDEX `games_bot_id_idx`;--> statement-breakpoint
DROP INDEX `games_challenger_bot_id_idx`;--> statement-breakpoint
DROP INDEX `games_dest_bot_id_idx`;--> statement-breakpoint
CREATE INDEX `games_user_finish_idx` ON `games` (`user_id`,`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_bot_finish_idx` ON `games` (`bot_id`,`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_challenger_finish_idx` ON `games` (`challenger_bot_id`,`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_dest_finish_idx` ON `games` (`dest_bot_id`,`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_human_finish_idx` ON `games` (`finish_seq`) WHERE "games"."user_id" is not null;--> statement-breakpoint
CREATE INDEX `games_bots_finish_idx` ON `games` (`finish_seq`) WHERE "games"."challenger_bot_id" is not null;--> statement-breakpoint
CREATE INDEX `games_undecided_finish_idx` ON `games` (`finish_seq`) WHERE "games"."winner" is null;--> statement-breakpoint
CREATE INDEX `games_reason_finish_idx` ON `games` (`finish_reason`,`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_clock_finish_idx` ON `games` ("time_control" ->> '$.mode',`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_opening_finish_idx` ON `games` (json_array_length("opening_cells"),`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_finished_at_idx` ON `games` (`finished_at`);