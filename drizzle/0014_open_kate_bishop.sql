CREATE TABLE `wordbook_tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wordbook_tag_normalized_name_unique` ON `wordbook_tag` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `wordbook_tag_name_idx` ON `wordbook_tag` (`name`);--> statement-breakpoint
CREATE TABLE `wordbook_word_tag` (
	`wordbook_word_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`wordbook_word_id`, `tag_id`),
	FOREIGN KEY (`wordbook_word_id`) REFERENCES `wordbook_word`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `wordbook_tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wordbook_word_tag_tag_id_idx` ON `wordbook_word_tag` (`tag_id`);
