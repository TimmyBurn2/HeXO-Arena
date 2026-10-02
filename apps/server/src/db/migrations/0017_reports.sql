CREATE TABLE `reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`reason` text NOT NULL,
	`details` text NOT NULL,
	`reporter_name` text,
	`reporter_email` text,
	`good_faith` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`closed_at` integer,
	`note` text,
	CONSTRAINT "reports_subject_check" CHECK(length("reports"."subject") between 1 and 512 and substr("reports"."subject", 1, 1) = '/'),
	CONSTRAINT "reports_reason_check" CHECK("reports"."reason" in ('illegal', 'abuse', 'name', 'cheating', 'other')),
	CONSTRAINT "reports_details_check" CHECK(length("reports"."details") between 1 and 2000),
	CONSTRAINT "reports_name_check" CHECK("reports"."reporter_name" is null or length("reports"."reporter_name") between 1 and 100),
	CONSTRAINT "reports_email_check" CHECK("reports"."reporter_email" is null or (length("reports"."reporter_email") between 3 and 254 and "reports"."reporter_email" like '%_@_%')),
	CONSTRAINT "reports_good_faith_check" CHECK("reports"."good_faith" = 1),
	CONSTRAINT "reports_status_check" CHECK("reports"."status" in ('open', 'closed')),
	CONSTRAINT "reports_closed_check" CHECK(("reports"."status" = 'closed') = ("reports"."closed_at" is not null)),
	CONSTRAINT "reports_note_check" CHECK(("reports"."status" = 'closed') = ("reports"."note" is not null) and ("reports"."note" is null or length("reports"."note") between 1 and 500))
);
--> statement-breakpoint
CREATE INDEX `reports_status_created_idx` ON `reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `reports_closed_at_idx` ON `reports` (`closed_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_admin_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`reason` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT "admin_actions_action_check" CHECK("__new_admin_actions"."action" in ('pause', 'resume', 'ban-user', 'unban-user', 'delete-user', 'delist-bot', 'relist-bot', 'revoke-bot', 'abort-game', 'recompute-ratings', 'tournament-create', 'tournament-cancel', 'tournament-schedule-add', 'tournament-schedule-remove', 'report-close')),
	CONSTRAINT "admin_actions_reason_check" CHECK(length("__new_admin_actions"."reason") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_admin_actions`("id", "actor", "action", "target", "reason", "at") SELECT "id", "actor", "action", "target", "reason", "at" FROM `admin_actions`;--> statement-breakpoint
DROP TABLE `admin_actions`;--> statement-breakpoint
ALTER TABLE `__new_admin_actions` RENAME TO `admin_actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;