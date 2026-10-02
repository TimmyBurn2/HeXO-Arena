CREATE TABLE `tournament_entries` (
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
	CONSTRAINT "tournament_entries_state_check" CHECK("tournament_entries"."state" in ('entered', 'playing', 'absent', 'left_out', 'withdrawn')),
	CONSTRAINT "tournament_entries_reason_check" CHECK(("tournament_entries"."state" = 'left_out' and "tournament_entries"."reason" in ('daily_cap', 'clock')) or ("tournament_entries"."state" = 'withdrawn' and "tournament_entries"."reason" in ('missed', 'banned', 'delisted', 'deleted')) or ("tournament_entries"."state" not in ('left_out', 'withdrawn') and "tournament_entries"."reason" is null)),
	CONSTRAINT "tournament_entries_rating_check" CHECK("tournament_entries"."rating_at_start" is null or "tournament_entries"."rating_at_start" >= 400)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tournament_entries_owner_idx` ON `tournament_entries` (`tournament_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `tournament_entries_bot_idx` ON `tournament_entries` (`bot_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `tournament_entries_owner_id_idx` ON `tournament_entries` (`owner_id`);--> statement-breakpoint
CREATE TABLE `tournament_pairings` (
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
	CONSTRAINT "tournament_pairings_round_check" CHECK("tournament_pairings"."round" >= 1),
	CONSTRAINT "tournament_pairings_pair_check" CHECK("tournament_pairings"."first_bot_id" <> "tournament_pairings"."second_bot_id"),
	CONSTRAINT "tournament_pairings_game1_check" CHECK(("tournament_pairings"."game1" in ('pending', 'live', 'not_played', 'aborted') and "tournament_pairings"."game1_seat" is null) or ("tournament_pairings"."game1" = 'played' and ("tournament_pairings"."game1_seat" is null or "tournament_pairings"."game1_seat" in ('first', 'second'))) or ("tournament_pairings"."game1" in ('no_show', 'forfeit') and "tournament_pairings"."game1_seat" in ('first', 'second', 'both'))),
	CONSTRAINT "tournament_pairings_game2_check" CHECK(("tournament_pairings"."game2" in ('pending', 'live', 'not_played', 'aborted') and "tournament_pairings"."game2_seat" is null) or ("tournament_pairings"."game2" = 'played' and ("tournament_pairings"."game2_seat" is null or "tournament_pairings"."game2_seat" in ('first', 'second'))) or ("tournament_pairings"."game2" in ('no_show', 'forfeit') and "tournament_pairings"."game2_seat" in ('first', 'second', 'both'))),
	CONSTRAINT "tournament_pairings_order_check" CHECK("tournament_pairings"."game2" = 'pending' or "tournament_pairings"."game1" not in ('pending', 'live'))
);
--> statement-breakpoint
CREATE INDEX `tournament_pairings_round_idx` ON `tournament_pairings` (`tournament_id`,`round`);--> statement-breakpoint
CREATE INDEX `tournament_pairings_first_idx` ON `tournament_pairings` (`first_bot_id`);--> statement-breakpoint
CREATE INDEX `tournament_pairings_second_idx` ON `tournament_pairings` (`second_bot_id`);--> statement-breakpoint
CREATE TABLE `tournaments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`starts_at` integer NOT NULL,
	`time_control` text NOT NULL,
	`opening_plies` integer NOT NULL,
	`max_entrants` integer NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	CONSTRAINT "tournaments_status_check" CHECK("tournaments"."status" in ('scheduled', 'running', 'finished', 'called_off', 'canceled')),
	CONSTRAINT "tournaments_name_check" CHECK(length("tournaments"."name") between 3 and 40 and "tournaments"."name" not glob '*[^ -~]*'),
	CONSTRAINT "tournaments_opening_check" CHECK("tournaments"."opening_plies" in (1, 3, 5, 7, 9)),
	CONSTRAINT "tournaments_max_check" CHECK("tournaments"."max_entrants" between 3 and 12),
	CONSTRAINT "tournaments_started_check" CHECK("tournaments"."status" = 'canceled' or ("tournaments"."status" in ('running', 'finished')) = ("tournaments"."started_at" is not null)),
	CONSTRAINT "tournaments_ended_check" CHECK(("tournaments"."status" in ('finished', 'called_off', 'canceled')) = ("tournaments"."ended_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `tournaments_status_starts_idx` ON `tournaments` (`status`,`starts_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_admin_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`reason` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT "admin_actions_action_check" CHECK("__new_admin_actions"."action" in ('pause', 'resume', 'ban-user', 'unban-user', 'delete-user', 'delist-bot', 'relist-bot', 'revoke-bot', 'abort-game', 'recompute-ratings', 'tournament-create', 'tournament-cancel')),
	CONSTRAINT "admin_actions_reason_check" CHECK(length("__new_admin_actions"."reason") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_admin_actions`("id", "actor", "action", "target", "reason", "at") SELECT "id", "actor", "action", "target", "reason", "at" FROM `admin_actions`;--> statement-breakpoint
DROP TABLE `admin_actions`;--> statement-breakpoint
ALTER TABLE `__new_admin_actions` RENAME TO `admin_actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `games` ADD `pairing_id` text REFERENCES `tournament_pairings`(`id`) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `games` ADD `pairing_game` integer CONSTRAINT "games_pairing_check" CHECK(("games"."pairing_id" is null and "games"."pairing_game" is null) or ("games"."pairing_id" is not null and "games"."pairing_game" in (1, 2) and "games"."challenger_bot_id" is not null));--> statement-breakpoint
CREATE INDEX `games_pairing_idx` ON `games` (`pairing_id`,`pairing_game`);--> statement-breakpoint
CREATE UNIQUE INDEX `bots_id_owner_idx` ON `bots` (`id`,`owner_id`);