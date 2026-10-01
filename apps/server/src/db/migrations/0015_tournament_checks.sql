PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP INDEX `games_pairing_idx`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `pairing_game`;--> statement-breakpoint
ALTER TABLE `games` ADD `pairing_game` integer CONSTRAINT "games_pairing_check" CHECK(("games"."pairing_id" is null and "games"."pairing_game" is null) or ("games"."pairing_id" is not null and coalesce("games"."pairing_game", 0) in (1, 2) and "games"."challenger_bot_id" is not null));--> statement-breakpoint
CREATE INDEX `games_pairing_idx` ON `games` (`pairing_id`,`pairing_game`);--> statement-breakpoint
CREATE TABLE `__new_tournament_entries` (
	`tournament_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`state` text DEFAULT 'entered' NOT NULL,
	`reason` text,
	`rating_at_start` real,
	`entered_at` integer NOT NULL,
	PRIMARY KEY(`tournament_id`, `bot_id`),
	FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`,`owner_id`) REFERENCES `bots`(`id`,`owner_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tournament_entries_state_check" CHECK("__new_tournament_entries"."state" in ('entered', 'playing', 'absent', 'left_out', 'withdrawn')),
	CONSTRAINT "tournament_entries_reason_check" CHECK(("__new_tournament_entries"."state" = 'left_out' and coalesce("__new_tournament_entries"."reason", '') in ('daily_cap', 'clock')) or ("__new_tournament_entries"."state" = 'withdrawn' and coalesce("__new_tournament_entries"."reason", '') in ('missed', 'banned', 'delisted', 'deleted')) or ("__new_tournament_entries"."state" not in ('left_out', 'withdrawn') and "__new_tournament_entries"."reason" is null)),
	CONSTRAINT "tournament_entries_rating_check" CHECK("__new_tournament_entries"."rating_at_start" is null or "__new_tournament_entries"."rating_at_start" >= 400)
);
--> statement-breakpoint
INSERT INTO `__new_tournament_entries`("tournament_id", "bot_id", "owner_id", "state", "reason", "rating_at_start", "entered_at") SELECT "tournament_id", "bot_id", "owner_id", "state", "reason", "rating_at_start", "entered_at" FROM `tournament_entries`;--> statement-breakpoint
DROP TABLE `tournament_entries`;--> statement-breakpoint
ALTER TABLE `__new_tournament_entries` RENAME TO `tournament_entries`;--> statement-breakpoint
CREATE UNIQUE INDEX `tournament_entries_owner_idx` ON `tournament_entries` (`tournament_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `tournament_entries_bot_idx` ON `tournament_entries` (`bot_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `tournament_entries_owner_id_idx` ON `tournament_entries` (`owner_id`);--> statement-breakpoint
CREATE TABLE `__new_tournament_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`round` integer NOT NULL,
	`first_bot_id` text NOT NULL,
	`second_bot_id` text NOT NULL,
	`opening_cells` text,
	`game1` text DEFAULT 'pending' NOT NULL,
	`game1_seat` text,
	`game2` text DEFAULT 'pending' NOT NULL,
	`game2_seat` text,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`first_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`second_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tournament_pairings_round_check" CHECK("__new_tournament_pairings"."round" >= 1),
	CONSTRAINT "tournament_pairings_pair_check" CHECK("__new_tournament_pairings"."first_bot_id" <> "__new_tournament_pairings"."second_bot_id"),
	CONSTRAINT "tournament_pairings_game1_check" CHECK(("__new_tournament_pairings"."game1" in ('pending', 'live', 'not_played', 'aborted') and "__new_tournament_pairings"."game1_seat" is null) or ("__new_tournament_pairings"."game1" = 'played' and ("__new_tournament_pairings"."game1_seat" is null or "__new_tournament_pairings"."game1_seat" in ('first', 'second'))) or ("__new_tournament_pairings"."game1" in ('no_show', 'forfeit') and coalesce("__new_tournament_pairings"."game1_seat", '') in ('first', 'second', 'both'))),
	CONSTRAINT "tournament_pairings_game2_check" CHECK(("__new_tournament_pairings"."game2" in ('pending', 'live', 'not_played', 'aborted') and "__new_tournament_pairings"."game2_seat" is null) or ("__new_tournament_pairings"."game2" = 'played' and ("__new_tournament_pairings"."game2_seat" is null or "__new_tournament_pairings"."game2_seat" in ('first', 'second'))) or ("__new_tournament_pairings"."game2" in ('no_show', 'forfeit') and coalesce("__new_tournament_pairings"."game2_seat", '') in ('first', 'second', 'both'))),
	CONSTRAINT "tournament_pairings_order_check" CHECK("__new_tournament_pairings"."game2" = 'pending' or "__new_tournament_pairings"."game1" not in ('pending', 'live'))
);
--> statement-breakpoint
INSERT INTO `__new_tournament_pairings`("id", "tournament_id", "round", "first_bot_id", "second_bot_id", "opening_cells", "game1", "game1_seat", "game2", "game2_seat") SELECT "id", "tournament_id", "round", "first_bot_id", "second_bot_id", "opening_cells", "game1", "game1_seat", "game2", "game2_seat" FROM `tournament_pairings`;--> statement-breakpoint
DROP TABLE `tournament_pairings`;--> statement-breakpoint
ALTER TABLE `__new_tournament_pairings` RENAME TO `tournament_pairings`;--> statement-breakpoint
CREATE INDEX `tournament_pairings_round_idx` ON `tournament_pairings` (`tournament_id`,`round`);--> statement-breakpoint
CREATE INDEX `tournament_pairings_first_idx` ON `tournament_pairings` (`first_bot_id`);--> statement-breakpoint
CREATE INDEX `tournament_pairings_second_idx` ON `tournament_pairings` (`second_bot_id`);