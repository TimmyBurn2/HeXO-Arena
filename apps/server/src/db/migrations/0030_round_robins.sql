-- A table that rows point at cannot be rebuilt in place: inside the migration's transaction, where the foreign_keys
-- pragma is a no-op, dropping it cascades into every row that points at it. So while the tournaments table is rebuilt,
-- the tournament games let go of their pairings, the pairings and entries wait in tables of their own, and then all of
-- it goes back. The entries come back in a table of their own shape, keyed by the tournament's origin, and each pairing
-- is its pair's first leg. The games' checks change with their columns, which keep their values meanwhile.
CREATE TABLE `__kept_pairing_games` AS SELECT `id`, `pairing_id`, `pairing_game` FROM `games` WHERE `pairing_id` IS NOT NULL;--> statement-breakpoint
UPDATE `games` SET `pairing_id` = NULL, `pairing_game` = NULL WHERE `pairing_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__kept_pairings` AS SELECT `id`, `tournament_id`, `round`, `first_bot_id`, `second_bot_id`, `opening_cells`, `game1`, `game1_seat`, `game2`, `game2_seat` FROM `tournament_pairings`;--> statement-breakpoint
CREATE TABLE `__kept_entries` AS SELECT `tournament_id`, `bot_id`, `owner_id`, `state`, `reason`, `rating_at_start`, `entered_at` FROM `tournament_entries`;--> statement-breakpoint
DROP TABLE `tournament_entries`;--> statement-breakpoint
CREATE TABLE `__new_tournaments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`status` text NOT NULL,
	`starts_at` integer NOT NULL,
	`time_control` text NOT NULL,
	`opening_plies` integer NOT NULL,
	`max_entrants` integer NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`rule_id` integer,
	`origin` text DEFAULT 'operator' NOT NULL,
	`created_by` text,
	`rated` integer DEFAULT 1 NOT NULL,
	`test` integer DEFAULT 0 NOT NULL,
	`games_per_pair` integer DEFAULT 2 NOT NULL,
	`end_reason` text,
	FOREIGN KEY (`rule_id`) REFERENCES `tournament_rules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tournaments_status_check" CHECK("status" in ('scheduled', 'running', 'finished', 'called_off', 'canceled', 'stopped')),
	CONSTRAINT "tournaments_name_check" CHECK(("origin" = 'operator') = ("name" is not null) and ("name" is null or (length("name") between 3 and 40 and "name" not glob '*[^ -~]*'))),
	CONSTRAINT "tournaments_opening_check" CHECK("opening_plies" in (1, 3, 5, 7, 9)),
	CONSTRAINT "tournaments_max_check" CHECK("max_entrants" between 3 and 12 and ("origin" = 'operator' or "max_entrants" <= 8)),
	CONSTRAINT "tournaments_started_check" CHECK("status" = 'canceled' or ("status" in ('running', 'finished', 'stopped')) = ("started_at" is not null)),
	CONSTRAINT "tournaments_ended_check" CHECK(("status" in ('finished', 'called_off', 'canceled', 'stopped')) = ("ended_at" is not null)),
	CONSTRAINT "tournaments_origin_check" CHECK(("origin" = 'operator' and "created_by" is null and "status" <> 'stopped') or ("origin" = 'person' and "rule_id" is null and "status" not in ('scheduled', 'called_off'))),
	CONSTRAINT "tournaments_rated_check" CHECK("rated" in (0, 1) and ("origin" = 'operator') = ("rated" = 1)),
	CONSTRAINT "tournaments_test_check" CHECK("test" in (0, 1) and ("test" = 0 or "origin" = 'person')),
	CONSTRAINT "tournaments_games_per_pair_check" CHECK("games_per_pair" in (2, 4, 6, 10) and ("games_per_pair" <= 4 or "test" = 1) and ("origin" = 'person' or "games_per_pair" = 2) and ("opening_plies" > 1 or "games_per_pair" = 2)),
	CONSTRAINT "tournaments_end_check" CHECK(("status" = 'stopped') = ("end_reason" is not null) and ("end_reason" is null or "end_reason" in ('creator', 'banned', 'deleted')))
);--> statement-breakpoint
INSERT INTO `__new_tournaments`(`id`, `name`, `status`, `starts_at`, `time_control`, `opening_plies`, `max_entrants`, `created_at`, `started_at`, `ended_at`, `rule_id`) SELECT `id`, `name`, `status`, `starts_at`, `time_control`, `opening_plies`, `max_entrants`, `created_at`, `started_at`, `ended_at`, `rule_id` FROM `tournaments`;--> statement-breakpoint
DROP TABLE `tournaments`;--> statement-breakpoint
ALTER TABLE `__new_tournaments` RENAME TO `tournaments`;--> statement-breakpoint
CREATE INDEX `tournaments_status_starts_idx` ON `tournaments` (`status`,`starts_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tournaments_rule_starts_idx` ON `tournaments` (`rule_id`,`starts_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tournaments_id_origin_idx` ON `tournaments` (`id`,`origin`);--> statement-breakpoint
CREATE INDEX `tournaments_created_by_idx` ON `tournaments` (`created_by`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tournaments_running_creator_idx` ON `tournaments` (`created_by`) WHERE "tournaments"."status" = 'running';--> statement-breakpoint
INSERT INTO `tournament_pairings`(`id`, `tournament_id`, `round`, `first_bot_id`, `second_bot_id`, `opening_cells`, `game1`, `game1_seat`, `game2`, `game2_seat`) SELECT `id`, `tournament_id`, `round`, `first_bot_id`, `second_bot_id`, `opening_cells`, `game1`, `game1_seat`, `game2`, `game2_seat` FROM `__kept_pairings`;--> statement-breakpoint
ALTER TABLE `tournament_pairings` ADD `leg` integer DEFAULT 1 NOT NULL CONSTRAINT "tournament_pairings_leg_check" CHECK("leg" between 1 and 5);--> statement-breakpoint
CREATE UNIQUE INDEX `tournament_pairings_leg_idx` ON `tournament_pairings` (`tournament_id`,`first_bot_id`,`second_bot_id`,`leg`);--> statement-breakpoint
CREATE TABLE `tournament_entries` (
	`tournament_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`state` text DEFAULT 'entered' NOT NULL,
	`reason` text,
	`rating_at_start` real,
	`entered_at` integer NOT NULL,
	`origin` text DEFAULT 'operator' NOT NULL,
	`level` text,
	`version` text,
	PRIMARY KEY(`tournament_id`, `bot_id`),
	FOREIGN KEY (`tournament_id`,`origin`) REFERENCES `tournaments`(`id`,`origin`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`,`owner_id`) REFERENCES `bots`(`id`,`owner_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tournament_entries_state_check" CHECK("state" in ('entered', 'playing', 'absent', 'left_out', 'withdrawn') and ("origin" = 'operator' or "state" in ('playing', 'withdrawn'))),
	CONSTRAINT "tournament_entries_reason_check" CHECK(("state" = 'left_out' and coalesce("reason", '') in ('daily_cap', 'clock')) or ("state" = 'withdrawn' and (coalesce("reason", '') in ('missed', 'banned', 'delisted', 'deleted') or ("origin" = 'person' and coalesce("reason", '') in ('owner', 'refused', 'tournament')))) or ("state" not in ('left_out', 'withdrawn') and "reason" is null)),
	CONSTRAINT "tournament_entries_rating_check" CHECK("rating_at_start" is null or "rating_at_start" >= 400),
	CONSTRAINT "tournament_entries_level_check" CHECK(("level" is null or (json_valid("level") and substr("level", 1, 1) = '{' and length("level") <= 1024)) and ("level" is null or "origin" = 'person')),
	CONSTRAINT "tournament_entries_version_check" CHECK("version" is null or length("version") between 1 and 64)
);--> statement-breakpoint
INSERT INTO `tournament_entries`(`tournament_id`, `bot_id`, `owner_id`, `state`, `reason`, `rating_at_start`, `entered_at`) SELECT `tournament_id`, `bot_id`, `owner_id`, `state`, `reason`, `rating_at_start`, `entered_at` FROM `__kept_entries`;--> statement-breakpoint
CREATE UNIQUE INDEX `tournament_entries_owner_idx` ON `tournament_entries` (`tournament_id`,`owner_id`) WHERE "tournament_entries"."origin" = 'operator';--> statement-breakpoint
CREATE INDEX `tournament_entries_bot_idx` ON `tournament_entries` (`bot_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `tournament_entries_owner_id_idx` ON `tournament_entries` (`owner_id`);--> statement-breakpoint
UPDATE `games` SET `pairing_id` = (SELECT `kept`.`pairing_id` FROM `__kept_pairing_games` `kept` WHERE `kept`.`id` = `games`.`id`), `pairing_game` = (SELECT `kept`.`pairing_game` FROM `__kept_pairing_games` `kept` WHERE `kept`.`id` = `games`.`id`) WHERE `id` IN (SELECT `id` FROM `__kept_pairing_games`);--> statement-breakpoint
DROP TABLE `__kept_pairing_games`;--> statement-breakpoint
DROP TABLE `__kept_pairings`;--> statement-breakpoint
DROP TABLE `__kept_entries`;--> statement-breakpoint
-- A round robin a person set up plays unrated games, and its games between two bots of one owner are tests.
ALTER TABLE `games` ADD `test_kept` integer;--> statement-breakpoint
UPDATE `games` SET `test_kept` = `test`;--> statement-breakpoint
DROP INDEX `games_shown_finish_idx`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `test`;--> statement-breakpoint
ALTER TABLE `games` ADD `unrated_by_choice_kept` integer;--> statement-breakpoint
UPDATE `games` SET `unrated_by_choice_kept` = `unrated_by_choice`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `unrated_by_choice`;--> statement-breakpoint
ALTER TABLE `games` ADD `unrated_by_choice` integer DEFAULT 0 NOT NULL CONSTRAINT "games_unrated_by_choice_check" CHECK("unrated_by_choice" in (0, 1) and ("unrated_by_choice" = 0 or "duel_id" is not null or "pairing_id" is not null or ("x_level" is null and "o_level" is null and ("user_id" is not null or "challenger_bot_id" is not null))));--> statement-breakpoint
UPDATE `games` SET `unrated_by_choice` = `unrated_by_choice_kept`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `unrated_by_choice_kept`;--> statement-breakpoint
ALTER TABLE `games` ADD `test` integer DEFAULT 0 NOT NULL CONSTRAINT "games_test_check" CHECK("test" in (0, 1) and ("test" = 0 or ("guest_name" is null and ("unrated_by_choice" = 1 or "x_level" is not null or "o_level" is not null))));--> statement-breakpoint
UPDATE `games` SET `test` = `test_kept`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `test_kept`;--> statement-breakpoint
CREATE INDEX `games_shown_finish_idx` ON `games` (`finish_seq`) WHERE "games"."test" = 0;
