CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`user_side` text NOT NULL,
	`time_control` text NOT NULL,
	`opening_cells` text NOT NULL,
	`winner` text,
	`finish_reason` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "games_user_side_check" CHECK("games"."user_side" in ('x', 'o')),
	CONSTRAINT "games_winner_check" CHECK("games"."winner" is null or "games"."winner" in ('x', 'o')),
	CONSTRAINT "games_finish_reason_check" CHECK("games"."finish_reason" is null or "games"."finish_reason" in ('aborted', 'disconnect', 'surrender', 'timeout', 'terminated', 'six-in-a-row')),
	CONSTRAINT "games_finish_pair_check" CHECK(("games"."finished_at" is null) = ("games"."finish_reason" is null))
);
--> statement-breakpoint
CREATE INDEX `games_user_id_idx` ON `games` (`user_id`);--> statement-breakpoint
CREATE INDEX `games_bot_id_idx` ON `games` (`bot_id`);--> statement-breakpoint
CREATE TABLE `moves` (
	`game_id` text NOT NULL,
	`seq` integer NOT NULL,
	`side` text NOT NULL,
	`first_x` integer NOT NULL,
	`first_y` integer NOT NULL,
	`second_x` integer NOT NULL,
	`second_y` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`game_id`, `seq`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "moves_side_check" CHECK("moves"."side" in ('x', 'o')),
	CONSTRAINT "moves_seq_check" CHECK("moves"."seq" >= 1)
);
