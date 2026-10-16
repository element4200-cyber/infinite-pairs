CREATE TABLE `triple_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`mint` text,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`image` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`sequence` integer,
	`created_at` integer NOT NULL,
	`finalized_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `triple_groups_mint_unique` ON `triple_groups` (`mint`);--> statement-breakpoint
CREATE UNIQUE INDEX `triple_groups_sequence_unique` ON `triple_groups` (`sequence`);--> statement-breakpoint
CREATE TABLE `triple_launches` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_hash` text NOT NULL,
	`group_id` text NOT NULL,
	`slot` integer NOT NULL,
	`slot_key` text,
	`owner` text NOT NULL,
	`mint` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`uri` text NOT NULL,
	`description` text NOT NULL,
	`image` text NOT NULL,
	`predecessor` text,
	`quote_mint` text,
	`quote_symbol` text,
	`fallback` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`dev_buy` text NOT NULL,
	`slippage` integer NOT NULL,
	`sequence` integer,
	`status` text NOT NULL,
	`active` integer,
	`created_at` integer NOT NULL,
	`finalized_at` integer,
	`checked_at` integer DEFAULT 0 NOT NULL,
	`build_until` integer NOT NULL,
	`last_valid` integer,
	`transaction` text,
	`signature` text,
	`error` text,
	`setup_transaction` text,
	`setup_signature` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `triple_launches_auth_hash_unique` ON `triple_launches` (`auth_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `triple_launches_slot_key_unique` ON `triple_launches` (`slot_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `triple_launches_mint_unique` ON `triple_launches` (`mint`);--> statement-breakpoint
CREATE UNIQUE INDEX `triple_group_active` ON `triple_launches` (`group_id`,`active`);--> statement-breakpoint
CREATE UNIQUE INDEX `triple_wallet_active` ON `triple_launches` (`owner`,`active`);--> statement-breakpoint
CREATE UNIQUE INDEX `triple_launch_sequence` ON `triple_launches` (`sequence`);