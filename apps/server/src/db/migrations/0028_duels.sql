-- The duels table takes the series' rows under new ids. The series table and the games columns that point at it
-- cannot be rebuilt in place: inside the migration's transaction, where the foreign_keys pragma is a no-op, dropping a
-- table cascades into every row that points at it. So the games move to new duel columns first, and only then do the
-- old columns and the series table go. A series between two bots of one owner becomes a test; no version was kept.
CREATE TABLE `duels` (
	`id` text PRIMARY KEY NOT NULL,
	`started_by` text,
	`bot_a_id` text NOT NULL,
	`bot_b_id` text NOT NULL,
	`a_first` integer NOT NULL,
	`a_x` integer NOT NULL,
	`test` integer NOT NULL,
	`games` integer NOT NULL,
	`time_control` text NOT NULL,
	`opening_plies` integer NOT NULL,
	`a_level` text,
	`b_level` text,
	`a_rating` real NOT NULL,
	`b_rating` real NOT NULL,
	`a_version` text,
	`b_version` text,
	`rated` integer NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`end_reason` text,
	`end_bot` text,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bot_a_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_b_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "duels_pair_check" CHECK("duels"."bot_a_id" < "duels"."bot_b_id"),
	CONSTRAINT "duels_a_first_check" CHECK("duels"."a_first" in (0, 1)),
	CONSTRAINT "duels_a_x_check" CHECK("duels"."a_x" in (0, 1)),
	CONSTRAINT "duels_test_check" CHECK("duels"."test" in (0, 1)),
	CONSTRAINT "duels_games_check" CHECK("duels"."games" in (1, 2, 4, 6, 8, 10, 20, 30, 50) and ("duels"."test" = 1 or "duels"."games" in (1, 2, 4, 6, 8, 10))),
	CONSTRAINT "duels_time_control_check" CHECK(json_valid("duels"."time_control")),
	CONSTRAINT "duels_opening_check" CHECK("duels"."opening_plies" in (1, 3, 5, 7, 9) and ("duels"."opening_plies" > 1 or "duels"."games" <= 2)),
	CONSTRAINT "duels_a_level_check" CHECK("duels"."a_level" is null or (json_valid("duels"."a_level") and substr("duels"."a_level", 1, 1) = '{' and length("duels"."a_level") <= 1024)),
	CONSTRAINT "duels_b_level_check" CHECK("duels"."b_level" is null or (json_valid("duels"."b_level") and substr("duels"."b_level", 1, 1) = '{' and length("duels"."b_level") <= 1024)),
	CONSTRAINT "duels_rating_check" CHECK("duels"."a_rating" >= 400 and "duels"."b_rating" >= 400),
	CONSTRAINT "duels_version_check" CHECK(("duels"."a_version" is null or length("duels"."a_version") between 1 and 64) and ("duels"."b_version" is null or length("duels"."b_version") between 1 and 64)),
	CONSTRAINT "duels_rated_check" CHECK("duels"."rated" in (0, 1) and ("duels"."rated" = 0 or ("duels"."test" = 0 and "duels"."a_level" is null and "duels"."b_level" is null))),
	CONSTRAINT "duels_status_check" CHECK("duels"."status" in ('running', 'finished', 'cut_short', 'stopped')),
	CONSTRAINT "duels_end_check" CHECK(("duels"."status" = 'cut_short' and coalesce("duels"."end_reason", '') in ('offline', 'closed', 'clock', 'busy', 'refused', 'tournament', 'banned', 'delisted', 'deleted', 'daily_cap', 'aborted')) or ("duels"."status" = 'stopped' and coalesce("duels"."end_reason", '') in ('starter', 'owner', 'operator')) or ("duels"."status" in ('running', 'finished') and "duels"."end_reason" is null)),
	CONSTRAINT "duels_end_bot_check" CHECK("duels"."end_bot" is null or ("duels"."end_bot" in ('a', 'b') and "duels"."status" in ('cut_short', 'stopped'))),
	CONSTRAINT "duels_ended_check" CHECK(("duels"."status" = 'running') = ("duels"."ended_at" is null))
);
--> statement-breakpoint
INSERT INTO `duels`(`id`, `started_by`, `bot_a_id`, `bot_b_id`, `a_first`, `a_x`, `test`, `games`, `time_control`, `opening_plies`, `a_level`, `b_level`, `a_rating`, `b_rating`, `a_version`, `b_version`, `rated`, `status`, `end_reason`, `end_bot`, `created_at`, `ended_at`) SELECT 'd_' || substr(`id`, 3), `started_by`, `bot_a_id`, `bot_b_id`, `a_first`, `a_x`, (SELECT `a`.`owner_id` = `b`.`owner_id` FROM `bots` `a`, `bots` `b` WHERE `a`.`id` = `series`.`bot_a_id` AND `b`.`id` = `series`.`bot_b_id`), `games`, `time_control`, `opening_plies`, `a_level`, `b_level`, `a_rating`, `b_rating`, NULL, NULL, `rated`, `status`, `end_reason`, `end_bot`, `created_at`, `ended_at` FROM `series`;--> statement-breakpoint
ALTER TABLE `games` ADD `duel_id` text REFERENCES `duels`(`id`) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `games` ADD `duel_game` integer CONSTRAINT "games_duel_check" CHECK(("duel_id" is null and "duel_game" is null) or ("duel_id" is not null and coalesce("duel_game", 0) between 1 and 50 and "challenger_bot_id" is not null and "pairing_id" is null));--> statement-breakpoint
UPDATE `games` SET `duel_id` = 'd_' || substr(`series_id`, 3), `duel_game` = `series_game` WHERE `series_id` IS NOT NULL;--> statement-breakpoint
-- A column's own check changes only with the column, so unrated_by_choice keeps its values in a column of its own
-- while it is dropped and added again with the check that names the duel column.
ALTER TABLE `games` ADD `unrated_by_choice_kept` integer;--> statement-breakpoint
UPDATE `games` SET `unrated_by_choice_kept` = `unrated_by_choice`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `unrated_by_choice`;--> statement-breakpoint
ALTER TABLE `games` ADD `unrated_by_choice` integer DEFAULT 0 NOT NULL CONSTRAINT "games_unrated_by_choice_check" CHECK("unrated_by_choice" in (0, 1) and ("unrated_by_choice" = 0 or "duel_id" is not null or ("x_level" is null and "o_level" is null and ("user_id" is not null or ("challenger_bot_id" is not null and "pairing_id" is null)))));--> statement-breakpoint
UPDATE `games` SET `unrated_by_choice` = `unrated_by_choice_kept`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `unrated_by_choice_kept`;--> statement-breakpoint
-- A game one person holds on both sides is a test; one such game played rated before tests existed stays as rated.
ALTER TABLE `games` ADD `test` integer DEFAULT 0 NOT NULL CONSTRAINT "games_test_check" CHECK("test" in (0, 1) and ("test" = 0 or ("guest_name" is null and "pairing_id" is null and ("unrated_by_choice" = 1 or "x_level" is not null or "o_level" is not null))));--> statement-breakpoint
UPDATE `games` SET `test` = 1 WHERE `guest_name` IS NULL AND `pairing_id` IS NULL AND (`unrated_by_choice` = 1 OR `x_level` IS NOT NULL OR `o_level` IS NOT NULL) AND ((`user_id` IS NOT NULL AND `user_id` = (SELECT `owner_id` FROM `bots` WHERE `bots`.`id` = `games`.`bot_id`)) OR (`challenger_bot_id` IS NOT NULL AND (SELECT `owner_id` FROM `bots` WHERE `bots`.`id` = `games`.`challenger_bot_id`) = (SELECT `owner_id` FROM `bots` WHERE `bots`.`id` = `games`.`dest_bot_id`)));--> statement-breakpoint
CREATE INDEX `games_shown_finish_idx` ON `games` (`finish_seq`) WHERE "games"."test" = 0;--> statement-breakpoint
DROP INDEX `games_series_idx`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `series_game`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `series_id`;--> statement-breakpoint
CREATE INDEX `games_duel_idx` ON `games` (`duel_id`,`duel_game`);--> statement-breakpoint
DROP TABLE `series`;--> statement-breakpoint
CREATE UNIQUE INDEX `duels_live_pair_idx` ON `duels` (`bot_a_id`,`bot_b_id`) WHERE "duels"."status" = 'running';--> statement-breakpoint
CREATE INDEX `duels_started_by_created_idx` ON `duels` (`started_by`,`created_at`);--> statement-breakpoint
CREATE INDEX `duels_bot_a_idx` ON `duels` (`bot_a_id`);--> statement-breakpoint
CREATE INDEX `duels_bot_b_idx` ON `duels` (`bot_b_id`);--> statement-breakpoint
ALTER TABLE `bots` ADD `duels_by_others` integer DEFAULT 1 NOT NULL CONSTRAINT "bots_duels_by_others_check" CHECK("duels_by_others" in (0, 1));--> statement-breakpoint
UPDATE `bots` SET `duels_by_others` = `series_by_others`;--> statement-breakpoint
ALTER TABLE `bots` DROP COLUMN `series_by_others`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_admin_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`reason` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT "admin_actions_action_check" CHECK("__new_admin_actions"."action" in ('pause', 'resume', 'ban-user', 'unban-user', 'delete-user', 'delist-bot', 'relist-bot', 'revoke-bot', 'abort-game', 'recompute-ratings', 'tournament-create', 'tournament-cancel', 'tournament-schedule-add', 'tournament-schedule-remove', 'report-close', 'delete-analysis', 'duel-stop')),
	CONSTRAINT "admin_actions_reason_check" CHECK(length("__new_admin_actions"."reason") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_admin_actions`("id", "actor", "action", "target", "reason", "at") SELECT "id", "actor", (CASE "action" WHEN 'series-stop' THEN 'duel-stop' ELSE "action" END), (CASE WHEN "action" = 'series-stop' AND "target" IS NOT NULL THEN 'd_' || substr("target", 3) ELSE "target" END), "reason", "at" FROM `admin_actions`;--> statement-breakpoint
DROP TABLE `admin_actions`;--> statement-breakpoint
ALTER TABLE `__new_admin_actions` RENAME TO `admin_actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
