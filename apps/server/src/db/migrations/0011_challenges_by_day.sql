DROP INDEX `challenges_challenger_bot_id_idx`;--> statement-breakpoint
CREATE INDEX `challenges_challenger_created_idx` ON `challenges` (`challenger_bot_id`,`created_at`);