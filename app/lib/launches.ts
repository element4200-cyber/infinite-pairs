import { env } from 'cloudflare:workers';
import { createPublicKey, verify, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction, AddressLookupTableProgram, AddressLookupTableAccount, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount, newBondingCurve, bondingCurvePda, PUMP_PROGRAM_ID, GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, QUOTE_CONTROL_PDA } from '@pump-fun/pump-sdk';
import {createRpcFetch,missingTokenAccount,rpcFailure} from './rpc';
import { getChatGPTUser } from '../chatgpt-auth';
import BN from 'bn.js';
import { SOL, ROOT_NAME, ROOT_SYMBOL, baseUnits, fallbackReason, validUri, base58 } from './rules';
export type Launch = {
  id: string; auth_hash: string; owner: string; mint: string; name: string; symbol: string; uri: string;
  description: string; image: string; predecessor: string | null; quote_mint: string; quote_symbol: string;
  fallback: string | null; depth: number; dev_buy: string; slippage: number; sequence: number | null;
  status: string; active: number | null; created_at: number; finalized_at: number | null; build_until: number;
  last_valid: number | null; transaction: string | null; signature: string | null; error: string | null;
  setup_transaction: string | null; setup_signature: string | null;
};
type Runtime = { DB?: D1Database; BUCKET?: R2Bucket; SITE_OWNER_EMAIL?: string; SOLANA_RPC_URL?: string; STARTING_TOKEN_CA?: string };
export type BaseToken={mint:string;name:string;symbol:string};
type Activation={status:'awaiting-ca'|'waiting-for-token'|'active'|'invalid-ca'|'verification-delayed';mint?:string};
export async function startingToken():Promise<{base:BaseToken|null;activation:Activation}>{
  const saved=await db().prepare('SELECT mint,name,symbol FROM chain_config WHERE id=1').first<BaseToken>();
  if(saved)return {base:saved,activation:{status:'active',mint:saved.mint}};
  const candidate=runtime().STARTING_TOKEN_CA?.trim();
  if(!candidate)return {base:null,activation:{status:'awaiting-ca'}};
  let key:PublicKey;
  try{key=new PublicKey(candidate);}catch{return {base:null,activation:{status:'invalid-ca'}};}
  const mint=key.toBase58();
  try{
    const account=await connection().getAccountInfo(bondingCurvePda(key),'finalized');
    if(!account)return {base:null,activation:{status:'waiting-for-token',mint}};
    if(!account.owner.equals(PUMP_PROGRAM_ID))return {base:null,activation:{status:'invalid-ca',mint}};
    try{PUMP_SDK.decodeBondingCurve(account);}catch{return {base:null,activation:{status:'invalid-ca',mint}};}
  }catch{return {base:null,activation:{status:'verification-delayed',mint}};}
  // Runtime configuration is owner-controlled. Never replace an existing root or live chain.
  await db().prepare("INSERT INTO chain_config(id,mint,name,symbol,configured_by,updated_at) SELECT 1,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM launches WHERE status='finalized' OR active=1) ON CONFLICT(id) DO NOTHING")
    .bind(mint,ROOT_NAME,ROOT_SYMBOL,'owner-runtime',Date.now()).run();
  const base=await db().prepare('SELECT mint,name,symbol FROM chain_config WHERE id=1').first<BaseToken>();
  return {base,activation:{status:base?'active':'verification-delayed',mint:base?.mint||mint}};
}
export async function baseToken(){return (await startingToken()).base;}
export async function ownerStatus(){const user=await getChatGPTUser();return {owner:!!user&&!!runtime().SITE_OWNER_EMAIL&&user.email.toLowerCase()===runtime().SITE_OWNER_EMAIL!.toLowerCase(),signedIn:!!user};}
export async function setBase(req:Request){
  sameOrigin(req);
  if(!(await ownerStatus()).owner) throw new Error('Only the signed-in site owner can configure the starting CA.');
  const {mint}=await req.json() as {mint:string}; const key=new PublicKey(mint);
  const account=await connection().getAccountInfo(bondingCurvePda(key),'finalized');
  if(!account||!account.owner.equals(PUMP_PROGRAM_ID)) throw new Error('This CA is not a live Pump.fun token on Solana mainnet.');
  PUMP_SDK.decodeBondingCurve(account);
  const user=await getChatGPTUser();
  const guard="NOT EXISTS(SELECT 1 FROM launches WHERE status='finalized' OR active=1)";
  const result=await db().prepare(`INSERT INTO chain_config(id,mint,name,symbol,configured_by,updated_at) SELECT 1,?,?,?,?,? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET mint=excluded.mint,name=excluded.name,symbol=excluded.symbol,configured_by=excluded.configured_by,updated_at=excluded.updated_at WHERE ${guard}`)
    .bind(key.toBase58(),ROOT_NAME,ROOT_SYMBOL,user!.userId,Date.now()).run();
  if(!result.meta.changes) throw new Error('The starting CA is locked once a launch is active or finalized.');
  return {base:await baseToken()};
}
export const runtime = () => env as Runtime;
export function db() { const db = runtime().DB; if (!db) throw new Error('Shared launch storage is unavailable.'); return db; }
export function connection() {
  return new Connection(runtime().SOLANA_RPC_URL || 'https://solana-rpc.publicnode.com', {
    commitment: 'confirmed', disableRetryOnRateLimit: true,
    fetch: createRpcFetch(),
  });
}
export function publicLaunch(row: Launch) {
  const { transaction, setup_transaction, auth_hash, active, build_until, last_valid, ...safe } = row;
  return safe;
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) throw new Error('Open the app directly to submit a launch.');
}
const recentChecks=new Map<string,number>();
export async function reconcile(force=false) {
  const row = await db().prepare('SELECT * FROM launches WHERE active = 1').first<Launch>();
  if (!row) return;
  if (row.status === 'building') {
    if (row.build_until < Date.now()) await db().prepare("UPDATE launches SET status='expired', active=NULL, error='Preparation timed out' WHERE id=? AND status='building'").bind(row.id).run();
    return;
  }
  // The feed and pending dialog both poll; share a short verification window.
  if(!force&&Date.now()-(recentChecks.get(row.id)??0)<4000)return;
  if(recentChecks.size>8)recentChecks.clear();recentChecks.set(row.id,Date.now());
  const rpc = connection();
  if (row.signature) {
    const status = (await rpc.getSignatureStatuses([row.signature], { searchTransactionHistory: true })).value[0];
    if (status?.confirmationStatus === 'finalized') {
      if (status.err) {
        await db().prepare("UPDATE launches SET status='failed', active=NULL, error=? WHERE id=? AND active=1").bind(JSON.stringify(status.err), row.id).run();
        return;
      }
      const receipt = await rpc.getTransaction(row.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
      if (!receipt || receipt.meta?.err || !row.transaction) return;
      const prepared = VersionedTransaction.deserialize(Buffer.from(row.transaction, 'base64'));
      if (!Buffer.from(receipt.transaction.message.serialize()).equals(Buffer.from(prepared.message.serialize()))) throw new Error('Transaction receipt does not match this launch.');
      await db().prepare("UPDATE launches SET status='finalized', active=NULL, finalized_at=?, sequence=(SELECT COALESCE(MAX(sequence),0)+1 FROM launches WHERE status='finalized') WHERE id=? AND active=1").bind(Date.now(), row.id).run();
      return;
    }
  }
  // A signed slot is never released by elapsed time while it can still land.
  if (row.last_valid && await rpc.getBlockHeight('finalized') > row.last_valid) {
    if (await rpc.getAccountInfo(new PublicKey(row.mint), 'finalized')) {
      // Recover a transaction broadcast outside this app after wallet signing.
      for (const candidate of await rpc.getSignaturesForAddress(new PublicKey(row.mint), {limit:20}, 'finalized')) {
        if (candidate.err) continue;
        const receipt = await rpc.getTransaction(candidate.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
        const prepared = VersionedTransaction.deserialize(Buffer.from(row.transaction!,'base64'));
        if(receipt && !receipt.meta?.err && Buffer.from(receipt.transaction.message.serialize()).equals(Buffer.from(prepared.message.serialize()))) {
          await db().prepare('UPDATE launches SET signature=? WHERE id=? AND active=1').bind(candidate.signature,row.id).run();
          break;
        }
      }
      return;
    }
    await db().prepare("UPDATE launches SET status='expired', active=NULL, error='Transaction expired before finalization' WHERE id=? AND active=1").bind(row.id).run();
  }
}
export async function feed() {
  let reconciliationError:string|null=null;
  try{await reconcile();}catch{reconciliationError='Solana verification is temporarily delayed. Existing launches remain visible.';}
  const rows = await db().prepare("SELECT * FROM launches WHERE status='finalized' ORDER BY sequence DESC LIMIT 101").all<Launch>();
  const total = await db().prepare("SELECT COUNT(*) AS n FROM launches WHERE status='finalized'").first<{ n: number }>();
  const tail = rows.results[0] || null;
  const active = await db().prepare('SELECT id,status FROM launches WHERE active=1').first();
  const pending=await db().prepare("SELECT * FROM launches WHERE active=1 AND status='submitted'").first<Launch>();
  return { launches: rows.results.slice(0,100).map(publicLaunch), hasMore: rows.results.length>100, total: total?.n || 0, tail: tail ? publicLaunch(tail) : null, ...await startingToken(), pending:pending?publicLaunch(pending):null, active, uploads: !!runtime().BUCKET, network: 'mainnet-beta',reconciliationError,...await ownerStatus() };
}
export async function olderFeed(before: number) {
  const rows = await db().prepare("SELECT * FROM launches WHERE status='finalized' AND sequence<? ORDER BY sequence DESC LIMIT 101").bind(before).all<Launch>();
  return { launches: rows.results.slice(0,100).map(publicLaunch), hasMore: rows.results.length>100 };
}
export async function prepare(req: Request) {
  sameOrigin(req);
  const body = await req.text(); if(body.length>20000) throw new Error('Launch request is too large.');
  const { payload, signature } = JSON.parse(body) as { payload: string; signature: string };
  if (typeof payload !== 'string' || payload.length > 12000 || typeof signature !== 'string' || signature.length>100) throw new Error('Invalid wallet authorization.');
  const p = JSON.parse(payload);
  if (p.domain !== new URL(req.url).origin || p.action !== 'Prepare Infinite Pairs launch' || !Number.isFinite(p.timestamp) || Math.abs(Date.now()-p.timestamp)>300000) throw new Error('Wallet authorization expired. Please try again.');
  const user = new PublicKey(p.wallet);
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100','hex'), user.toBuffer()]), format: 'der', type: 'spki' });
  if (!verify(null, Buffer.from(payload), publicKey, Buffer.from(signature,'base64'))) throw new Error('Wallet authorization failed.');
  const {name,symbol,uri,description='',image='',devBuy='0',slippage=1}=p;
  if (typeof name!=='string'||!name.trim()||Buffer.byteLength(name)>32||typeof symbol!=='string'||!symbol.trim()||Buffer.byteLength(symbol)>13) throw new Error('Use a name up to 32 bytes and a ticker up to 13 bytes.');
  if (typeof uri!=='string'||uri.length>200) throw new Error('Import a token image before preparing the launch.');
  const assetPrefix=new URL(req.url).origin+'/api/assets/';
  if(!uri.startsWith(assetPrefix)||!/^[-a-f0-9]{36}\.json$/.test(uri.slice(assetPrefix.length))) throw new Error('Import an image using this app before preparing the token.');
  const uploadedId=uri.slice(assetPrefix.length,-5);
  const uploaded=await db().prepare('SELECT owner,name,symbol,description,image FROM uploads WHERE id=?').bind(uploadedId).first<{owner:string;name:string;symbol:string;description:string;image:string}>();
  if(!uploaded||uploaded.owner!==user.toBase58()) throw new Error('The token image must be uploaded by the connected wallet.');
  if(uploaded.name!==name||uploaded.symbol!==symbol||uploaded.description!==description||uploaded.image!==image)throw new Error('Token details changed after image upload. Import the image again.');
  if (typeof description!=='string'||description.length>1000||typeof image!=='string'||image.length>500) throw new Error('Token details are too long.');
  if (image && !image.startsWith(assetPrefix)) throw new Error('Import an image using this app.');
  if (typeof devBuy!=='string'||!Number.isInteger(slippage)||slippage<0||slippage>10) throw new Error('Invalid dev-buy or slippage setting.');
  baseUnits(devBuy,9);
  await reconcile(true);
  const last = await db().prepare("SELECT * FROM launches WHERE status='finalized' ORDER BY sequence DESC LIMIT 1").first<Launch>();
  const tail=last||await baseToken();
  if(!tail) throw new Error('Launching opens automatically after the starting CA is supplied and verified live on Pump.fun.');
  const id=crypto.randomUUID(), mint=Keypair.generate(), authHash=createHash('sha256').update(payload).digest('hex');
  try {
    // The unique active slot serializes all wallets; terminal rows use NULL.
    await db().prepare("INSERT INTO launches (id,auth_hash,owner,mint,name,symbol,uri,description,image,predecessor,dev_buy,slippage,status,active,created_at,build_until) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'building',1,?,? WHERE COALESCE((SELECT mint FROM launches WHERE status='finalized' ORDER BY sequence DESC LIMIT 1),(SELECT mint FROM chain_config WHERE id=1))=?")
      .bind(id,authHash,user.toBase58(),mint.publicKey.toBase58(),name,symbol,uri,description,image,tail?.mint||null,devBuy,slippage,Date.now(),Date.now()+60000,tail?.mint||'').run().then(r=>{if(!r.meta.changes) throw new Error('Chain changed');});
  } catch { throw new Error('Another launch is being finalized, or this authorization was already used. Wait for the next slot and try again.'); }
  try {
    const rpc=connection(), online=new OnlinePumpSdk(rpc);
    // Fetch public Pump configuration in one RPC call instead of three concurrent calls.
    const [globalInfo,feeInfo,quoteInfo]=await rpc.getMultipleAccountsInfo([GLOBAL_PDA,PUMP_FEE_CONFIG_PDA,QUOTE_CONTROL_PDA]);
    if(!globalInfo||!feeInfo)throw new Error('Pump.fun configuration is temporarily unavailable. Please try again.');
    const global=PUMP_SDK.decodeGlobal(globalInfo),feeConfig=PUMP_SDK.decodeFeeConfig(feeInfo),quoteControl=quoteInfo?PUMP_SDK.decodeQuoteControl(quoteInfo):null;
    if (!global.createV2Enabled) throw new Error('Pump.fun has temporarily disabled token creation.');
    let quote, fallback: string|null=null;
    if (tail) {
      try { quote=await online.resolveQuoteMint(new PublicKey(tail.mint)); }
      catch (e) { fallback=fallbackReason(e); if (!fallback) throw e; }
    }
    quote ??= await online.resolveQuoteMint(new PublicKey(SOL));
    const quoteSymbol=quote.mint.toBase58()===SOL?'SOL':tail!.symbol;
    const units=new BN(baseUnits(devBuy,quote.decimals));
    const common={mint:mint.publicKey,name,symbol,uri,creator:user,user,mayhemMode:false,quoteMint:quote.mint,quoteTokenProgram:quote.quoteTokenProgram,pumpQuote:quote.pumpQuote?.accounts};
    const instructions=[ComputeBudgetProgram.setComputeUnitLimit({units:units.isZero()?400000:650000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000})];
    let tokens='0';
    if (!units.isZero()) {
      const amount=getBuyTokenAmountFromSolAmount({global,feeConfig,quoteControl,mintSupply:null,bondingCurve:null,amount:units,quoteMint:quote.mint,pumpQuote:quote.pumpQuote?.curve});
      if (amount.isZero()) throw new Error('The dev buy is too small to receive any tokens.');
      tokens=amount.toString();
      if (quoteSymbol!=='SOL') {
        const ata=getAssociatedTokenAddressSync(quote.mint,user,false,quote.quoteTokenProgram);
        let balance='0'; try { balance=(await rpc.getTokenAccountBalance(ata)).value.amount; } catch(e) { if(!missingTokenAccount(e))throw e; }
        if (BigInt(balance)<BigInt(units.muln(100+slippage).divn(100).toString())) throw new Error(`Your wallet needs ${devBuy} ${quoteSymbol}, plus slippage, for this dev buy. Buy the previous token on Pump.fun first, or set the dev buy to zero.`);
      }
      instructions.push(await PUMP_SDK.createV2Instruction(common));
      const curve=newBondingCurve(global,quote.mint,quoteControl,undefined,false,quote.pumpQuote?.curve);
      instructions.push(...await PUMP_SDK.buyV3Instructions({bondingCurve:curve,associatedUserAccountInfo:null,mint:mint.publicKey,user,quoteTokenProgram:quote.quoteTokenProgram,quoteAmount:units,amount,slippage}));
    } else instructions.push(await PUMP_SDK.createV2Instruction(common));
    const latest=await rpc.getLatestBlockhash('confirmed');
    const message=new TransactionMessage({payerKey:user,recentBlockhash:latest.blockhash,instructions});
    let tx=new VersionedTransaction(message.compileToV0Message()),setupTransaction:string|null=null,setupRent=0;
    if(tx.serialize().length>1232) {
      // Compact long create + buy transactions using a wallet-owned lookup table.
      const addresses=[...new Map(instructions.flatMap(ix=>[ix.programId,...ix.keys.filter(k=>!k.isSigner).map(k=>k.pubkey)]).filter(k=>!k.equals(user)&&!k.equals(mint.publicKey)).map(k=>[k.toBase58(),k])).values()].slice(0,20);
      const slot=await rpc.getSlot('finalized');
      const [createTable,tableKey]=AddressLookupTableProgram.createLookupTable({authority:user,payer:user,recentSlot:slot});
      const extendTable=AddressLookupTableProgram.extendLookupTable({lookupTable:tableKey,authority:user,payer:user,addresses});
      const setup=new VersionedTransaction(new TransactionMessage({payerKey:user,recentBlockhash:latest.blockhash,instructions:[createTable,extendTable]}).compileToV0Message());
      if(setup.serialize().length>1232) throw new Error('Lookup-table setup is too large. Shorten the metadata URI and retry.');
      setupTransaction=Buffer.from(setup.serialize()).toString('base64');
      setupRent=await rpc.getMinimumBalanceForRentExemption(56+addresses.length*32);
      const table=new AddressLookupTableAccount({key:tableKey,state:{deactivationSlot:18446744073709551615n,lastExtendedSlot:slot,lastExtendedSlotStartIndex:0,authority:user,addresses}});
      tx=new VersionedTransaction(message.compileToV0Message([table]));
    }
    tx.sign([mint]);
    if(tx.serialize().length>1232) throw new Error('This launch exceeds Solana’s transaction size. Shorten the metadata URI or launch without a dev buy.');
    const serialized=Buffer.from(tx.serialize()).toString('base64');
    const result=await db().prepare("UPDATE launches SET status='prepared', quote_mint=?,quote_symbol=?,fallback=?,depth=?,last_valid=?,\"transaction\"=?,setup_transaction=? WHERE id=? AND status='building' AND active=1").bind(quote.mint.toBase58(),quoteSymbol,fallback,quote.pumpQuote?.depth||0,latest.lastValidBlockHeight,serialized,setupTransaction,id).run();
    if (!result.meta.changes) throw new Error('Preparation expired. Please try again.');
    return {id,transaction:serialized,setupTransaction,setupRent,mint:mint.publicKey.toBase58(),name,symbol,predecessor:tail?.mint||null,quoteMint:quote.mint.toBase58(),quoteSymbol,fallback,devBuy,slippage,tokens,lastValidBlockHeight:latest.lastValidBlockHeight,network:'mainnet-beta',maxDevBuy:units.muln(100+slippage).divn(100).toString(),decimals:quote.decimals};
  } catch(e) {
    await db().prepare("UPDATE launches SET status='failed',active=NULL,error=? WHERE id=? AND status='building'").bind(rpcFailure(e)?.message||(e instanceof Error?e.message:'Preparation failed'),id).run();
    throw e;
  }
}
export async function submit(req: Request) {
  sameOrigin(req);
  const body=await req.text(); if(body.length>8000) throw new Error('Invalid signed transaction.');
  const {id,transaction,kind}=JSON.parse(body) as {id:string;transaction:string;kind?:string};
  if (typeof transaction!=='string'||transaction.length>5000) throw new Error('Invalid signed transaction.');
  const row=await db().prepare('SELECT * FROM launches WHERE id=?').bind(id).first<Launch>();
  if (!row||!row.transaction||!['prepared','submitted'].includes(row.status)) throw new Error('Launch slot is no longer available.');
  const expected=kind==='setup'?row.setup_transaction:row.transaction;
  if(!expected) throw new Error('No setup transaction is required.');
  const tx=VersionedTransaction.deserialize(Buffer.from(transaction,'base64')), original=VersionedTransaction.deserialize(Buffer.from(expected,'base64'));
  if (!Buffer.from(tx.message.serialize()).equals(Buffer.from(original.message.serialize()))||!verifyTransaction(tx)) throw new Error('The wallet-signed transaction does not match the launch you reviewed.');
  const sig=base58(tx.signatures[0]);
  if(kind==='setup') await db().prepare('UPDATE launches SET setup_signature=? WHERE id=? AND active=1').bind(sig,id).run();
  else await db().prepare("UPDATE launches SET signature=?,status='submitted' WHERE id=? AND active=1").bind(sig,id).run();
  try { await connection().sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:3}); }
  catch { return {id,signature:sig,status:'submitted',message:'Broadcast was not acknowledged. Its signature is tracked until finalization or expiry. You can retry the same signed transaction.'}; }
  return {id,signature:sig,status:'submitted'};
}
export function verifyTransaction(tx:VersionedTransaction) {
  return tx.signatures.every((sig,i)=>verify(null,Buffer.from(tx.message.serialize()),createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),tx.message.staticAccountKeys[i].toBuffer()]),format:'der',type:'spki'}),Buffer.from(sig)));
}
export async function setupStatus(row:Launch) {
  if(!row.setup_signature) return {setupReady:false,setupError:null};
  const s=(await connection().getSignatureStatuses([row.setup_signature],{searchTransactionHistory:true})).value[0];
  return {setupReady:s?.confirmationStatus==='finalized'&&!s.err,setupError:s?.err?JSON.stringify(s.err):null};
}
