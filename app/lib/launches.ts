import { env } from 'cloudflare:workers';
import { createPublicKey, verify, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction, AddressLookupTableProgram, AddressLookupTableAccount, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount, newBondingCurve, bondingCurvePda, PUMP_PROGRAM_ID, GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, QUOTE_CONTROL_PDA } from '@pump-fun/pump-sdk';
import {createRpcFetch,missingTokenAccount,rpcFailure} from './rpc';
import {preflightRejection} from './transaction-status';
import {pairTarget,walletPayload,groupPage,changedGroups} from './groups';
import { getChatGPTUser } from '../chatgpt-auth';
import BN from 'bn.js';
import { SOL, baseUnits, fallbackReason, validUri, base58 } from './rules';
export type Launch = {
  id: string; group_id:string; slot:number; slot_key:string|null; checked_at:number; auth_hash: string; owner: string; mint: string; name: string; symbol: string; uri: string;
  description: string; image: string; predecessor: string | null; quote_mint: string; quote_symbol: string;
  fallback: string | null; depth: number; dev_buy: string; slippage: number; sequence: number | null;
  status: string; active: number | null; created_at: number; finalized_at: number | null; build_until: number;
  last_valid: number | null; transaction: string | null; signature: string | null; error: string | null;
  setup_transaction: string | null; setup_signature: string | null;
};
type Runtime = { DB?: D1Database; BUCKET?: R2Bucket; SITE_OWNER_EMAIL?: string; SOLANA_RPC_URL?: string };
export async function ownerStatus(){const user=await getChatGPTUser();return {owner:!!user&&!!runtime().SITE_OWNER_EMAIL&&user.email.toLowerCase()===runtime().SITE_OWNER_EMAIL!.toLowerCase(),signedIn:!!user};}
export const runtime = () => env as Runtime;
export function db() { const db = runtime().DB; if (!db) throw new Error('Shared launch storage is unavailable.'); return db; }
export function connection() {
  return new Connection(runtime().SOLANA_RPC_URL || 'https://solana-rpc.publicnode.com', {
    commitment: 'confirmed', disableRetryOnRateLimit: true,
    fetch: createRpcFetch(),
  });
}
export function publicLaunch(row: Launch) {
  const { transaction, setup_transaction, auth_hash, active, build_until, last_valid, slot_key, checked_at, ...safe } = row;
  return safe;
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) throw new Error('Open the app directly to submit a launch.');
}
async function expire(row:Launch,message:string){
  await db().batch([
    db().prepare("UPDATE triple_launches SET status='expired',active=NULL,slot_key=NULL,error=? WHERE id=? AND active=1").bind(message,row.id),
    db().prepare("UPDATE triple_groups SET status='expired' WHERE id=? AND status='pending' AND NOT EXISTS(SELECT 1 FROM triple_launches WHERE group_id=? AND active=1)").bind(row.group_id,row.group_id),
  ]);
}
async function finalized(row:Launch){
  await db().batch([
    db().prepare("UPDATE triple_launches SET status='finalized',active=NULL,finalized_at=?,sequence=(SELECT COALESCE(MAX(sequence),0)+1 FROM triple_launches WHERE status='finalized') WHERE id=? AND active=1").bind(Date.now(),row.id),
    db().prepare("UPDATE triple_groups SET status='live',finalized_at=?,sequence=(SELECT COALESCE(MAX(sequence),0)+1 FROM triple_groups) WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM triple_launches WHERE id=? AND status='finalized' AND slot=0)").bind(Date.now(),row.group_id,row.id),
  ]);
}
export async function reconcile(onlyId?:string,groupId?:string){
  const progress:Record<string,string>={};
  const rows=(await db().prepare('SELECT * FROM triple_launches WHERE active=1'+(onlyId?' AND id=?':groupId?' AND group_id=?':'')+' ORDER BY checked_at LIMIT 12').bind(...(onlyId?[onlyId]:groupId?[groupId]:[])).all<Launch>()).results;
  const candidates:Launch[]=[];
  for(const row of rows){
    if(row.status==='building'){if(row.build_until<Date.now())await expire(row,'Preparation timed out');continue;}
    const claim=await db().prepare('UPDATE triple_launches SET checked_at=? WHERE id=? AND checked_at<? AND active=1').bind(Date.now(),row.id,Date.now()-5000).run();
    if(claim.meta.changes)candidates.push(row);
  }
  if(!candidates.length)return progress;
  const rpc=connection(),withSig=candidates.filter(r=>r.signature);
  const statuses=withSig.length?(await rpc.getSignatureStatuses(withSig.map(r=>r.signature!),{searchTransactionHistory:true})).value:[];
  const height=await rpc.getBlockHeight('finalized');
  for(const row of candidates){
    const status=row.signature?statuses[withSig.findIndex(r=>r.id===row.id)]:null;
    if(status?.confirmationStatus)progress[row.id]=status.confirmationStatus;
    if(status?.confirmationStatus==='finalized'){
      if(status.err){await expire(row,'Transaction failed on Solana');continue;}
      const receipt=await rpc.getTransaction(row.signature!,{commitment:'finalized',maxSupportedTransactionVersion:0});
      if(!receipt||receipt.meta?.err||!row.transaction)continue;
      const prepared=VersionedTransaction.deserialize(Buffer.from(row.transaction,'base64'));
      if(!Buffer.from(receipt.transaction.message.serialize()).equals(Buffer.from(prepared.message.serialize())))throw new Error('Transaction receipt does not match this launch.');
      await finalized(row);continue;
    }
    if(row.last_valid&&height>row.last_valid){
      if(await rpc.getAccountInfo(new PublicKey(row.mint),'finalized')){
        for(const candidate of await rpc.getSignaturesForAddress(new PublicKey(row.mint),{limit:20},'finalized')){
          if(candidate.err)continue;
          const receipt=await rpc.getTransaction(candidate.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
          const prepared=VersionedTransaction.deserialize(Buffer.from(row.transaction!,'base64'));
          if(receipt&&!receipt.meta?.err&&Buffer.from(receipt.transaction.message.serialize()).equals(Buffer.from(prepared.message.serialize()))){
            await db().prepare('UPDATE triple_launches SET signature=? WHERE id=? AND active=1').bind(candidate.signature,row.id).run();await finalized(row);break;
          }
        }
      }else await expire(row,'Transaction expired before finalization');
    }
  }
  return progress;
}
export async function feed(){
  let reconciliationError:string|null=null;
  try{await reconcile();}catch{reconciliationError='Solana verification is temporarily delayed. Existing creations remain visible.';}
  const page=await groupPage();
  const creations=await creationPage();
  const updatedIds=[...new Set(creations.launches.map(t=>t.group_id))].filter(id=>!page.groups.some(g=>g.id===id));
  const updatedGroups=await changedGroups(updatedIds);
  const pending=(await db().prepare("SELECT * FROM triple_launches WHERE active=1 AND status!='building' ORDER BY created_at DESC LIMIT 30").all<Launch>()).results.map(publicLaunch);
  const counts=await db().prepare("SELECT (SELECT COUNT(*) FROM triple_groups WHERE status='live') AS groups,(SELECT COUNT(*) FROM triple_launches WHERE status='finalized') AS launches,(SELECT COUNT(*) FROM triple_launches WHERE status='finalized' AND slot>0) AS pairs").first<{groups:number;launches:number;pairs:number}>();
  const open=await db().prepare("SELECT COUNT(*) AS n FROM triple_groups g WHERE g.status='live' AND NOT EXISTS(SELECT 1 FROM triple_launches l WHERE l.group_id=g.id AND (l.slot=2 AND l.status='finalized' OR l.active=1))").first<{n:number}>();
  return {...page,...creations,updatedGroups,pending,total:counts?.launches||0,totalGroups:counts?.groups||0,totalPairs:counts?.pairs||0,openGroups:open?.n||0,uploads:!!runtime().BUCKET,reconciliationError,network:'mainnet-beta',...await ownerStatus()};
}
export async function creationPage(before=Number.MAX_SAFE_INTEGER){
  const rows=(await db().prepare("SELECT * FROM triple_launches WHERE status='finalized' AND sequence<? ORDER BY sequence DESC LIMIT 61").bind(before).all<Launch>()).results;
  const launches=rows.slice(0,60).map(publicLaunch);
  return {launches,hasMoreCreations:rows.length>60,nextCreationCursor:launches.at(-1)?.sequence??null};
}
export async function olderFeed(before:number){return groupPage(before);}
export async function prepare(req: Request) {
  const {p,payload,user}=await walletPayload(req,'Prepare Triple Pairs launch');
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
  if(!['main','pair','auto'].includes(p.mode))throw new Error('Choose a new main coin or an available pair slot.');
  if(p.mode!=='main')await reconcile(undefined,typeof p.groupId==='string'?p.groupId:undefined);
  const target=p.mode==='main'?null:await pairTarget(p);
  const tail=target?.predecessor||null,groupId=target?.group.id||crypto.randomUUID(),slot=target?.slot??0;
  const id=crypto.randomUUID(),mint=Keypair.generate(),authHash=createHash('sha256').update(payload).digest('hex'),now=Date.now();
  const reservation=db().prepare("INSERT INTO triple_launches(id,auth_hash,group_id,slot,slot_key,owner,mint,name,symbol,uri,description,image,predecessor,dev_buy,slippage,status,active,created_at,build_until) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'building',1,?,? WHERE EXISTS(SELECT 1 FROM triple_groups WHERE id=? AND status=?) AND (?=0 OR (?=1 AND NOT EXISTS(SELECT 1 FROM triple_launches WHERE group_id=? AND slot>0 AND status='finalized')) OR (?=2 AND EXISTS(SELECT 1 FROM triple_launches WHERE group_id=? AND slot=1 AND status='finalized' AND mint=?)))")
    .bind(id,authHash,groupId,slot,groupId+':'+slot,user.toBase58(),mint.publicKey.toBase58(),name,symbol,uri,description,image,tail?.mint||null,devBuy,slippage,now,now+60000,groupId,slot===0?'pending':'live',slot,slot,groupId,slot,groupId,tail?.mint||'');
  try{
    if(slot===0){
      const results=await db().batch([
        db().prepare("INSERT INTO triple_groups(id,mint,name,symbol,image,description,owner,source,status,created_at) SELECT ?,?,?,?,?,?,?,'launched','pending',? WHERE (SELECT COUNT(*) FROM triple_groups WHERE owner=? AND created_at>?)<10").bind(groupId,mint.publicKey.toBase58(),name,symbol,image,description,user.toBase58(),now,user.toBase58(),now-600000),reservation,
      ]);
      if(!results[1].meta.changes)throw new Error('Main coin limit reached.');
    }else if(!(await reservation.run()).meta.changes)throw new Error('Group changed');
  }catch{throw new Error('This slot is reserved, already filled, or you already have a pending launch. Refresh and choose an open slot.');}
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
    const result=await db().prepare("UPDATE triple_launches SET status='prepared',build_until=0, quote_mint=?,quote_symbol=?,fallback=?,depth=?,last_valid=?,\"transaction\"=?,setup_transaction=? WHERE id=? AND status='building' AND active=1").bind(quote.mint.toBase58(),quoteSymbol,fallback,quote.pumpQuote?.depth||0,latest.lastValidBlockHeight,serialized,setupTransaction,id).run();
    if (!result.meta.changes) throw new Error('Preparation expired. Please try again.');
    return {id,groupId,slot,transaction:serialized,setupTransaction,setupRent,mint:mint.publicKey.toBase58(),name,symbol,predecessor:tail?.mint||null,quoteMint:quote.mint.toBase58(),quoteSymbol,fallback,devBuy,slippage,tokens,lastValidBlockHeight:latest.lastValidBlockHeight,network:'mainnet-beta',maxDevBuy:units.muln(100+slippage).divn(100).toString(),decimals:quote.decimals};
  } catch(e) {
    await db().prepare("UPDATE triple_launches SET status='failed',active=NULL,slot_key=NULL,error=? WHERE id=? AND status='building'").bind(rpcFailure(e)?.message||(e instanceof Error?e.message:'Preparation failed'),id).run();
    if(slot===0)await db().prepare("UPDATE triple_groups SET status='failed' WHERE id=? AND status='pending'").bind(groupId).run();
    throw e;
  }
}
export async function submit(req: Request) {
  sameOrigin(req);
  const body=await req.text(); if(body.length>8000) throw new Error('Invalid signed transaction.');
  const {id,transaction,kind}=JSON.parse(body) as {id:string;transaction:string;kind?:string};
  if (typeof transaction!=='string'||transaction.length>5000) throw new Error('Invalid signed transaction.');
  const row=await db().prepare('SELECT * FROM triple_launches WHERE id=?').bind(id).first<Launch>();
  if (!row||!row.transaction||!['prepared','submitted'].includes(row.status)) throw new Error('Launch slot is no longer available.');
  const expected=kind==='setup'?row.setup_transaction:row.transaction;
  if(!expected) throw new Error('No setup transaction is required.');
  const tx=VersionedTransaction.deserialize(Buffer.from(transaction,'base64')), original=VersionedTransaction.deserialize(Buffer.from(expected,'base64'));
  if (!Buffer.from(tx.message.serialize()).equals(Buffer.from(original.message.serialize()))||!verifyTransaction(tx)) throw new Error('The wallet-signed transaction does not match the launch you reviewed.');
  const sig=base58(tx.signatures[0]);
  // Reuse the preparation lease field after preparation has completed. A short
  // database lease prevents competing broadcasts and contradictory preflight outcomes.
  const lease=Date.now()+20000;
  const locked=await db().prepare("UPDATE triple_launches SET build_until=? WHERE id=? AND active=1 AND build_until<? RETURNING signature,setup_signature").bind(lease,id,Date.now()).first<{signature:string|null;setup_signature:string|null}>();
  if(!locked)return {id,signature:sig,status:'submitted',message:'A broadcast is already in progress. Its confirmation is being tracked.'};
  try{
  if(kind==='setup') await db().prepare('UPDATE triple_launches SET setup_signature=? WHERE id=? AND active=1').bind(sig,id).run();
  else await db().prepare("UPDATE triple_launches SET signature=?,status='submitted' WHERE id=? AND active=1").bind(sig,id).run();
  try { await connection().sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:3}); }
  catch(e) {
    const rejection=preflightRejection(e),prior=kind==='setup'?locked.setup_signature:locked.signature;
    // A definite first-attempt preflight rejection was never broadcast. A failed retry
    // cannot disprove an earlier ambiguous send, so keep tracking that signature.
    if(rejection&&!prior){
      await db().batch([
        db().prepare("UPDATE triple_launches SET status='failed',active=NULL,slot_key=NULL,error=? WHERE id=? AND active=1").bind(rejection,id),
        db().prepare("UPDATE triple_groups SET status='failed' WHERE id=? AND status='pending' AND NOT EXISTS(SELECT 1 FROM triple_launches WHERE group_id=? AND active=1)").bind(row.group_id,row.group_id),
      ]);
      return {id,signature:sig,status:'failed',message:rejection};
    }
    return {id,signature:sig,status:'submitted',message:rejection?rejection+' Checking the earlier submission until its status is definitive.':'Broadcast was not acknowledged. We are checking Solana for this signature. You can safely retry the same signed transaction.'};
  }
  return {id,signature:sig,status:'submitted'};
  }finally{await db().prepare('UPDATE triple_launches SET build_until=0 WHERE id=? AND build_until=?').bind(id,lease).run();}
}
export function verifyTransaction(tx:VersionedTransaction) {
  return tx.signatures.every((sig,i)=>verify(null,Buffer.from(tx.message.serialize()),createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),tx.message.staticAccountKeys[i].toBuffer()]),format:'der',type:'spki'}),Buffer.from(sig)));
}
export async function setupStatus(row:Launch) {
  // A completed launch proves its lookup table was usable. Do not let a later
  // setup-status RPC outage hide an already definitive launch result.
  if(['finalized','failed','expired'].includes(row.status))return {setupReady:row.status==='finalized'&&!!row.setup_signature,setupError:null};
  if(!row.setup_signature) return {setupReady:false,setupError:null};
  const s=(await connection().getSignatureStatuses([row.setup_signature],{searchTransactionHistory:true})).value[0];
  return {setupReady:s?.confirmationStatus==='finalized'&&!s.err,setupError:s?.err?JSON.stringify(s.err):null};
}
