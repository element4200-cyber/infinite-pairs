CREATE TABLE `launches` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_hash` text NOT NULL,
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
	`build_until` integer NOT NULL,
	`last_valid` integer,
	`transaction` text,
	`signature` text,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `launches_auth_hash_unique` ON `launches` (`auth_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `launches_mint_unique` ON `launches` (`mint`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_launch` ON `launches` (`active`);--> statement-breakpoint
CREATE UNIQUE INDEX `launch_sequence` ON `launches` (`sequence`);