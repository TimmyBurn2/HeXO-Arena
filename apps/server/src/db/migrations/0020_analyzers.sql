-- The bots and users columns are added in place: rebuilding either table inside the migration's
-- transaction, where the foreign_keys pragma is a no-op, would cascade into every row that points at it.
CREATE TABLE `analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`analyzer_bot_id` text,
	`analyzer_version` text,
	`named_bot_id` text,
	`requested_by` text,
	`status` text NOT NULL,
	`failure` text,
	`failed_turn` integer,
	`seconds` integer NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`analyzer_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`named_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "analyses_status_check" CHECK("analyses"."status" in ('queued', 'running', 'done', 'failed')),
	CONSTRAINT "analyses_failure_check" CHECK(("analyses"."status" = 'failed') = ("analyses"."failure" is not null) and coalesce("analyses"."failure", 'timeout') in ('timeout', 'illegal', 'no_evaluation', 'inconsistent', 'disconnect', 'protocol', 'expired')),
	CONSTRAINT "analyses_failed_turn_check" CHECK("analyses"."failed_turn" is null or ("analyses"."failed_turn" >= 1 and "analyses"."status" = 'failed')),
	CONSTRAINT "analyses_analyzer_check" CHECK((("analyses"."status" = 'queued') = ("analyses"."analyzer_bot_id" is null)) or ("analyses"."status" = 'failed' and "analyses"."analyzer_bot_id" is null)),
	CONSTRAINT "analyses_version_check" CHECK("analyses"."analyzer_version" is null or length("analyses"."analyzer_version") <= 64),
	CONSTRAINT "analyses_seconds_check" CHECK("analyses"."seconds" between 1 and 10),
	CONSTRAINT "analyses_finished_check" CHECK(("analyses"."status" in ('done', 'failed')) = ("analyses"."finished_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `analyses_game_id_idx` ON `analyses` (`game_id`);--> statement-breakpoint
CREATE INDEX `analyses_analyzer_bot_id_idx` ON `analyses` (`analyzer_bot_id`);--> statement-breakpoint
CREATE INDEX `analyses_named_bot_id_idx` ON `analyses` (`named_bot_id`);--> statement-breakpoint
CREATE INDEX `analyses_requested_by_created_idx` ON `analyses` (`requested_by`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `analyses_game_analyzer_idx` ON `analyses` (`game_id`,`analyzer_bot_id`) WHERE "analyses"."status" <> 'failed';--> statement-breakpoint
CREATE TABLE `analysis_lines` (
	`analysis_id` text NOT NULL,
	`turn` integer NOT NULL,
	`rank` integer NOT NULL,
	`first_x` integer NOT NULL,
	`first_y` integer NOT NULL,
	`second_x` integer NOT NULL,
	`second_y` integer NOT NULL,
	`heuristic` real,
	`win_in` integer,
	PRIMARY KEY(`analysis_id`, `turn`, `rank`),
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analysis_lines_turn_check" CHECK("analysis_lines"."turn" >= 1),
	CONSTRAINT "analysis_lines_rank_check" CHECK("analysis_lines"."rank" between 0 and 2),
	CONSTRAINT "analysis_lines_value_check" CHECK("analysis_lines"."heuristic" is not null or "analysis_lines"."win_in" is not null),
	CONSTRAINT "analysis_lines_heuristic_check" CHECK("analysis_lines"."heuristic" is null or abs("analysis_lines"."heuristic") <= 1000000),
	CONSTRAINT "analysis_lines_win_in_check" CHECK("analysis_lines"."win_in" is null or ("analysis_lines"."win_in" <> 0 and abs("analysis_lines"."win_in") <= 1000))
);
--> statement-breakpoint
CREATE TABLE `own_lines` (
	`game_id` text NOT NULL,
	`seq` integer NOT NULL,
	`rank` integer NOT NULL,
	`first_x` integer NOT NULL,
	`first_y` integer NOT NULL,
	`second_x` integer NOT NULL,
	`second_y` integer NOT NULL,
	`heuristic` real,
	`win_in` integer,
	PRIMARY KEY(`game_id`, `seq`, `rank`),
	FOREIGN KEY (`game_id`,`seq`) REFERENCES `moves`(`game_id`,`seq`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "own_lines_rank_check" CHECK("own_lines"."rank" between 0 and 2),
	CONSTRAINT "own_lines_value_check" CHECK("own_lines"."heuristic" is not null or "own_lines"."win_in" is not null),
	CONSTRAINT "own_lines_heuristic_check" CHECK("own_lines"."heuristic" is null or abs("own_lines"."heuristic") <= 1000000),
	CONSTRAINT "own_lines_win_in_check" CHECK("own_lines"."win_in" is null or ("own_lines"."win_in" <> 0 and abs("own_lines"."win_in") <= 1000))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_admin_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`reason` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT "admin_actions_action_check" CHECK("__new_admin_actions"."action" in ('pause', 'resume', 'ban-user', 'unban-user', 'delete-user', 'delist-bot', 'relist-bot', 'revoke-bot', 'abort-game', 'recompute-ratings', 'tournament-create', 'tournament-cancel', 'tournament-schedule-add', 'tournament-schedule-remove', 'report-close', 'delete-analysis')),
	CONSTRAINT "admin_actions_reason_check" CHECK(length("__new_admin_actions"."reason") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_admin_actions`("id", "actor", "action", "target", "reason", "at") SELECT "id", "actor", "action", "target", "reason", "at" FROM `admin_actions`;--> statement-breakpoint
DROP TABLE `admin_actions`;--> statement-breakpoint
ALTER TABLE `__new_admin_actions` RENAME TO `admin_actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `bots` ADD `analyzer_max_seconds` integer CONSTRAINT "bots_analyzer_max_seconds_check" CHECK("analyzer_max_seconds" is null or "analyzer_max_seconds" between 1 and 10);--> statement-breakpoint
ALTER TABLE `bots` ADD `analyzer_lines` integer CONSTRAINT "bots_analyzer_lines_check" CHECK("analyzer_lines" is null or "analyzer_lines" between 1 and 3);--> statement-breakpoint
ALTER TABLE `bots` ADD `analyzer_while_playing` integer CONSTRAINT "bots_analyzer_check" CHECK(("analyzer_while_playing" is null or "analyzer_while_playing" in (0, 1)) and ("analyzer_max_seconds" is null) = ("analyzer_lines" is null) and ("analyzer_lines" is null) = ("analyzer_while_playing" is null));--> statement-breakpoint
ALTER TABLE `users` ADD `analysis_opt_out` integer DEFAULT 0 NOT NULL CONSTRAINT "users_analysis_opt_out_check" CHECK("analysis_opt_out" in (0, 1));
