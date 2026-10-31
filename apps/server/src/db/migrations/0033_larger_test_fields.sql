-- A table that rows point at cannot be rebuilt in place: inside the migration's transaction the foreign_keys pragma
-- is a no-op, so dropping it cascades into every row that points at it.
-- So while tournaments and their entries take larger fields, the tournament games let go of their pairings, keeping
-- their levels and test marks beside them, and the pairings and entries wait in tables of their own.
CREATE TABLE `__kept_pairing_games` AS SELECT `id`, `pairing_id`, `pairing_game`, `x_level`, `o_level`, `test` FROM `games` WHERE `pairing_id` IS NOT NULL;--> statement-breakpoint
UPDATE `games` SET `pairing_id` = NULL, `pairing_game` = NULL, `x_level` = NULL, `o_level` = NULL, `test` = 0 WHERE `pairing_id` IS NOT NULL;--> statement-breakpoint
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
	CONSTRAINT "tournaments_status_check" CHECK("__new_tournaments"."status" in ('scheduled', 'running', 'finished', 'called_off', 'canceled', 'stopped', 'cut_short')),
	CONSTRAINT "tournaments_name_check" CHECK(("__new_tournaments"."origin" = 'operator') = ("__new_tournaments"."name" is not null) and ("__new_tournaments"."name" is null or (length("__new_tournaments"."name") between 3 and 40 and "__new_tournaments"."name" not glob '*[^ -~]*'))),
	CONSTRAINT "tournaments_opening_check" CHECK("__new_tournaments"."opening_plies" in (1, 3, 5, 7, 9)),
	CONSTRAINT "tournaments_max_check" CHECK("__new_tournaments"."max_entrants" between 2 and 12 and (("__new_tournaments"."origin" = 'operator' and "__new_tournaments"."max_entrants" >= 3) or ("__new_tournaments"."origin" = 'person' and "__new_tournaments"."max_entrants" <= 12))),
	CONSTRAINT "tournaments_started_check" CHECK("__new_tournaments"."status" = 'canceled' or ("__new_tournaments"."status" in ('running', 'finished', 'stopped', 'cut_short')) = ("__new_tournaments"."started_at" is not null)),
	CONSTRAINT "tournaments_ended_check" CHECK(("__new_tournaments"."status" in ('finished', 'called_off', 'canceled', 'stopped', 'cut_short')) = ("__new_tournaments"."ended_at" is not null)),
	CONSTRAINT "tournaments_origin_check" CHECK(("__new_tournaments"."origin" = 'operator' and "__new_tournaments"."created_by" is null and "__new_tournaments"."status" not in ('stopped', 'cut_short')) or ("__new_tournaments"."origin" = 'person' and "__new_tournaments"."rule_id" is null and "__new_tournaments"."status" not in ('scheduled', 'called_off'))),
	CONSTRAINT "tournaments_rated_check" CHECK("__new_tournaments"."rated" in (0, 1) and (("__new_tournaments"."origin" = 'operator' and "__new_tournaments"."rated" = 1) or ("__new_tournaments"."origin" = 'person' and ("__new_tournaments"."rated" = 0 or ("__new_tournaments"."max_entrants" = 2 and "__new_tournaments"."status" in ('finished', 'stopped', 'cut_short')))))),
	CONSTRAINT "tournaments_test_check" CHECK("__new_tournaments"."test" in (0, 1) and ("__new_tournaments"."test" = 0 or "__new_tournaments"."origin" = 'person')),
	CONSTRAINT "tournaments_games_per_pair_check" CHECK("__new_tournaments"."games_per_pair" in (1, 2, 4, 6, 8, 10, 20, 30, 50) and ("__new_tournaments"."games_per_pair" <= 10 or "__new_tournaments"."test" = 1) and ("__new_tournaments"."origin" = 'person' or "__new_tournaments"."games_per_pair" = 2) and ("__new_tournaments"."opening_plies" > 1 or "__new_tournaments"."games_per_pair" <= 2) and ("__new_tournaments"."max_entrants" - 1) * "__new_tournaments"."games_per_pair" <= (case "__new_tournaments"."test" when 1 then 220 else 30 end)),
	CONSTRAINT "tournaments_end_check" CHECK(("__new_tournaments"."status" in ('stopped', 'cut_short')) = ("__new_tournaments"."end_reason" is not null) and ("__new_tournaments"."status" <> 'stopped' or "__new_tournaments"."end_reason" in ('creator', 'operator', 'banned', 'deleted')) and ("__new_tournaments"."status" <> 'cut_short' or "__new_tournaments"."end_reason" in ('owner', 'missed', 'refused', 'tournament', 'banned', 'delisted', 'deleted') or ("__new_tournaments"."max_entrants" = 2 and "__new_tournaments"."end_reason" in ('offline', 'closed', 'clock', 'busy', 'daily_cap', 'aborted')))),
	CONSTRAINT "tournaments_end_bot_check" CHECK("__new_tournaments"."end_bot_id" is null or "__new_tournaments"."status" = 'cut_short'),
	CONSTRAINT "tournaments_live_slot_check" CHECK(("__new_tournaments"."origin" = 'operator') = ("__new_tournaments"."live_slot" is null) and ("__new_tournaments"."live_slot" is null or "__new_tournaments"."live_slot" between 1 and 2))
);
--> statement-breakpoint
INSERT INTO `__new_tournaments`("id", "name", "status", "starts_at", "time_control", "opening_plies", "max_entrants", "created_at", "started_at", "ended_at", "rule_id", "origin", "created_by", "rated", "test", "games_per_pair", "end_reason", "end_bot_id", "live_slot") SELECT "id", "name", "status", "starts_at", "time_control", "opening_plies", "max_entrants", "created_at", "started_at", "ended_at", "rule_id", "origin", "created_by", "rated", "test", "games_per_pair", "end_reason", "end_bot_id", "live_slot" FROM `tournaments`;--> statement-breakpoint
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
	CONSTRAINT "tournament_entries_state_check" CHECK("tournament_entries"."state" in ('entered', 'playing', 'absent', 'left_out', 'withdrawn') and ("tournament_entries"."origin" = 'operator' or "tournament_entries"."state" in ('playing', 'withdrawn'))),
	CONSTRAINT "tournament_entries_reason_check" CHECK(("tournament_entries"."state" = 'left_out' and coalesce("tournament_entries"."reason", '') in ('daily_cap', 'clock')) or ("tournament_entries"."state" = 'withdrawn' and (coalesce("tournament_entries"."reason", '') in ('missed', 'banned', 'delisted', 'deleted') or ("tournament_entries"."origin" = 'person' and coalesce("tournament_entries"."reason", '') in ('owner', 'refused', 'tournament')))) or ("tournament_entries"."state" not in ('left_out', 'withdrawn') and "tournament_entries"."reason" is null)),
	CONSTRAINT "tournament_entries_rating_check" CHECK("tournament_entries"."rating_at_start" is null or "tournament_entries"."rating_at_start" >= 400),
	CONSTRAINT "tournament_entries_level_check" CHECK(("tournament_entries"."level" is null or (json_valid("tournament_entries"."level") and substr("tournament_entries"."level", 1, 1) = '{' and length("tournament_entries"."level") <= 1024)) and ("tournament_entries"."level" is null or "tournament_entries"."origin" = 'person')),
	CONSTRAINT "tournament_entries_version_check" CHECK("tournament_entries"."version" is null or length("tournament_entries"."version") between 1 and 64),
	CONSTRAINT "tournament_entries_seat_check" CHECK(("tournament_entries"."origin" = 'operator') = ("tournament_entries"."seat" is null) and ("tournament_entries"."seat" is null or "tournament_entries"."seat" between 1 and 12))
);
--> statement-breakpoint
INSERT INTO `tournament_entries`(`tournament_id`, `bot_id`, `owner_id`, `state`, `reason`, `rating_at_start`, `entered_at`, `origin`, `level`, `version`, `seat`) SELECT `tournament_id`, `bot_id`, `owner_id`, `state`, `reason`, `rating_at_start`, `entered_at`, `origin`, `level`, `version`, `seat` FROM `__kept_entries`;--> statement-breakpoint
CREATE UNIQUE INDEX `tournament_entries_owner_idx` ON `tournament_entries` (`tournament_id`,`owner_id`) WHERE "tournament_entries"."origin" = 'operator';--> statement-breakpoint
CREATE UNIQUE INDEX `tournament_entries_seat_idx` ON `tournament_entries` (`tournament_id`,`seat`);--> statement-breakpoint
CREATE INDEX `tournament_entries_bot_idx` ON `tournament_entries` (`bot_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `tournament_entries_owner_id_idx` ON `tournament_entries` (`owner_id`);--> statement-breakpoint
UPDATE `games` SET (`pairing_id`, `pairing_game`, `x_level`, `o_level`, `test`) = (SELECT `kept`.`pairing_id`, `kept`.`pairing_game`, `kept`.`x_level`, `kept`.`o_level`, `kept`.`test` FROM `__kept_pairing_games` `kept` WHERE `kept`.`id` = `games`.`id`) WHERE `id` IN (SELECT `id` FROM `__kept_pairing_games`);--> statement-breakpoint
DROP TABLE `__kept_pairing_games`;--> statement-breakpoint
DROP TABLE `__kept_pairings`;--> statement-breakpoint
DROP TABLE `__kept_entries`;
