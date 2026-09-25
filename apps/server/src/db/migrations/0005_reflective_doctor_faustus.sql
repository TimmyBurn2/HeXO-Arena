CREATE TABLE `ratings` (
	`user_id` text,
	`bot_id` text,
	`rating` real NOT NULL,
	`deviation` real NOT NULL,
	`volatility` real NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ratings_player_check" CHECK(("ratings"."user_id" is null) <> ("ratings"."bot_id" is null)),
	CONSTRAINT "ratings_rating_check" CHECK("ratings"."rating" >= 400),
	CONSTRAINT "ratings_deviation_check" CHECK("ratings"."deviation" >= 45 and "ratings"."deviation" <= 500),
	CONSTRAINT "ratings_volatility_check" CHECK("ratings"."volatility" > 0 and "ratings"."volatility" <= 0.1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ratings_user_id_idx` ON `ratings` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ratings_bot_id_idx` ON `ratings` (`bot_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`bot_id` text,
	`user_side` text,
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
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`challenger_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dest_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "games_user_side_check" CHECK("__new_games"."user_side" is null or "__new_games"."user_side" in ('x', 'o')),
	CONSTRAINT "games_challenger_side_check" CHECK("__new_games"."challenger_side" is null or "__new_games"."challenger_side" in ('x', 'o')),
	CONSTRAINT "games_winner_check" CHECK("__new_games"."winner" is null or "__new_games"."winner" in ('x', 'o')),
	CONSTRAINT "games_finish_reason_check" CHECK("__new_games"."finish_reason" is null or "__new_games"."finish_reason" in ('aborted', 'disconnect', 'surrender', 'timeout', 'terminated', 'six-in-a-row')),
	CONSTRAINT "games_finish_pair_check" CHECK(("__new_games"."finished_at" is null) = ("__new_games"."finish_reason" is null)),
	CONSTRAINT "games_finish_seq_check" CHECK(("__new_games"."finished_at" is null) = ("__new_games"."finish_seq" is null)),
	CONSTRAINT "games_seats_check" CHECK((
                "__new_games"."user_id" is not null and "__new_games"."bot_id" is not null and "__new_games"."user_side" is not null
                and "__new_games"."challenger_bot_id" is null and "__new_games"."dest_bot_id" is null and "__new_games"."challenger_side" is null
            ) or (
                "__new_games"."user_id" is null and "__new_games"."bot_id" is null and "__new_games"."user_side" is null
                and "__new_games"."challenger_bot_id" is not null and "__new_games"."dest_bot_id" is not null and "__new_games"."challenger_side" is not null
                and "__new_games"."challenger_bot_id" <> "__new_games"."dest_bot_id"
            ))
);
--> statement-breakpoint
-- Earlier finishes take their order from the finish time, ties broken by creation order.
INSERT INTO `__new_games`("id", "user_id", "bot_id", "user_side", "challenger_bot_id", "dest_bot_id", "challenger_side", "time_control", "opening_cells", "winner", "finish_reason", "created_at", "finished_at", "finish_seq") SELECT "id", "user_id", "bot_id", "user_side", "challenger_bot_id", "dest_bot_id", "challenger_side", "time_control", "opening_cells", "winner", "finish_reason", "created_at", "finished_at", CASE WHEN "finished_at" IS NULL THEN NULL ELSE row_number() OVER (ORDER BY "finished_at" IS NULL, "finished_at", rowid) END FROM `games`;--> statement-breakpoint
-- Migrations run inside one transaction, where the foreign_keys pragma is a no-op,
-- so dropping games would cascade into challenges; the rows ride out the rebuild in a temp table.
CREATE TEMP TABLE `__kept_challenges` AS SELECT * FROM `challenges`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
DELETE FROM `challenges`;--> statement-breakpoint
INSERT INTO `challenges` SELECT * FROM `__kept_challenges`;--> statement-breakpoint
DROP TABLE `__kept_challenges`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `games_user_id_idx` ON `games` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `games_finish_seq_idx` ON `games` (`finish_seq`);--> statement-breakpoint
CREATE INDEX `games_bot_id_idx` ON `games` (`bot_id`);--> statement-breakpoint
CREATE INDEX `games_challenger_bot_id_idx` ON `games` (`challenger_bot_id`);--> statement-breakpoint
CREATE INDEX `games_dest_bot_id_idx` ON `games` (`dest_bot_id`);