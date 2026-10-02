CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`challenger_bot_id` text NOT NULL,
	`dest_bot_id` text NOT NULL,
	`request_key` text NOT NULL,
	`time_control` text NOT NULL,
	`opening_stones` integer NOT NULL,
	`first_player` text NOT NULL,
	`status` text NOT NULL,
	`game_id` text,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`challenger_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dest_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "challenges_status_check" CHECK("challenges"."status" in ('created', 'accepted', 'declined', 'canceled', 'expired')),
	CONSTRAINT "challenges_first_player_check" CHECK("challenges"."first_player" in ('challenger', 'challenged', 'random')),
	CONSTRAINT "challenges_opening_check" CHECK("challenges"."opening_stones" >= 0 and "challenges"."opening_stones" <= 6 and "challenges"."opening_stones" % 2 = 0),
	CONSTRAINT "challenges_pair_check" CHECK("challenges"."challenger_bot_id" <> "challenges"."dest_bot_id"),
	CONSTRAINT "challenges_decided_check" CHECK(("challenges"."status" = 'created') = ("challenges"."decided_at" is null)),
	CONSTRAINT "challenges_game_check" CHECK(("challenges"."status" = 'accepted') = ("challenges"."game_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `challenges_challenger_request_idx` ON `challenges` (`challenger_bot_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `challenges_challenger_bot_id_idx` ON `challenges` (`challenger_bot_id`);--> statement-breakpoint
CREATE INDEX `challenges_dest_bot_id_idx` ON `challenges` (`dest_bot_id`);--> statement-breakpoint
CREATE INDEX `challenges_game_id_idx` ON `challenges` (`game_id`);--> statement-breakpoint
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
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`challenger_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dest_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "games_user_side_check" CHECK("__new_games"."user_side" is null or "__new_games"."user_side" in ('x', 'o')),
	CONSTRAINT "games_challenger_side_check" CHECK("__new_games"."challenger_side" is null or "__new_games"."challenger_side" in ('x', 'o')),
	CONSTRAINT "games_winner_check" CHECK("__new_games"."winner" is null or "__new_games"."winner" in ('x', 'o')),
	CONSTRAINT "games_finish_reason_check" CHECK("__new_games"."finish_reason" is null or "__new_games"."finish_reason" in ('aborted', 'disconnect', 'surrender', 'timeout', 'terminated', 'six-in-a-row')),
	CONSTRAINT "games_finish_pair_check" CHECK(("__new_games"."finished_at" is null) = ("__new_games"."finish_reason" is null)),
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
INSERT INTO `__new_games`("id", "user_id", "bot_id", "user_side", "challenger_bot_id", "dest_bot_id", "challenger_side", "time_control", "opening_cells", "winner", "finish_reason", "created_at", "finished_at") SELECT "id", "user_id", "bot_id", "user_side", null, null, null, "time_control", "opening_cells", "winner", "finish_reason", "created_at", "finished_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `games_user_id_idx` ON `games` (`user_id`);--> statement-breakpoint
CREATE INDEX `games_bot_id_idx` ON `games` (`bot_id`);--> statement-breakpoint
CREATE INDEX `games_challenger_bot_id_idx` ON `games` (`challenger_bot_id`);--> statement-breakpoint
CREATE INDEX `games_dest_bot_id_idx` ON `games` (`dest_bot_id`);