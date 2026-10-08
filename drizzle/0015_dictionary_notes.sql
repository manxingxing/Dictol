CREATE TABLE IF NOT EXISTS `dictionary_note` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`excerpt` text,
	`comment` text,
	`comment_rich` text,
	`source_dictionary_id` integer,
	`source_entry_term` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `dictionary_note_created_at_idx` ON `dictionary_note` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `dictionary_note_attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` integer NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `dictionary_note`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `dictionary_note_attachment_storage_key_unique` ON `dictionary_note_attachment` (`storage_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `dictionary_note_attachment_note_id_idx` ON `dictionary_note_attachment` (`note_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS`dictionary_note_word` (
	`note_id` integer NOT NULL,
	`term` text NOT NULL,
	`normalized_term` text NOT NULL,
	PRIMARY KEY(`note_id`, `normalized_term`),
	FOREIGN KEY (`note_id`) REFERENCES `dictionary_note`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `dictionary_note_word_normalized_term_idx` ON `dictionary_note_word` (`normalized_term`);
