-- The columns are added in place: rebuilding bots inside the migration's transaction, where the foreign_keys
-- pragma is a no-op, would cascade into every row that points at it. Every bot starts with no text of its owner's.
ALTER TABLE `bots` ADD `owner_about` text CONSTRAINT "bots_owner_about_check" CHECK("owner_about" is null or length("owner_about") between 1 and 280);--> statement-breakpoint
ALTER TABLE `bots` ADD `owner_repo_url` text CONSTRAINT "bots_owner_repo_url_check" CHECK("owner_repo_url" is null or (length("owner_repo_url") <= 2048 and (lower(substr("owner_repo_url", 1, 7)) = 'http://' or lower(substr("owner_repo_url", 1, 8)) = 'https://')));
