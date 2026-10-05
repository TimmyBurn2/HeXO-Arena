-- A table that rows point at cannot be rebuilt in place: inside the migration's transaction, where the foreign_keys
-- pragma is a no-op, dropping it cascades into every row that points at it. So while the tournaments table is rebuilt,
-- the tournament games let go of their pairings, keeping their levels beside them, and the pairings and entries wait in
-- tables of their own; then all of it goes back.
CREATE TABLE `__kept_pairing_games` AS SELECT `id`, `pairing_id`, `pairing_game`, `x_level`, `o_level` FROM `games` WHERE `pairing_id` IS NOT NULL;--> statement-breakpoint
UPDATE `games` SET `pairing_id` = NULL, `pairing_game` = NULL, `x_level` = NULL, `o_level` = NULL WHERE `pairing_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__kept_pairings` AS SELECT `id`, `tournament_id`, `round`, `first_bot_id`, `second_bot_id`, `opening_cells`, `game1`, `game1_seat`, `game2`, `game2_seat`, `leg`, `games_per_pair` FROM `tournament_pairings`;--> statement-breakpoint
CREATE TABLE `__kept_entries` AS SELECT `tournament_id`, `bot_id`, `owner_id`, `state`, `reason`, `rating_at_start`, `entered_at`, `origin`, `level`, `version`, `seat` FROM `tournament_entries`;--> statement-breakpoint
DROP TABLE `tournament_entries`;--> statement-breakpoint
DROP TABLE `tournament_pairings`;--> statement-breakpoint
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
	`end_bot_id` text,
	`live_slot` integer,
	FOREIGN KEY (`rule_id`) REFERENCES `tournament_rules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`end_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tournaments_status_check" CHECK("status" in ('scheduled', 'running', 'finished', 'called_off', 'canceled', 'stopped', 'cut_short')),
	CONSTRAINT "tournaments_name_check" CHECK(("origin" = 'operator') = ("name" is not null) and ("name" is null or (length("name") between 3 and 40 and "name" not glob '*[^ -~]*'))),
	CONSTRAINT "tournaments_opening_check" CHECK("opening_plies" in (1, 3, 5, 7, 9)),
	CONSTRAINT "tournaments_max_check" CHECK("max_entrants" between 2 and 12 and (("origin" = 'operator' and "max_entrants" >= 3) or ("origin" = 'person' and "max_entrants" <= 8))),
	CONSTRAINT "tournaments_started_check" CHECK("status" = 'canceled' or ("status" in ('running', 'finished', 'stopped', 'cut_short')) = ("started_at" is not null)),
	CONSTRAINT "tournaments_ended_check" CHECK(("status" in ('finished', 'called_off', 'canceled', 'stopped', 'cut_short')) = ("ended_at" is not null)),
	CONSTRAINT "tournaments_origin_check" CHECK(("origin" = 'operator' and "created_by" is null and "status" not in ('stopped', 'cut_short')) or ("origin" = 'person' and "rule_id" is null and "status" not in ('scheduled', 'called_off'))),
	CONSTRAINT "tournaments_rated_check" CHECK("rated" in (0, 1) and (("origin" = 'operator' and "rated" = 1) or ("origin" = 'person' and ("rated" = 0 or ("max_entrants" = 2 and "status" in ('finished', 'stopped', 'cut_short')))))),
	CONSTRAINT "tournaments_test_check" CHECK("test" in (0, 1) and ("test" = 0 or "origin" = 'person')),
	CONSTRAINT "tournaments_games_per_pair_check" CHECK("games_per_pair" in (1, 2, 4, 6, 8, 10, 20, 30, 50) and ("games_per_pair" <= 10 or "test" = 1) and ("origin" = 'person' or "games_per_pair" = 2) and ("opening_plies" > 1 or "games_per_pair" <= 2) and ("max_entrants" - 1) * "games_per_pair" <= (case "test" when 1 then 70 else 30 end)),
	CONSTRAINT "tournaments_end_check" CHECK(("status" in ('stopped', 'cut_short')) = ("end_reason" is not null) and ("status" <> 'stopped' or "end_reason" in ('creator', 'operator', 'banned', 'deleted')) and ("status" <> 'cut_short' or "end_reason" in ('owner', 'missed', 'refused', 'tournament', 'banned', 'delisted', 'deleted') or ("max_entrants" = 2 and "end_reason" in ('offline', 'closed', 'clock', 'busy', 'daily_cap', 'aborted')))),
	CONSTRAINT "tournaments_end_bot_check" CHECK("end_bot_id" is null or "status" = 'cut_short'),
	CONSTRAINT "tournaments_live_slot_check" CHECK(("origin" = 'operator') = ("live_slot" is null) and ("live_slot" is null or "live_slot" between 1 and 2))
);--> statement-breakpoint
INSERT INTO `__new_tournaments`(`id`, `name`, `status`, `starts_at`, `time_control`, `opening_plies`, `max_entrants`, `created_at`, `started_at`, `ended_at`, `rule_id`, `origin`, `created_by`, `rated`, `test`, `games_per_pair`, `end_reason`, `end_bot_id`, `live_slot`) SELECT `id`, `name`, `status`, `starts_at`, `time_control`, `opening_plies`, `max_entrants`, `created_at`, `started_at`, `ended_at`, `rule_id`, `origin`, `created_by`, `rated`, `test`, `games_per_pair`, `end_reason`, `end_bot_id`, `live_slot` FROM `tournaments`;--> statement-breakpoint
DROP TABLE `tournaments`;--> statement-breakpoint
ALTER TABLE `__new_tournaments` RENAME TO `tournaments`;--> statement-breakpoint
CREATE INDEX `tournaments_status_starts_idx` ON `tournaments` (`status`,`starts_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tournaments_rule_starts_idx` ON `tournaments` (`rule_id`,`starts_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tournaments_id_origin_idx` ON `tournaments` (`id`,`origin`);--> statement-breakpoint
CREATE UNIQUE INDEX `tournaments_id_games_idx` ON `tournaments` (`id`,`games_per_pair`);--> statement-breakpoint
CREATE INDEX `tournaments_created_by_idx` ON `tournaments` (`created_by`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tournaments_live_slot_idx` ON `tournaments` (`created_by`,`live_slot`) WHERE "tournaments"."status" = 'running';--> statement-breakpoint
CREATE INDEX `tournaments_end_bot_idx` ON `tournaments` (`end_bot_id`);--> statement-breakpoint
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
	`leg` integer DEFAULT 1 NOT NULL,
	`games_per_pair` integer NOT NULL,
	FOREIGN KEY (`first_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`second_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tournament_id`,`games_per_pair`) REFERENCES `tournaments`(`id`,`games_per_pair`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tournament_pairings_leg_check" CHECK("leg" between 1 and 25 and "leg" <= max(1, "games_per_pair" / 2)),
	CONSTRAINT "tournament_pairings_round_check" CHECK("round" >= 1),
	CONSTRAINT "tournament_pairings_pair_check" CHECK("first_bot_id" <> "second_bot_id"),
	CONSTRAINT "tournament_pairings_game1_check" CHECK(("game1" in ('pending', 'live', 'not_played', 'aborted') and "game1_seat" is null) or ("game1" = 'played' and ("game1_seat" is null or "game1_seat" in ('first', 'second'))) or ("game1" in ('no_show', 'forfeit') and coalesce("game1_seat", '') in ('first', 'second', 'both'))),
	CONSTRAINT "tournament_pairings_game2_check" CHECK(("game2" in ('pending', 'live', 'not_played', 'aborted', 'none') and "game2_seat" is null) or ("game2" = 'played' and ("game2_seat" is null or "game2_seat" in ('first', 'second'))) or ("game2" in ('no_show', 'forfeit') and coalesce("game2_seat", '') in ('first', 'second', 'both'))),
	CONSTRAINT "tournament_pairings_single_check" CHECK(("games_per_pair" = 1) = ("game2" = 'none')),
	CONSTRAINT "tournament_pairings_order_check" CHECK("game2" in ('pending', 'none') or "game1" not in ('pending', 'live'))
);--> statement-breakpoint
INSERT INTO `tournament_pairings`(`id`, `tournament_id`, `round`, `first_bot_id`, `second_bot_id`, `opening_cells`, `game1`, `game1_seat`, `game2`, `game2_seat`, `leg`, `games_per_pair`) SELECT `id`, `tournament_id`, `round`, `first_bot_id`, `second_bot_id`, `opening_cells`, `game1`, `game1_seat`, `game2`, `game2_seat`, `leg`, `games_per_pair` FROM `__kept_pairings`;--> statement-breakpoint
CREATE INDEX `tournament_pairings_round_idx` ON `tournament_pairings` (`tournament_id`,`round`);--> statement-breakpoint
CREATE UNIQUE INDEX `tournament_pairings_leg_idx` ON `tournament_pairings` (`tournament_id`,`first_bot_id`,`second_bot_id`,`leg`);--> statement-breakpoint
CREATE INDEX `tournament_pairings_first_idx` ON `tournament_pairings` (`first_bot_id`);--> statement-breakpoint
CREATE INDEX `tournament_pairings_second_idx` ON `tournament_pairings` (`second_bot_id`);--> statement-breakpoint
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
	`seat` integer,
	PRIMARY KEY(`tournament_id`, `bot_id`),
	FOREIGN KEY (`tournament_id`,`origin`) REFERENCES `tournaments`(`id`,`origin`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`,`owner_id`) REFERENCES `bots`(`id`,`owner_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tournament_entries_state_check" CHECK("state" in ('entered', 'playing', 'absent', 'left_out', 'withdrawn') and ("origin" = 'operator' or "state" in ('playing', 'withdrawn'))),
	CONSTRAINT "tournament_entries_reason_check" CHECK(("state" = 'left_out' and coalesce("reason", '') in ('daily_cap', 'clock')) or ("state" = 'withdrawn' and (coalesce("reason", '') in ('missed', 'banned', 'delisted', 'deleted') or ("origin" = 'person' and coalesce("reason", '') in ('owner', 'refused', 'tournament')))) or ("state" not in ('left_out', 'withdrawn') and "reason" is null)),
	CONSTRAINT "tournament_entries_rating_check" CHECK("rating_at_start" is null or "rating_at_start" >= 400),
	CONSTRAINT "tournament_entries_level_check" CHECK(("level" is null or (json_valid("level") and substr("level", 1, 1) = '{' and length("level") <= 1024)) and ("level" is null or "origin" = 'person')),
	CONSTRAINT "tournament_entries_version_check" CHECK("version" is null or length("version") between 1 and 64),
	CONSTRAINT "tournament_entries_seat_check" CHECK(("origin" = 'operator') = ("seat" is null) and ("seat" is null or "seat" between 1 and 8))
);--> statement-breakpoint
INSERT INTO `tournament_entries`(`tournament_id`, `bot_id`, `owner_id`, `state`, `reason`, `rating_at_start`, `entered_at`, `origin`, `level`, `version`, `seat`) SELECT `tournament_id`, `bot_id`, `owner_id`, `state`, `reason`, `rating_at_start`, `entered_at`, `origin`, `level`, `version`, `seat` FROM `__kept_entries`;--> statement-breakpoint
CREATE UNIQUE INDEX `tournament_entries_owner_idx` ON `tournament_entries` (`tournament_id`,`owner_id`) WHERE "tournament_entries"."origin" = 'operator';--> statement-breakpoint
CREATE UNIQUE INDEX `tournament_entries_seat_idx` ON `tournament_entries` (`tournament_id`,`seat`);--> statement-breakpoint
CREATE INDEX `tournament_entries_bot_idx` ON `tournament_entries` (`bot_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `tournament_entries_owner_id_idx` ON `tournament_entries` (`owner_id`);--> statement-breakpoint
UPDATE `games` SET `pairing_id` = (SELECT `kept`.`pairing_id` FROM `__kept_pairing_games` `kept` WHERE `kept`.`id` = `games`.`id`), `pairing_game` = (SELECT `kept`.`pairing_game` FROM `__kept_pairing_games` `kept` WHERE `kept`.`id` = `games`.`id`), `x_level` = (SELECT `kept`.`x_level` FROM `__kept_pairing_games` `kept` WHERE `kept`.`id` = `games`.`id`), `o_level` = (SELECT `kept`.`o_level` FROM `__kept_pairing_games` `kept` WHERE `kept`.`id` = `games`.`id`) WHERE `id` IN (SELECT `id` FROM `__kept_pairing_games`);--> statement-breakpoint
DROP TABLE `__kept_pairing_games`;--> statement-breakpoint
DROP TABLE `__kept_pairings`;--> statement-breakpoint
DROP TABLE `__kept_entries`;--> statement-breakpoint
-- Each duel becomes a tournament of two under its own id, its starter its creator. A running one takes a live slot its
-- starter has free, the oldest first; one past the starter's two, or a rated one, which no running tournament may be, is
-- stopped by the operator. An owner's stop cuts it short naming that owner's bot, and the starter's is the creator's.
CREATE TABLE `__duel_ends` AS WITH `running` AS (
	SELECT `id`, `started_by`, row_number() OVER (PARTITION BY `started_by` ORDER BY `created_at`, `id`) AS `n` FROM `duels` WHERE `status` = 'running' AND `rated` = 0 AND `started_by` IS NOT NULL
), `free` AS (
	SELECT `starters`.`id` AS `user_id`, `slots`.`slot`, row_number() OVER (PARTITION BY `starters`.`id` ORDER BY `slots`.`slot`) AS `n`
	FROM (SELECT DISTINCT `started_by` AS `id` FROM `running`) `starters` CROSS JOIN (SELECT 1 AS `slot` UNION ALL SELECT 2) `slots`
	WHERE NOT EXISTS (SELECT 1 FROM `tournaments` WHERE `tournaments`.`created_by` = `starters`.`id` AND `tournaments`.`status` = 'running' AND `tournaments`.`live_slot` = `slots`.`slot`)
), `held` AS (
	SELECT `running`.`id`, `free`.`slot` FROM `running` INNER JOIN `free` ON `free`.`user_id` = `running`.`started_by` AND `free`.`n` = `running`.`n`
), `ends` AS (
	SELECT `duels`.`id`,
		CASE
			WHEN `duels`.`status` = 'stopped' AND `duels`.`end_reason` = 'owner' THEN 'cut_short'
			WHEN `duels`.`status` <> 'running' THEN `duels`.`status`
			WHEN `duels`.`rated` = 0 AND (`duels`.`started_by` IS NULL OR `held`.`slot` IS NOT NULL) THEN 'running'
			ELSE 'stopped'
		END AS `status`,
		`duels`.`end_reason` AS `old_reason`, `duels`.`end_bot`, `duels`.`bot_a_id`, `duels`.`bot_b_id`, `duels`.`ended_at`, coalesce(`held`.`slot`, 1) AS `live_slot`
	FROM `duels` LEFT JOIN `held` ON `held`.`id` = `duels`.`id`
)
SELECT `id`, `status`,
	CASE
		WHEN `status` IN ('running', 'finished') THEN NULL
		WHEN `old_reason` IS NULL THEN 'operator'
		WHEN `old_reason` = 'starter' THEN 'creator'
		ELSE `old_reason`
	END AS `end_reason`,
	CASE WHEN `status` = 'cut_short' THEN CASE `end_bot` WHEN 'a' THEN `bot_a_id` WHEN 'b' THEN `bot_b_id` END END AS `end_bot_id`,
	CASE WHEN `status` = 'running' THEN NULL ELSE coalesce(`ended_at`, CAST(strftime('%s', 'now') AS INTEGER)) END AS `ended_at`,
	`live_slot`
FROM `ends`;--> statement-breakpoint
INSERT INTO `tournaments`(`id`, `name`, `status`, `starts_at`, `time_control`, `opening_plies`, `max_entrants`, `created_at`, `started_at`, `ended_at`, `rule_id`, `origin`, `created_by`, `rated`, `test`, `games_per_pair`, `end_reason`, `end_bot_id`, `live_slot`) SELECT `duels`.`id`, NULL, `ends`.`status`, `duels`.`created_at`, `duels`.`time_control`, `duels`.`opening_plies`, 2, `duels`.`created_at`, `duels`.`created_at`, `ends`.`ended_at`, NULL, 'person', `duels`.`started_by`, `duels`.`rated`, `duels`.`test`, `duels`.`games`, `ends`.`end_reason`, `ends`.`end_bot_id`, `ends`.`live_slot` FROM `duels` INNER JOIN `__duel_ends` `ends` ON `ends`.`id` = `duels`.`id`;--> statement-breakpoint
-- Its two bots are its entries, the one its starter named first in seat 1, each as it stood at the start; the bot whose
-- leaving cut it short for a reason a withdrawal records is withdrawn.
INSERT INTO `tournament_entries`(`tournament_id`, `bot_id`, `owner_id`, `state`, `reason`, `rating_at_start`, `entered_at`, `origin`, `level`, `version`, `seat`) SELECT `entrants`.`tournament_id`, `entrants`.`bot_id`, `bots`.`owner_id`, CASE WHEN `entrants`.`withdrawn` THEN 'withdrawn' ELSE 'playing' END, CASE WHEN `entrants`.`withdrawn` THEN `entrants`.`end_reason` END, `entrants`.`rating`, `entrants`.`created_at`, 'person', `entrants`.`level`, `entrants`.`version`, `entrants`.`seat` FROM (
	SELECT `duels`.`id` AS `tournament_id`, `duels`.`bot_a_id` AS `bot_id`, `duels`.`a_rating` AS `rating`, `duels`.`a_level` AS `level`, `duels`.`a_version` AS `version`, CASE `duels`.`a_first` WHEN 1 THEN 1 ELSE 2 END AS `seat`, `duels`.`created_at`, `ends`.`end_reason`, `ends`.`end_bot_id` = `duels`.`bot_a_id` AND `ends`.`end_reason` IN ('owner', 'refused', 'tournament', 'banned', 'delisted', 'deleted') AS `withdrawn` FROM `duels` INNER JOIN `__duel_ends` `ends` ON `ends`.`id` = `duels`.`id`
	UNION ALL
	SELECT `duels`.`id`, `duels`.`bot_b_id`, `duels`.`b_rating`, `duels`.`b_level`, `duels`.`b_version`, CASE `duels`.`a_first` WHEN 1 THEN 2 ELSE 1 END, `duels`.`created_at`, `ends`.`end_reason`, `ends`.`end_bot_id` = `duels`.`bot_b_id` AND `ends`.`end_reason` IN ('owner', 'refused', 'tournament', 'banned', 'delisted', 'deleted') FROM `duels` INNER JOIN `__duel_ends` `ends` ON `ends`.`id` = `duels`.`id`
) `entrants` INNER JOIN `bots` ON `bots`.`id` = `entrants`.`bot_id`;--> statement-breakpoint
-- Each game number reads from its latest row, a replay standing for the game it replaced: played with the winner's
-- seat, live, aborted, or never begun; an aborted or unbegun game of a duel still running is to come.
CREATE TABLE `__duel_slots` AS WITH RECURSIVE `numbers`(`n`) AS (SELECT 1 UNION ALL SELECT `n` + 1 FROM `numbers` WHERE `n` < 50), `latest` AS (
	SELECT `id`, `duel_id`, `duel_game`, row_number() OVER (PARTITION BY `duel_id`, `duel_game` ORDER BY `created_at` DESC, `rowid` DESC) AS `rank` FROM `games` WHERE `duel_id` IS NOT NULL
)
SELECT `duels`.`id` AS `duel_id`, `numbers`.`n` AS `game`,
	CASE
		WHEN `games`.`id` IS NULL THEN CASE WHEN `ends`.`status` = 'running' THEN 'pending' ELSE 'not_played' END
		WHEN `games`.`finished_at` IS NULL THEN 'live'
		WHEN `games`.`finish_reason` = 'aborted' THEN CASE WHEN `ends`.`status` = 'running' THEN 'pending' ELSE 'aborted' END
		ELSE 'played'
	END AS `state`,
	CASE WHEN `games`.`finished_at` IS NOT NULL AND `games`.`finish_reason` <> 'aborted' AND `games`.`winner` IS NOT NULL THEN
		CASE WHEN (CASE WHEN `games`.`winner` = `games`.`challenger_side` THEN `games`.`challenger_bot_id` ELSE `games`.`dest_bot_id` END) = (CASE `duels`.`a_x` WHEN 1 THEN `duels`.`bot_a_id` ELSE `duels`.`bot_b_id` END) THEN 'first' ELSE 'second' END
	END AS `seat`,
	`games`.`opening_cells`
FROM `duels`
INNER JOIN `__duel_ends` `ends` ON `ends`.`id` = `duels`.`id`
INNER JOIN `numbers` ON `numbers`.`n` <= `duels`.`games`
LEFT JOIN `latest` ON `latest`.`duel_id` = `duels`.`id` AND `latest`.`duel_game` = `numbers`.`n` AND `latest`.`rank` = 1
LEFT JOIN `games` ON `games`.`id` = `latest`.`id`;--> statement-breakpoint
-- One pairing per opening in round 1, its first bot the one on x in game 1, whose opening the leg's first game drew;
-- a single game's second slot is none, and a second game waits while its first plays on.
INSERT INTO `tournament_pairings`(`id`, `tournament_id`, `round`, `first_bot_id`, `second_bot_id`, `opening_cells`, `game1`, `game1_seat`, `game2`, `game2_seat`, `leg`, `games_per_pair`) SELECT 'p_' || `one`.`duel_id` || '_' || ((`one`.`game` + 1) / 2), `one`.`duel_id`, 1, CASE `duels`.`a_x` WHEN 1 THEN `duels`.`bot_a_id` ELSE `duels`.`bot_b_id` END, CASE `duels`.`a_x` WHEN 1 THEN `duels`.`bot_b_id` ELSE `duels`.`bot_a_id` END, `one`.`opening_cells`, `one`.`state`, `one`.`seat`, CASE WHEN `two`.`duel_id` IS NULL THEN 'none' WHEN `two`.`state` = 'not_played' AND `one`.`state` = 'live' THEN 'pending' ELSE `two`.`state` END, `two`.`seat`, (`one`.`game` + 1) / 2, `duels`.`games` FROM `__duel_slots` `one` INNER JOIN `duels` ON `duels`.`id` = `one`.`duel_id` LEFT JOIN `__duel_slots` `two` ON `two`.`duel_id` = `one`.`duel_id` AND `two`.`game` = `one`.`game` + 1 WHERE `one`.`game` % 2 = 1;--> statement-breakpoint
UPDATE `games` SET `pairing_id` = 'p_' || `duel_id` || '_' || ((`duel_game` + 1) / 2), `pairing_game` = 2 - (`duel_game` % 2), `duel_id` = NULL, `duel_game` = NULL WHERE `duel_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `__duel_slots`;--> statement-breakpoint
DROP TABLE `__duel_ends`;--> statement-breakpoint
-- A column's own check changes only with the column, so unrated_by_choice keeps its values in a column of its own while
-- it is dropped and added again without the duel column; test, whose check reads it, does the same around it.
DROP INDEX `games_duel_idx`;--> statement-breakpoint
DROP INDEX `games_duels_finish_idx`;--> statement-breakpoint
DROP INDEX `games_no_event_finish_idx`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `duel_game`;--> statement-breakpoint
ALTER TABLE `games` ADD `test_kept` integer;--> statement-breakpoint
UPDATE `games` SET `test_kept` = `test`;--> statement-breakpoint
DROP INDEX `games_shown_finish_idx`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `test`;--> statement-breakpoint
ALTER TABLE `games` ADD `unrated_by_choice_kept` integer;--> statement-breakpoint
UPDATE `games` SET `unrated_by_choice_kept` = `unrated_by_choice`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `unrated_by_choice`;--> statement-breakpoint
ALTER TABLE `games` ADD `unrated_by_choice` integer DEFAULT 0 NOT NULL CONSTRAINT "games_unrated_by_choice_check" CHECK("unrated_by_choice" in (0, 1) and ("unrated_by_choice" = 0 or "pairing_id" is not null or ("x_level" is null and "o_level" is null and ("user_id" is not null or "challenger_bot_id" is not null))));--> statement-breakpoint
UPDATE `games` SET `unrated_by_choice` = `unrated_by_choice_kept`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `unrated_by_choice_kept`;--> statement-breakpoint
ALTER TABLE `games` ADD `test` integer DEFAULT 0 NOT NULL CONSTRAINT "games_test_check" CHECK("test" in (0, 1) and ("test" = 0 or ("guest_name" is null and ("unrated_by_choice" = 1 or "x_level" is not null or "o_level" is not null))));--> statement-breakpoint
UPDATE `games` SET `test` = `test_kept`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `test_kept`;--> statement-breakpoint
CREATE INDEX `games_shown_finish_idx` ON `games` (`finish_seq`) WHERE "games"."test" = 0;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `duel_id`;--> statement-breakpoint
CREATE INDEX `games_no_event_finish_idx` ON `games` (`finish_seq`) WHERE +"games"."pairing_id" is null;--> statement-breakpoint
-- No game points at a duel any more, so dropping the table cascades into nothing.
DROP TABLE `duels`;