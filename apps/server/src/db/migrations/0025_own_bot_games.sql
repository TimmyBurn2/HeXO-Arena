-- A column's own check changes only with the column, and rebuilding games inside the migration's transaction,
-- where the foreign_keys pragma is a no-op, would cascade into every row that points at it; so unrated_by_choice
-- keeps its values in a column of its own while it is dropped and added again with the check that admits a
-- challenge's game between two bots of one owner.
ALTER TABLE `games` ADD `unrated_by_choice_kept` integer;--> statement-breakpoint
UPDATE `games` SET `unrated_by_choice_kept` = `unrated_by_choice`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `unrated_by_choice`;--> statement-breakpoint
ALTER TABLE `games` ADD `unrated_by_choice` integer DEFAULT 0 NOT NULL CONSTRAINT "games_unrated_by_choice_check" CHECK("unrated_by_choice" in (0, 1) and ("unrated_by_choice" = 0 or "series_id" is not null or ("x_level" is null and "o_level" is null and ("user_id" is not null or ("challenger_bot_id" is not null and "pairing_id" is null)))));--> statement-breakpoint
UPDATE `games` SET `unrated_by_choice` = `unrated_by_choice_kept`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `unrated_by_choice_kept`;
