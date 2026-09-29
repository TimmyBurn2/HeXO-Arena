CREATE TABLE `pending_signups` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`discord_id` text NOT NULL,
	`discord_username` text NOT NULL,
	`discord_display_name` text,
	`next` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "pending_signups_discord_id_check" CHECK(length("pending_signups"."discord_id") between 1 and 64),
	CONSTRAINT "pending_signups_discord_username_check" CHECK(length("pending_signups"."discord_username") between 1 and 32),
	CONSTRAINT "pending_signups_discord_display_name_check" CHECK("pending_signups"."discord_display_name" is null or length("pending_signups"."discord_display_name") between 1 and 32),
	CONSTRAINT "pending_signups_next_check" CHECK(length("pending_signups"."next") between 1 and 256 and substr("pending_signups"."next", 1, 1) = '/'),
	CONSTRAINT "pending_signups_attempts_check" CHECK("pending_signups"."attempts" between 0 and 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_signups_discord_id_unique` ON `pending_signups` (`discord_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_auth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`expires_at` integer NOT NULL,
	`next` text DEFAULT '/' NOT NULL,
	CONSTRAINT "auth_states_next_check" CHECK(length("__new_auth_states"."next") between 1 and 256 and substr("__new_auth_states"."next", 1, 1) = '/')
);
--> statement-breakpoint
INSERT INTO `__new_auth_states`("state", "nonce", "expires_at") SELECT "state", "nonce", "expires_at" FROM `auth_states`;--> statement-breakpoint
DROP TABLE `auth_states`;--> statement-breakpoint
ALTER TABLE `__new_auth_states` RENAME TO `auth_states`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`discord_username` text,
	`discord_display_name` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessions_discord_username_check" CHECK("__new_sessions"."discord_username" is null or length("__new_sessions"."discord_username") between 1 and 32),
	CONSTRAINT "sessions_discord_display_name_check" CHECK("__new_sessions"."discord_display_name" is null or ("__new_sessions"."discord_username" is not null and length("__new_sessions"."discord_display_name") between 1 and 32))
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "token_hash", "user_id", "created_at", "expires_at") SELECT "id", "token_hash", "user_id", "created_at", "expires_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);