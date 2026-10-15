# Infinite Pairs

A Pump.fun launchpad in black, lime green, and purple. The first launch is Infinite Pairs (`INFINITE`), paired with SOL. Each subsequent launch records the last finalized launch as its predecessor and tries that mint as the actual Pump.fun quote asset.

## Open and launch

Open the hosted app in a browser with Phantom or Solflare installed. Connect your wallet, choose **Create a token**, add a public token metadata URI, optionally enable a dev buy, and select **Review launch**. A message signature authorizes preparation; it does not spend funds. Check the exact trading pair and maximum dev-buy spend, then approve the launch transaction in your wallet.

Pump.fun currently exposes a configurable maximum pairing depth (2 when checked on October 14, 2026). Infinite Pairs reads the network configuration through `@pump-fun/pump-sdk` 4.1.0. Expected quote eligibility/depth failures select SOL while preserving the predecessor link. RPC failures and temporarily incomplete migrations stop preparation rather than silently changing a quote. The review displays every fallback.

Dev buys use the **actual quote asset**. A SOL launch spends SOL; a token-paired launch requires the previous token in the wallet. Network fees and account rent are additional. Creation and the dev buy are atomic in the same transaction. Large transactions use a wallet-owned address lookup table: this requires an earlier wallet approval and rent payment, disclosed before signing. Setup rent is paid even if the token launch is canceled.

All launched tokens shown in the feed were created through Infinite Pairs and verified at Solana finality. The feed refreshes every 12 seconds and supports earlier-launch pagination. It does not claim to index every unrelated token launched on Pump.fun.

## Metadata and optional server configuration

A public HTTPS/IPFS metadata URI works without an upload integration. The URI must be at most 200 characters and should contain matching `name` and `symbol`, plus `description` and a public `image` URL. For example:

```json
{
  "name": "Infinite Pairs",
  "symbol": "INFINITE",
  "description": "Every launch, connected.",
  "image": "https://your-public-artwork-host/infinite-pairs.png"
}
```

To enable in-app image and metadata uploads, configure the hosted server secret `PINATA_JWT` with Pinata pinning permissions. Configure `SOLANA_RPC_URL` for a dedicated mainnet provider if desired. PublicNode is the default RPC transport. Never put private keys or these credentials in the frontend, source manifest, or committed files. Runtime secrets are managed through Sites environment settings. Uploads use public IPFS, allowing Pump.fun to resolve metadata even while the app preview is private.

## Shared launch ordering

Cloudflare D1 has one globally unique active launch slot. The predecessor is checked atomically when reserving it. A prepared slot remains held until finalized execution, finalized failure, or finalized block height beyond transaction validity with no mint account. Signed transaction signatures are stored before broadcast, and receipts must match the exact prepared message. Requests require wallet message signatures, timestamp/domain checks, unique authorizations, and same-origin submission. Mint keys are generated ephemerally for partial signatures and never persisted.

Rejected wallet approvals can be retried while a blockhash remains valid. Reloads recover the pending launch ID and unsigned prepared transaction in the same browser tab. If a signed transaction is broadcast elsewhere, matching mint transaction history can recover it after expiry.

## Local development

Requires Node.js 22.13+ and pnpm 11.25.0. Run `pnpm install`, then `pnpm dev`. Run `pnpm build` to build the Cloudflare Worker. Preserve the Sites Vite integration and `.openai/hosting.json` project ID. D1 migrations are in `drizzle/`; apply them to the local DB using the configured Wrangler command before testing. Hosted publication applies migrations separately.

```powershell
pnpm build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_foamy_jubilee.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_familiar_namora.sql
pnpm dev
```

The preview and hosted databases are separate. Never apply test cleanup to the hosted database.

## Verification

`node node_modules/typescript/bin/tsc --noEmit --incremental false` checks TypeScript. `node --experimental-strip-types tests/launch-flow.mjs` checks the local API with generated, unfunded wallets. It exercises signed authorization, genesis enforcement, concurrent reservations, exact decimal amounts, v0 sizing, lookup-table rent, mint partial signing, unsigned/tampered rejection, and exclusion of pending tokens from the feed. Set `TEST_ORIGIN` to test the built preview instead of the development server. Tests use mainnet **read** operations and never submit a valid signed transaction or spend funds. Local prepared test slots expire naturally.

A funded end-to-end creation, dev buy, and finalization requires the user's wallet approval and has not been executed by the build agent. No token or investment return is promised.

## Protocol references

- [Official Pump.fun coin creation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md)
- [Pump coin quote assets and depth limits](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATE_WITH_PUMP_COIN_QUOTE.md)
- [Solana RPC transport](https://solana.publicnode.com/)

This site is an independent integration and is not presented as a Pump.fun-operated product. Hosting starts as an owner-private preview. Public access can be enabled separately when the owner chooses to share it.
