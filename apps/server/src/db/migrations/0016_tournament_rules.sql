CREATE TABLE `tournament_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`weekday` integer NOT NULL,
	`minute_of_day` integer NOT NULL,
	`name_pattern` text NOT NULL,
	`time_control` text NOT NULL,
	`opening_plies` integer NOT NULL,
	`max_entrants` integer NOT NULL,
	`days_ahead` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "tournament_rules_weekday_check" CHECK("tournament_rules"."weekday" between 0 and 6),
	CONSTRAINT "tournament_rules_minute_check" CHECK("tournament_rules"."minute_of_day" between 0 and 1439),
	CONSTRAINT "tournament_rules_name_check" CHECK(length(replace("tournament_rules"."name_pattern", '{date}', 'YYYY-MM-DD')) between 3 and 40 and "tournament_rules"."name_pattern" not glob '*[^ -~]*'),
	CONSTRAINT "tournament_rules_opening_check" CHECK("tournament_rules"."opening_plies" in (1, 3, 5, 7, 9)),
	CONSTRAINT "tournament_rules_max_check" CHECK("tournament_rules"."max_entrants" between 3 and 12),
	CONSTRAINT "tournament_rules_days_check" CHECK("tournament_rules"."days_ahead" between 1 and 14)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tournament_rules_slot_idx` ON `tournament_rules` (`weekday`,`minute_of_day`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_admin_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`reason` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT "admin_actions_action_check" CHECK("__new_admin_actions"."action" in ('pause', 'resume', 'ban-user', 'unban-user', 'delete-user', 'delist-bot', 'relist-bot', 'revoke-bot', 'abort-game', 'recompute-ratings', 'tournament-create', 'tournament-cancel', 'tournament-schedule-add', 'tournament-schedule-remove')),
	CONSTRAINT "admin_actions_reason_check" CHECK(length("__new_admin_actions"."reason") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_admin_actions`("id", "actor", "action", "target", "reason", "at") SELECT "id", "actor", "action", "target", "reason", "at" FROM `admin_actions`;--> statement-breakpoint
DROP TABLE `admin_actions`;--> statement-breakpoint
ALTER TABLE `__new_admin_actions` RENAME TO `admin_actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `rule_id` integer REFERENCES `tournament_rules`(`id`) ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX `tournaments_rule_starts_idx` ON `tournaments` (`rule_id`,`starts_at`);