import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const launches = sqliteTable('launches', {
  id: text('id').primaryKey(), authHash: text('auth_hash').notNull().unique(),
  owner: text('owner').notNull(), mint: text('mint').notNull().unique(),
  name: text('name').notNull(), symbol: text('symbol').notNull(), uri: text('uri').notNull(),
  description: text('description').notNull(), image: text('image').notNull(),
  predecessor: text('predecessor'), quoteMint: text('quote_mint'), quoteSymbol: text('quote_symbol'),
  fallback: text('fallback'), depth: integer('depth').notNull().default(0),
  devBuy: text('dev_buy').notNull(), slippage: integer('slippage').notNull(),
  sequence: integer('sequence'), status: text('status').notNull(), active: integer('active'),
  createdAt: integer('created_at').notNull(), finalizedAt: integer('finalized_at'),
  buildUntil: integer('build_until').notNull(), lastValid: integer('last_valid'),
  transaction: text('transaction'), signature: text('signature'), error: text('error'),
  setupTransaction: text('setup_transaction'), setupSignature: text('setup_signature'),
}, t => [uniqueIndex('one_active_launch').on(t.active), uniqueIndex('launch_sequence').on(t.sequence)]);
export const chainConfig = sqliteTable('chain_config', {
  id: integer('id').primaryKey(), mint: text('mint').notNull(),
  name: text('name').notNull(), symbol: text('symbol').notNull(),
  configuredBy: text('configured_by').notNull(), updatedAt: integer('updated_at').notNull(),
});
export const uploads = sqliteTable('uploads', {
  id: text('id').primaryKey(), authHash: text('auth_hash').notNull().unique(),
  owner: text('owner').notNull(), walletWindow: text('wallet_window').notNull().unique(),
  name: text('name').notNull(), symbol: text('symbol').notNull(), description: text('description').notNull(), image: text('image').notNull(),
  createdAt: integer('created_at').notNull(),
});

// The original launch chain remains an archive. Triple Pairs starts with empty tables.
export const tripleGroups = sqliteTable('triple_groups', {
  id: text('id').primaryKey(), mint: text('mint').unique(),
  name: text('name').notNull(), symbol: text('symbol').notNull(),
  image: text('image').notNull().default(''), description: text('description').notNull().default(''),
  owner: text('owner').notNull(), source: text('source').notNull(),
  status: text('status').notNull(), sequence: integer('sequence').unique(),
  createdAt: integer('created_at').notNull(), finalizedAt: integer('finalized_at'),
});
export const tripleLaunches = sqliteTable('triple_launches', {
  id: text('id').primaryKey(), authHash: text('auth_hash').notNull().unique(),
  groupId: text('group_id').notNull(), slot: integer('slot').notNull(), slotKey: text('slot_key').unique(),
  owner: text('owner').notNull(), mint: text('mint').notNull().unique(),
  name: text('name').notNull(), symbol: text('symbol').notNull(), uri: text('uri').notNull(),
  description: text('description').notNull(), image: text('image').notNull(),
  predecessor: text('predecessor'), quoteMint: text('quote_mint'), quoteSymbol: text('quote_symbol'),
  fallback: text('fallback'), depth: integer('depth').notNull().default(0),
  devBuy: text('dev_buy').notNull(), slippage: integer('slippage').notNull(),
  sequence: integer('sequence'), status: text('status').notNull(), active: integer('active'),
  createdAt: integer('created_at').notNull(), finalizedAt: integer('finalized_at'), checkedAt: integer('checked_at').notNull().default(0),
  buildUntil: integer('build_until').notNull(), lastValid: integer('last_valid'),
  transaction: text('transaction'), signature: text('signature'), error: text('error'),
  setupTransaction: text('setup_transaction'), setupSignature: text('setup_signature'),
}, t => [uniqueIndex('triple_group_active').on(t.groupId,t.active),uniqueIndex('triple_wallet_active').on(t.owner,t.active),uniqueIndex('triple_launch_sequence').on(t.sequence)]);
