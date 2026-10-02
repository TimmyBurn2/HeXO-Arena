-- The column is added in place: rebuilding games inside the migration's
-- transaction, where the foreign_keys pragma is a no-op, would cascade into every row that points at it.
ALTER TABLE `games` ADD `unrated_by_choice` integer DEFAULT 0 NOT NULL CONSTRAINT "games_unrated_by_choice_check" CHECK("unrated_by_choice" in (0, 1) and ("unrated_by_choice" = 0 or ("user_id" is not null and "x_level" is null and "o_level" is null)));
