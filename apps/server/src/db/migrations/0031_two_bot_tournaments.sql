-- A table that rows point at cannot be rebuilt in place: inside the migration's transaction, where the foreign_keys
-- pragma is a no-op, dropping it cascades into every row that points at it. So while the tournament tables are rebuilt,
-- the tournament games let go of their pairings, and the pairings and entries wait in tables of their own, then all of
-- it goes back. A game marked unrated by choice at a level holds the mark only as a tournament's, so its levels wait
-- beside its pairing. A person's tournament takes live slot 1, as each person ran one at a time; its entries take
-- seats in the order their keys read, entered first, then by name; and each pairing carries its tournament's games a pair.
CREATE TABLE `__kept_pairing_games` AS SELECT `id`, `pairing_id`, `pairing_game`, `x_level`, `o_level` FROM `games` WHERE `pairing_id` IS NOT NULL;--> statement-breakpoint
UPDATE `games` SET `pairing_id` = NULL, `pairing_game` = NULL, `x_level` = NULL, `o_level` = NULL WHERE `pairing_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__kept_pairings` AS SELECT `id`, `tournament_id`, `round`, `first_bot_id`, `second_bot_id`, `opening_cells`, `game1`, `game1_seat`, `game2`, `game2_seat`, `leg` FROM `tournament_pairings`;--> statement-breakpoint
CREATE TABLE `__kept_entries` AS SELECT `entries`.`tournament_id`, `entries`.`bot_id`, `entries`.`owner_id`, `entries`.`state`, `entries`.`reason`, `entries`.`rating_at_start`, `entries`.`entered_at`, `entries`.`origin`, `entries`.`level`, `entries`.`version`, CASE WHEN `entries`.`origin` = 'person' THEN row_number() OVER (PARTITION BY `entries`.`tournament_id` ORDER BY `entries`.`entered_at`, `bots`.`name_key`) END AS `seat` FROM `tournament_entries` `entries` INNER JOIN `bots` ON `bots`.`id` = `entries`.`bot_id`;--> statement-breakpoint
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
	CONSTRAINT "tournaments_rated_check" CHECK("rated" in (0, 1) and ("origin" = 'operator') = ("rated" = 1)),
	CONSTRAINT "tournaments_test_check" CHECK("test" in (0, 1) and ("test" = 0 or "origin" = 'person')),
	CONSTRAINT "tournaments_games_per_pair_check" CHECK("games_per_pair" in (1, 2, 4, 6, 8, 10, 20, 30, 50) and ("games_per_pair" <= 10 or "test" = 1) and ("origin" = 'person' or "games_per_pair" = 2) and ("opening_plies" > 1 or "games_per_pair" <= 2) and ("max_entrants" - 1) * "games_per_pair" <= (case "test" when 1 then 70 else 30 end)),
	CONSTRAINT "tournaments_end_check" CHECK(("status" in ('stopped', 'cut_short')) = ("end_reason" is not null) and ("status" <> 'stopped' or "end_reason" in ('creator', 'banned', 'deleted')) and ("status" <> 'cut_short' or "end_reason" in ('owner', 'missed', 'refused', 'tournament', 'banned', 'delisted', 'deleted'))),
	CONSTRAINT "tournaments_end_bot_check" CHECK("end_bot_id" is null or "status" = 'cut_short'),
	CONSTRAINT "tournaments_live_slot_check" CHECK(("origin" = 'operator') = ("live_slot" is null) and ("live_slot" is null or "live_slot" between 1 and 2))
);--> statement-breakpoint
INSERT INTO `__new_tournaments`(`id`, `name`, `status`, `starts_at`, `time_control`, `opening_plies`, `max_entrants`, `created_at`, `started_at`, `ended_at`, `rule_id`, `origin`, `created_by`, `rated`, `test`, `games_per_pair`, `end_reason`, `live_slot`) SELECT `id`, `name`, `status`, `starts_at`, `time_control`, `opening_plies`, `max_entrants`, `created_at`, `started_at`, `ended_at`, `rule_id`, `origin`, `created_by`, `rated`, `test`, `games_per_pair`, `end_reason`, CASE WHEN `origin` = 'person' THEN 1 END FROM `tournaments`;--> statement-breakpoint
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
INSERT INTO `tournament_pairings`(`id`, `tournament_id`, `round`, `first_bot_id`, `second_bot_id`, `opening_cells`, `game1`, `game1_seat`, `game2`, `game2_seat`, `leg`, `games_per_pair`) SELECT `kept`.`id`, `kept`.`tournament_id`, `kept`.`round`, `kept`.`first_bot_id`, `kept`.`second_bot_id`, `kept`.`opening_cells`, `kept`.`game1`, `kept`.`game1_seat`, `kept`.`game2`, `kept`.`game2_seat`, `kept`.`leg`, `tournaments`.`games_per_pair` FROM `__kept_pairings` `kept` INNER JOIN `tournaments` ON `tournaments`.`id` = `kept`.`tournament_id`;--> statement-breakpoint
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
DROP TABLE `__kept_entries`;
