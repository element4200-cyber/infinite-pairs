# Infinite Pairs

A public Pump.fun launchpad in black, green, and purple, with animated infinity tracing, image import, a shared launch list, and automatic predecessor pairing.

## Starting CA

The site owner opens **Launchpad settings**, signs in with ChatGPT, and pastes the Infinite Pairs token CA after that token is launched on Pump.fun. Only the owner can save this setting. The server validates the mint against Pump.fun’s mainnet bonding-curve program. Launching remains closed until the starting CA is supplied. It cannot change while a launch is active or after the first launch has finalized.

The first community token records the configured CA as its predecessor and tries it as the Pump.fun quote. Every later token uses the newest finalized token’s CA, regardless of which wallet launched it. The previously selected SOL fallback remains enabled when Pump.fun rejects a quote for eligibility or maximum-depth reasons. Both the predecessor and actual trading pair are shown before signing and on token details.

## Image import and token creation

Open the site in a browser with Phantom or Solflare installed. Connect a wallet, enter a token name, ticker, and optional description, and import a PNG, JPEG, WebP, or GIF (up to 4 MB). The app uploads the image and generates token details automatically. No metadata URL or Pinata key is required.

Artwork and generated JSON are stored immutably in R2 and served publicly under `/api/assets/`, so Pump.fun can resolve them. Wallet message signatures authorize uploads and preparation. File bytes are checked against the signed SHA-256 digest, accepted file signatures, and size limits. Preparation only accepts an image upload belonging to the same wallet with matching token details. Public upload traffic is limited per signed wallet.

Optional dev buys are paid in the actual quote asset. For a token pair, the wallet needs the previous token. Creation and the dev buy are atomic. Large transactions can require an earlier, separately approved address lookup-table setup; its rent is disclosed and is paid even if the later launch is canceled. Network fees and account rent are additional.

## All launches

The shared list and **All launches** tab include every creator’s launches. Submitted transactions appear as pending; successful finalized transactions enter the verified list and become eligible to be the next predecessor. The list refreshes every five seconds and has pagination for all earlier launches. RPC verification delays leave existing records visible. The app indexes launches created through this launchpad, rather than every unrelated Pump.fun token.

D1 reserves one globally unique active launch slot. The selected predecessor is checked atomically when reserving it. Signed transactions must match the exact prepared message, and their signatures are stored before broadcast. Receipts must match that same message before a launch becomes verified. Reloads recover pending state, and prepared slots expire only after finalized block height exceeds their validity with no mint account.

## Server configuration

The Sites manifest provisions `DB` and `BUCKET`. `SITE_OWNER_EMAIL` is a server secret used to authorize CA changes using trusted ChatGPT identity headers; it is never bundled into the browser. `SOLANA_RPC_URL` can select a dedicated mainnet RPC provider; PublicNode is the default. Runtime secrets are managed through Sites environment settings. Never commit credentials or private keys. Public access is managed by Sites access controls.

## Development and verification

Requires Node.js 22.13+ and pnpm 11.25.0. Run `pnpm install`, `pnpm build`, and apply the SQL migrations in `drizzle/` to the **local** D1 database before previewing. `pnpm dev` starts the development preview. Preserve the Sites Vite integration and project ID.

Type check:

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

`tests/public-flow.mjs` runs only against localhost. It verifies signed artwork import, anonymous image/JSON retrieval, matching token details, owner-only CA configuration, CA locking, first-token pairing, concurrent reservations, and unsigned transaction rejection. The local preview must use the non-secret test owner `SITE_OWNER_EMAIL=seedy@sites.test`; production owner configuration stays separate. A real existing Pump.fun mint is used only for RPC reads and local configuration. No valid signed transaction is broadcast.

`tests/list-fixtures.sql` is explicitly synthetic **localhost-only** data. With those fixtures loaded, `tests/shared-list.mjs` checks cross-wallet visibility, 102-entry pagination, and selection of the newest CA instead of the starting CA. Remove those synthetic localhost records after testing. Never apply test fixtures or cleanup to a hosted/remote database. Source publication only applies the schema-only migrations in `drizzle/`.

A funded end-to-end creation and dev buy still require the user's wallet approval and have not been performed by the build agent.

## References

- [Official Pump.fun coin creation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md)
- [Quote assets and pairing depth](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATE_WITH_PUMP_COIN_QUOTE.md)
- [RPC transport](https://solana.publicnode.com/)
