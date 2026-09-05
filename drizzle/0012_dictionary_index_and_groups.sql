CREATE TABLE `dictionary_group` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dictionary_group_name_unique` ON `dictionary_group` (`name`);--> statement-breakpoint
CREATE INDEX `dictionary_group_sort_order_idx` ON `dictionary_group` (`sort_order`);--> statement-breakpoint
CREATE TABLE `dictionary_group_member` (
	`group_id` integer NOT NULL,
	`dictionary_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`group_id`, `dictionary_id`),
	FOREIGN KEY (`group_id`) REFERENCES `dictionary_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dictionary_id`) REFERENCES `dictionary`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dictionary_group_member_group_sort_idx` ON `dictionary_group_member` (`group_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `dictionary_group_member_dictionary_id_idx` ON `dictionary_group_member` (`dictionary_id`);--> statement-breakpoint
CREATE TABLE `dictionary_index` (
	`dictionary_id` integer PRIMARY KEY NOT NULL,
	`format_version` integer DEFAULT 3 NOT NULL,
	`source_fingerprint` text,
	`normalization_version` integer DEFAULT 2 NOT NULL,
	`comparison_version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'building' NOT NULL,
	`entry_count` integer,
	`term_count` integer,
	`file_size` integer,
	`built_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`dictionary_id`) REFERENCES `dictionary`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "dictionary_index_status_check" CHECK("dictionary_index"."status" in ('building', 'ready', 'error', 'needs_reindex'))
);
--> statement-breakpoint
CREATE INDEX `dictionary_index_status_idx` ON `dictionary_index` (`status`);
