CREATE TABLE `admin_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`reason` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT "admin_actions_action_check" CHECK("admin_actions"."action" in ('pause', 'resume', 'ban-user', 'unban-user', 'delete-user', 'delist-bot', 'relist-bot', 'revoke-bot', 'abort-game', 'recompute-ratings')),
	CONSTRAINT "admin_actions_reason_check" CHECK(length("admin_actions"."reason") > 0)
);
--> statement-breakpoint
CREATE TABLE `site_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`paused_at` integer,
	CONSTRAINT "site_state_single_row_check" CHECK("site_state"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `bots` ADD `delisted_at` integer;--> statement-breakpoint
ALTER TABLE `bots` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `voided_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` integer;