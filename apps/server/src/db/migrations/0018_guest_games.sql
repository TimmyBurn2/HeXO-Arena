PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`bot_id` text,
	`user_side` text,
	`guest_name` text,
	`challenger_bot_id` text,
	`dest_bot_id` text,
	`challenger_side` text,
	`time_control` text NOT NULL,
	`opening_cells` text NOT NULL,
	`winner` text,
	`finish_reason` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	`finish_seq` integer,
	`voided_at` integer,
	`pairing_id` text,
	`pairing_game` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`challenger_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dest_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pairing_id`) REFERENCES `tournament_pairings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "games_pairing_check" CHECK(("__new_games"."pairing_id" is null and "__new_games"."pairing_game" is null) or ("__new_games"."pairing_id" is not null and coalesce("__new_games"."pairing_game", 0) in (1, 2) and "__new_games"."challenger_bot_id" is not null)),
	CONSTRAINT "games_guest_name_check" CHECK("__new_games"."guest_name" is null or "__new_games"."guest_name" glob 'Guest [a-z0-9][a-z0-9][a-z0-9][a-z0-9]'),
	CONSTRAINT "games_user_side_check" CHECK("__new_games"."user_side" is null or "__new_games"."user_side" in ('x', 'o')),
	CONSTRAINT "games_challenger_side_check" CHECK("__new_games"."challenger_side" is null or "__new_games"."challenger_side" in ('x', 'o')),
	CONSTRAINT "games_winner_check" CHECK("__new_games"."winner" is null or "__new_games"."winner" in ('x', 'o')),
	CONSTRAINT "games_finish_reason_check" CHECK("__new_games"."finish_reason" is null or "__new_games"."finish_reason" in ('aborted', 'disconnect', 'surrender', 'timeout', 'terminated', 'six-in-a-row')),
	CONSTRAINT "games_finish_pair_check" CHECK(("__new_games"."finished_at" is null) = ("__new_games"."finish_reason" is null)),
	CONSTRAINT "games_finish_seq_check" CHECK(("__new_games"."finished_at" is null) = ("__new_games"."finish_seq" is null)),
	CONSTRAINT "games_seats_check" CHECK((
                "__new_games"."user_id" is not null and "__new_games"."guest_name" is null and "__new_games"."bot_id" is not null and "__new_games"."user_side" is not null
                and "__new_games"."challenger_bot_id" is null and "__new_games"."dest_bot_id" is null and "__new_games"."challenger_side" is null
            ) or (
                "__new_games"."user_id" is null and "__new_games"."guest_name" is not null and "__new_games"."bot_id" is not null and "__new_games"."user_side" is not null
                and "__new_games"."challenger_bot_id" is null and "__new_games"."dest_bot_id" is null and "__new_games"."challenger_side" is null
            ) or (
                "__new_games"."user_id" is null and "__new_games"."guest_name" is null and "__new_games"."bot_id" is null and "__new_games"."user_side" is null
                and "__new_games"."challenger_bot_id" is not null and "__new_games"."dest_bot_id" is not null and "__new_games"."challenger_side" is not null
                and "__new_games"."challenger_bot_id" <> "__new_games"."dest_bot_id"
            ))
);
--> statement-breakpoint
INSERT INTO `__new_games`("id", "user_id", "bot_id", "user_side", "guest_name", "challenger_bot_id", "dest_bot_id", "challenger_side", "time_control", "opening_cells", "winner", "finish_reason", "created_at", "finished_at", "finish_seq", "voided_at", "pairing_id", "pairing_game") SELECT "id", "user_id", "bot_id", "user_side", null, "challenger_bot_id", "dest_bot_id", "challenger_side", "time_control", "opening_cells", "winner", "finish_reason", "created_at", "finished_at", "finish_seq", "voided_at", "pairing_id", "pairing_game" FROM `games`;--> statement-breakpoint
-- Migrations run inside one transaction, where the foreign_keys pragma is a no-op,
-- so dropping games would cascade into the rows that point at it; they ride out the rebuild in temp tables.
CREATE TEMP TABLE `__kept_moves` AS SELECT * FROM `moves`;--> statement-breakpoint
CREATE TEMP TABLE `__kept_challenges` AS SELECT * FROM `challenges`;--> statement-breakpoint
CREATE TEMP TABLE `__kept_game_ratings` AS SELECT * FROM `game_ratings`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
DELETE FROM `moves`;--> statement-breakpoint
INSERT INTO `moves` SELECT * FROM `__kept_moves`;--> statement-breakpoint
DROP TABLE `__kept_moves`;--> statement-breakpoint
DELETE FROM `challenges`;--> statement-breakpoint
INSERT INTO `challenges` SELECT * FROM `__kept_challenges`;--> statement-breakpoint
DROP TABLE `__kept_challenges`;--> statement-breakpoint
DELETE FROM `game_ratings`;--> statement-breakpoint
INSERT INTO `game_ratings` SELECT * FROM `__kept_game_ratings`;--> statement-breakpoint
DROP TABLE `__kept_game_ratings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `games_finish_seq_idx` ON `games` (`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_user_finish_idx` ON `games` (`user_id`,`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_bot_finish_idx` ON `games` (`bot_id`,`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_challenger_finish_idx` ON `games` (`challenger_bot_id`,`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_dest_finish_idx` ON `games` (`dest_bot_id`,`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_human_finish_idx` ON `games` (`finish_seq`) WHERE "games"."user_id" is not null;--> statement-breakpoint
CREATE INDEX `games_guests_finish_idx` ON `games` (`finish_seq`) WHERE "games"."guest_name" is not null;--> statement-breakpoint
CREATE INDEX `games_bots_finish_idx` ON `games` (`finish_seq`) WHERE "games"."challenger_bot_id" is not null;--> statement-breakpoint
CREATE INDEX `games_undecided_finish_idx` ON `games` (`finish_seq`) WHERE "games"."winner" is null;--> statement-breakpoint
CREATE INDEX `games_reason_finish_idx` ON `games` (`finish_reason`,`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_clock_finish_idx` ON `games` ("time_control" ->> '$.mode',`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_opening_finish_idx` ON `games` (json_array_length("opening_cells"),`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_finished_at_idx` ON `games` (`finished_at`);--> statement-breakpoint
CREATE INDEX `games_pairing_idx` ON `games` (`pairing_id`,`pairing_game`);