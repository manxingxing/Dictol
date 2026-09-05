ALTER TABLE `dictionary` ADD `uuid` text;
--> statement-breakpoint
UPDATE `dictionary`
SET `uuid` = CASE
	WHEN `external` = false THEN lower(substr(rtrim(`dict_path`, '/\'), -36))
	ELSE lower(
		hex(randomblob(4)) || '-' ||
		hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-8' ||
		substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
	)
END
WHERE `uuid` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `dictionary_uuid_unique` ON `dictionary` (`uuid`);
