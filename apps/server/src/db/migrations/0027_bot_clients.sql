-- The columns are added in place: rebuilding bots inside the migration's transaction, where the foreign_keys
-- pragma is a no-op, would cascade into every row that points at it. The kind comes last, since its check reads
-- the other two. Every bot starts with no client seen.
ALTER TABLE `bots` ADD `client_version` text CONSTRAINT "bots_client_version_check" CHECK("client_version" is null or (length("client_version") <= 14 and "client_version" glob '[0-9]*.[0-9]*.[0-9]*' and "client_version" glob '*[0-9]' and "client_version" not glob '*[^0-9.]*' and "client_version" not glob '*..*' and "client_version" not glob '*.*.*.*'));--> statement-breakpoint
ALTER TABLE `bots` ADD `client_at` integer;--> statement-breakpoint
ALTER TABLE `bots` ADD `client_kind` text CONSTRAINT "bots_client_check" CHECK(("client_kind" is null or "client_kind" in ('hexo-bridge', 'other')) and ("client_kind" is null) = ("client_at" is null) and (coalesce("client_kind", '') = 'hexo-bridge') = ("client_version" is not null));
