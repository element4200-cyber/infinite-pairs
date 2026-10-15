CREATE TABLE `chain_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`mint` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`configured_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_hash` text NOT NULL,
	`owner` text NOT NULL,
	`wallet_window` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`image` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_auth_hash_unique` ON `uploads` (`auth_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_wallet_window_unique` ON `uploads` (`wallet_window`);