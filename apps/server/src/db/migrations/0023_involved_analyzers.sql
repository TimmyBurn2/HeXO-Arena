-- The column is added in place: rebuilding analyses inside the migration's transaction, where the
-- foreign_keys pragma is a no-op, would cascade into every reading's lines. Every reading stored before
-- it came from an analyzer whose owner sat in neither seat, so 0 holds for each.
ALTER TABLE `analyses` ADD `involved` integer DEFAULT 0 NOT NULL CONSTRAINT "analyses_involved_check" CHECK("involved" in (0, 1) and ("involved" = 0 or "analyzer_bot_id" is not null));
