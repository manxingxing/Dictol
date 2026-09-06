ALTER TABLE `dictionary` ADD `external` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `dictionary_file` ADD `last_modified` integer;
