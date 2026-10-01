CREATE TABLE `game_ratings` (
	`game_id` text NOT NULL,
	`side` text NOT NULL,
	`rating_before` real NOT NULL,
	`rating_after` real NOT NULL,
	`deviation_after` real NOT NULL,
	PRIMARY KEY(`game_id`, `side`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "game_ratings_side_check" CHECK("game_ratings"."side" in ('x', 'o')),
	CONSTRAINT "game_ratings_rating_check" CHECK("game_ratings"."rating_before" >= 400 and "game_ratings"."rating_after" >= 400),
	CONSTRAINT "game_ratings_deviation_check" CHECK("game_ratings"."deviation_after" >= 45 and "game_ratings"."deviation_after" <= 500)
);
