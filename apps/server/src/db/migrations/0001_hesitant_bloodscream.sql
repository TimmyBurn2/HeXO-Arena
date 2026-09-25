CREATE TABLE `bots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`token_hash` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`name_key`) REFERENCES `name_reservations`(`name_key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bots_scope_check" CHECK("bots"."scope" in ('bot:play'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bots_name_key_unique` ON `bots` (`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `bots_token_hash_unique` ON `bots` (`token_hash`);--> statement-breakpoint
CREATE INDEX `bots_owner_id_idx` ON `bots` (`owner_id`);