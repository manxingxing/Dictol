DROP INDEX `dictionary_dict_path_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `dictionary_file_file_path_unique` ON `dictionary_file` (`file_path`);