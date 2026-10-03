-- The bots and games columns are added in place: rebuilding either table inside the migration's
-- transaction, where the foreign_keys pragma is a no-op, would cascade into every row that points at it.
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`started_by` text,
	`bot_a_id` text NOT NULL,
	`bot_b_id` text NOT NULL,
	`a_first` integer NOT NULL,
	`a_x` integer NOT NULL,
	`games` integer NOT NULL,
	`time_control` text NOT NULL,
	`opening_plies` integer NOT NULL,
	`a_level` text,
	`b_level` text,
	`a_rating` real NOT NULL,
	`b_rating` real NOT NULL,
	`rated` integer NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`end_reason` text,
	`end_bot` text,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bot_a_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_b_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "series_pair_check" CHECK("series"."bot_a_id" < "series"."bot_b_id"),
	CONSTRAINT "series_a_first_check" CHECK("series"."a_first" in (0, 1)),
	CONSTRAINT "series_a_x_check" CHECK("series"."a_x" in (0, 1)),
	CONSTRAINT "series_games_check" CHECK("series"."games" in (1, 2, 4, 6, 8, 10)),
	CONSTRAINT "series_time_control_check" CHECK(json_valid("series"."time_control")),
	CONSTRAINT "series_opening_check" CHECK("series"."opening_plies" in (1, 3, 5, 7, 9) and ("series"."opening_plies" > 1 or "series"."games" <= 2)),
	CONSTRAINT "series_a_level_check" CHECK("series"."a_level" is null or (json_valid("series"."a_level") and substr("series"."a_level", 1, 1) = '{' and length("series"."a_level") <= 1024)),
	CONSTRAINT "series_b_level_check" CHECK("series"."b_level" is null or (json_valid("series"."b_level") and substr("series"."b_level", 1, 1) = '{' and length("series"."b_level") <= 1024)),
	CONSTRAINT "series_rating_check" CHECK("series"."a_rating" >= 400 and "series"."b_rating" >= 400),
	CONSTRAINT "series_rated_check" CHECK("series"."rated" in (0, 1) and ("series"."rated" = 0 or ("series"."a_level" is null and "series"."b_level" is null))),
	CONSTRAINT "series_status_check" CHECK("series"."status" in ('running', 'finished', 'cut_short', 'stopped')),
	CONSTRAINT "series_end_check" CHECK(("series"."status" = 'cut_short' and coalesce("series"."end_reason", '') in ('offline', 'closed', 'clock', 'busy', 'refused', 'tournament', 'banned', 'delisted', 'deleted', 'daily_cap', 'aborted')) or ("series"."status" = 'stopped' and coalesce("series"."end_reason", '') in ('starter', 'owner', 'operator')) or ("series"."status" in ('running', 'finished') and "series"."end_reason" is null)),
	CONSTRAINT "series_end_bot_check" CHECK("series"."end_bot" is null or ("series"."end_bot" in ('a', 'b') and "series"."status" in ('cut_short', 'stopped'))),
	CONSTRAINT "series_ended_check" CHECK(("series"."status" = 'running') = ("series"."ended_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_live_pair_idx` ON `series` (`bot_a_id`,`bot_b_id`) WHERE "series"."status" = 'running';--> statement-breakpoint
CREATE INDEX `series_started_by_created_idx` ON `series` (`started_by`,`created_at`);--> statement-breakpoint
CREATE INDEX `series_bot_a_idx` ON `series` (`bot_a_id`);--> statement-breakpoint
CREATE INDEX `series_bot_b_idx` ON `series` (`bot_b_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_admin_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`reason` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT "admin_actions_action_check" CHECK("__new_admin_actions"."action" in ('pause', 'resume', 'ban-user', 'unban-user', 'delete-user', 'delist-bot', 'relist-bot', 'revoke-bot', 'abort-game', 'recompute-ratings', 'tournament-create', 'tournament-cancel', 'tournament-schedule-add', 'tournament-schedule-remove', 'report-close', 'delete-analysis', 'series-stop')),
	CONSTRAINT "admin_actions_reason_check" CHECK(length("__new_admin_actions"."reason") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_admin_actions`("id", "actor", "action", "target", "reason", "at") SELECT "id", "actor", "action", "target", "reason", "at" FROM `admin_actions`;--> statement-breakpoint
DROP TABLE `admin_actions`;--> statement-breakpoint
ALTER TABLE `__new_admin_actions` RENAME TO `admin_actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `bots` ADD `series_by_others` integer DEFAULT 1 NOT NULL CONSTRAINT "bots_series_by_others_check" CHECK("series_by_others" in (0, 1));--> statement-breakpoint
ALTER TABLE `games` ADD `series_id` text REFERENCES `series`(`id`) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `games` ADD `series_game` integer CONSTRAINT "games_series_check" CHECK(("series_id" is null and "series_game" is null) or ("series_id" is not null and coalesce("series_game", 0) between 1 and 10 and "challenger_bot_id" is not null and "pairing_id" is null));--> statement-breakpoint
CREATE INDEX `games_series_idx` ON `games` (`series_id`,`series_game`);--> statement-breakpoint
-- A column's own check changes only with the column, so unrated_by_choice keeps its values in a column of
-- its own while it is dropped and added again with the check that admits series games.
ALTER TABLE `games` ADD `unrated_by_choice_kept` integer;--> statement-breakpoint
UPDATE `games` SET `unrated_by_choice_kept` = `unrated_by_choice`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `unrated_by_choice`;--> statement-breakpoint
ALTER TABLE `games` ADD `unrated_by_choice` integer DEFAULT 0 NOT NULL CONSTRAINT "games_unrated_by_choice_check" CHECK("unrated_by_choice" in (0, 1) and ("unrated_by_choice" = 0 or "series_id" is not null or ("user_id" is not null and "x_level" is null and "o_level" is null)));--> statement-breakpoint
UPDATE `games` SET `unrated_by_choice` = `unrated_by_choice_kept`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `unrated_by_choice_kept`;
