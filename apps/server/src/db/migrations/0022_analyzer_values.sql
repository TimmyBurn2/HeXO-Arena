-- The bots and analyses columns are added in place: rebuilding either table inside the migration's
-- transaction, where the foreign_keys pragma is a no-op, would cascade into every row that points at it.
CREATE TABLE `own_values` (
	`game_id` text NOT NULL,
	`side` text NOT NULL,
	`scale` real,
	`cut_inaccuracy` real,
	`cut_mistake` real,
	`cut_blunder` real,
	`meaning` text,
	PRIMARY KEY(`game_id`, `side`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "own_values_side_check" CHECK("own_values"."side" in ('x', 'o')),
	CONSTRAINT "own_values_meaning_check" CHECK(("own_values"."meaning" is null) = ("own_values"."scale" is null) and coalesce("own_values"."meaning", 'raw') in ('expected', 'raw')),
	CONSTRAINT "own_values_scale_check" CHECK("own_values"."scale" is null or ("own_values"."scale" > 0 and "own_values"."scale" <= 1000000)),
	CONSTRAINT "own_values_cuts_check" CHECK(("own_values"."cut_inaccuracy" is null) = ("own_values"."cut_mistake" is null) and ("own_values"."cut_mistake" is null) = ("own_values"."cut_blunder" is null) and ("own_values"."cut_blunder" is null or ("own_values"."scale" is not null and "own_values"."cut_inaccuracy" > 0 and "own_values"."cut_inaccuracy" < "own_values"."cut_mistake" and "own_values"."cut_mistake" < "own_values"."cut_blunder" and "own_values"."cut_blunder" <= 2)))
);
--> statement-breakpoint
ALTER TABLE `bots` ADD `analyzer_scale` real CONSTRAINT "bots_analyzer_scale_check" CHECK("analyzer_scale" is null or ("analyzer_lines" is not null and "analyzer_scale" > 0 and "analyzer_scale" <= 1000000));--> statement-breakpoint
ALTER TABLE `bots` ADD `analyzer_cut_inaccuracy` real;--> statement-breakpoint
ALTER TABLE `bots` ADD `analyzer_cut_mistake` real;--> statement-breakpoint
ALTER TABLE `bots` ADD `analyzer_cut_blunder` real CONSTRAINT "bots_analyzer_cuts_check" CHECK(("analyzer_cut_inaccuracy" is null) = ("analyzer_cut_mistake" is null) and ("analyzer_cut_mistake" is null) = ("analyzer_cut_blunder" is null) and ("analyzer_cut_blunder" is null or ("analyzer_scale" is not null and "analyzer_cut_inaccuracy" > 0 and "analyzer_cut_inaccuracy" < "analyzer_cut_mistake" and "analyzer_cut_mistake" < "analyzer_cut_blunder" and "analyzer_cut_blunder" <= 2)));--> statement-breakpoint
ALTER TABLE `bots` ADD `analyzer_meaning` text CONSTRAINT "bots_analyzer_meaning_check" CHECK(("analyzer_meaning" is null) = ("analyzer_scale" is null) and coalesce("analyzer_meaning", 'raw') in ('expected', 'raw'));--> statement-breakpoint
ALTER TABLE `analyses` ADD `analyzer_scale` real CONSTRAINT "analyses_analyzer_scale_check" CHECK("analyzer_scale" is null or ("analyzer_bot_id" is not null and "analyzer_scale" > 0 and "analyzer_scale" <= 1000000));--> statement-breakpoint
ALTER TABLE `analyses` ADD `analyzer_cut_inaccuracy` real;--> statement-breakpoint
ALTER TABLE `analyses` ADD `analyzer_cut_mistake` real;--> statement-breakpoint
ALTER TABLE `analyses` ADD `analyzer_cut_blunder` real CONSTRAINT "analyses_analyzer_cuts_check" CHECK(("analyzer_cut_inaccuracy" is null) = ("analyzer_cut_mistake" is null) and ("analyzer_cut_mistake" is null) = ("analyzer_cut_blunder" is null) and ("analyzer_cut_blunder" is null or ("analyzer_scale" is not null and "analyzer_cut_inaccuracy" > 0 and "analyzer_cut_inaccuracy" < "analyzer_cut_mistake" and "analyzer_cut_mistake" < "analyzer_cut_blunder" and "analyzer_cut_blunder" <= 2)));--> statement-breakpoint
ALTER TABLE `analyses` ADD `analyzer_meaning` text CONSTRAINT "analyses_analyzer_meaning_check" CHECK(("analyzer_meaning" is null) = ("analyzer_scale" is null) and coalesce("analyzer_meaning", 'raw') in ('expected', 'raw'));
