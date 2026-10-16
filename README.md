# Triple Pairs

A public Pump.fun launchpad with a custom animated 3×P monogram and independent groups of three coins: **Main → Pair 1 → Pair 2**. The Triple Pairs platform coin is standalone; it is never required as a community group's quote or predecessor. There is no global starting CA.

Create a main coin with SOL as its quote, or add a live Pump.fun CA using a wallet-signed request. Existing Token-2022 name/ticker metadata is read from Solana when available; older tokens can use display labels. Imported roots are clearly marked, with their Pump.fun links. Creating a root here automatically publishes its group after the exact launch receipt finalizes. Each group shows its main coin and two clickable pair positions. Pair 2 requires finalized Pair 1; each group stops after two pairs. New groups can be started repeatedly by any wallet.

Auto-pair chooses the most recently created eligible predecessor in a live group with a free position and no active reservation. It never adds a fourth coin or changes the group of an already prepared transaction. Each token's actual Pump.fun quote and visible predecessor are separate fields. The official Pump.fun SDK resolves eligible custom quotes, including live depth limits. An ineligible quote falls back to SOL, disclosed in wallet review and token details. Optional dev buys use the actual quote currency.

The public Tokens launched board has Groups, New creations and Open slots menus, search, copied CAs, real Pump.fun links and pagination. New creations and old groups with recent pair activity refresh automatically. Pending and failed transactions are excluded from verified launch totals. Imports count as main coins, not tokens launched here.

## Storage and security

D1 stores `triple_groups` and `triple_launches`; R2 stores imported image files and immutable token metadata. The original `launches` and `chain_config` tables are retained solely as an archive after the requested reset. The new app never reads that archive or exposes its old CA. Historical image URLs stay available to tokens already on Solana. The appended migration only creates empty tables and indexes; it includes no data fixtures or backfills.

Unique database indexes reserve one active launch per group, one active launch per wallet, and one permanent position per finalized coin. Failed/expired positions release their reservation. Each wallet signs message authorization before image upload, CA import or preparation. Submission verifies every signature against the exact prepared transaction message. Transaction signatures persist before network submission; receipt messages must match before finalization. Batched reconciliation uses database claims to prevent simultaneous polls from repeating checks. Signed launches are tracked until definitive finalization/failure/expiry.

`SOLANA_RPC_URL` is a **server secret** configured through Sites runtime settings, currently an authenticated provider endpoint. Never put its API key in source, browser bundles, hosting.json or GitHub. `SITE_OWNER_EMAIL` is an optional server secret for trusted site-owner identity. The obsolete `STARTING_TOKEN_CA` setting is removed from the deployment. Preserve the Sites project ID and public access policy. Never commit wallet keys or credentials.

RPC configuration reads are batched; the transport paces reads, respects Retry-After, bounds transient retries and shares numeric cooldowns within a Worker isolate. It never automatically replays a transaction send. Provider failures cannot be mistaken for a zero token balance.

## Development and validation

Node.js 22.13+; pnpm 11.25.0. Dependencies are already locked. Use the Sites build helper with the existing Vite/Worker integration. `node node_modules/typescript/bin/tsc --noEmit --incremental false` checks types. Run `node --experimental-strip-types tests/rpc-transport.mjs` for deterministic transport tests.

`tests/triple-flow.mjs` requires a **fresh isolated localhost** D1/R2 preview with `SOLANA_RPC_URL=http://127.0.0.1:4199`. It caches one read-only batch of public Pump configuration into ignored `.wrangler/`, then simulates all token accounts, transactions and finalization on a localhost RPC server. It tests CA verification, authorization, two-slot ordering, duplicate CA and occupied-slot rejection, concurrent wallet races, independent groups, main/SOL launch preparation with a dev buy, newest-predecessor selection, unsigned rejection and message-matched receipt finalization. All writes and signed test transactions stay on localhost; none are sent to Solana.

`tests/triple-pagination.mjs` additionally verifies old archive isolation, every creation across pages, and updates to older groups using disposable synthetic localhost rows. It refuses hosted URLs and non-local DB paths. Never apply test fixtures to the hosted database. Older test files describing the superseded single-chain model are historical and are not the Triple Pairs acceptance tests.

A funded real launch still requires the user's wallet approval and is not performed by the build agent. Existing on-chain tokens cannot be deleted by resetting a site's board.

## Official pairing reference

[Pump.fun coin quotes and depth rules](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATE_WITH_PUMP_COIN_QUOTE.md)
