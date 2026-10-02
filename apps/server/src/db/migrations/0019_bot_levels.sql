-- The columns are added in place: rebuilding bots or games inside the migration's
-- transaction, where the foreign_keys pragma is a no-op, would cascade into every row that points at them.
ALTER TABLE `bots` ADD `levels` text CONSTRAINT "bots_levels_check" CHECK("levels" is null or (json_valid("levels") and substr("levels", 1, 1) = '{' and length("levels") <= 16384));--> statement-breakpoint
ALTER TABLE `games` ADD `x_level` text CONSTRAINT "games_x_level_check" CHECK("x_level" is null or (json_valid("x_level") and substr("x_level", 1, 1) = '{' and length("x_level") <= 1024));--> statement-breakpoint
ALTER TABLE `games` ADD `o_level` text CONSTRAINT "games_o_level_check" CHECK("o_level" is null or (json_valid("o_level") and substr("o_level", 1, 1) = '{' and length("o_level") <= 1024)) CONSTRAINT "games_level_seat_check" CHECK("user_side" is null or (case "user_side" when 'x' then "x_level" else "o_level" end) is null);
