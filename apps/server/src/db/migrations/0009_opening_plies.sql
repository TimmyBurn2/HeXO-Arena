PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`challenger_bot_id` text NOT NULL,
	`dest_bot_id` text NOT NULL,
	`request_key` text NOT NULL,
	`time_control` text NOT NULL,
	`opening_plies` integer NOT NULL,
	`first_player` text NOT NULL,
	`status` text NOT NULL,
	`game_id` text,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`challenger_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dest_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "challenges_status_check" CHECK("__new_challenges"."status" in ('created', 'accepted', 'declined', 'canceled', 'expired')),
	CONSTRAINT "challenges_first_player_check" CHECK("__new_challenges"."first_player" in ('challenger', 'challenged', 'random')),
	CONSTRAINT "challenges_opening_check" CHECK("__new_challenges"."opening_plies" in (1, 3, 5, 7, 9)),
	CONSTRAINT "challenges_pair_check" CHECK("__new_challenges"."challenger_bot_id" <> "__new_challenges"."dest_bot_id"),
	CONSTRAINT "challenges_decided_check" CHECK(("__new_challenges"."status" = 'created') = ("__new_challenges"."decided_at" is null)),
	CONSTRAINT "challenges_game_check" CHECK(("__new_challenges"."status" = 'accepted') = ("__new_challenges"."game_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_challenges`("id", "challenger_bot_id", "dest_bot_id", "request_key", "time_control", "opening_plies", "first_player", "status", "game_id", "created_at", "decided_at") SELECT "id", "challenger_bot_id", "dest_bot_id", "request_key", "time_control", "opening_turns" * 2 + 1, "first_player", "status", "game_id", "created_at", "decided_at" FROM `challenges`;--> statement-breakpoint
DROP TABLE `challenges`;--> statement-breakpoint
ALTER TABLE `__new_challenges` RENAME TO `challenges`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `challenges_challenger_request_idx` ON `challenges` (`challenger_bot_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `challenges_challenger_bot_id_idx` ON `challenges` (`challenger_bot_id`);--> statement-breakpoint
CREATE INDEX `challenges_dest_bot_id_idx` ON `challenges` (`dest_bot_id`);--> statement-breakpoint
CREATE INDEX `challenges_game_id_idx` ON `challenges` (`game_id`);