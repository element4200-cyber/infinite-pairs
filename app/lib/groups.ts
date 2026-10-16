import {Buffer} from 'node:buffer';
import {createPublicKey,verify} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getTokenMetadata} from '@solana/spl-token';
import {bondingCurvePda,PUMP_PROGRAM_ID,PUMP_SDK} from '@pump-fun/pump-sdk';
import {db,connection,sameOrigin,publicLaunch,type Launch} from './launches';
import {nextPairSlot,pairPredecessor} from './triple-rules';
export type Group={id:string;mint:string;name:string;symbol:string;image:string;description:string;owner:string;source:string;status:string;sequence:number;created_at:number;finalized_at:number};
export async function walletPayload(req:Request,action:string){
  sameOrigin(req);const raw=await req.text();if(raw.length>20000)throw new Error('Request is too large.');
  const {payload,signature}=JSON.parse(raw);
  if(typeof payload!=='string'||payload.length>12000||typeof signature!=='string'||signature.length>100)throw new Error('Invalid wallet authorization.');
  const p=JSON.parse(payload),user=new PublicKey(p.wallet);
  if(p.domain!==new URL(req.url).origin||p.action!==action||!Number.isFinite(p.timestamp)||Math.abs(Date.now()-p.timestamp)>300000)throw new Error('Wallet authorization expired. Please try again.');
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),user.toBuffer()]),format:'der',type:'spki'});
  if(!verify(null,Buffer.from(payload),key,Buffer.from(signature,'base64')))throw new Error('Wallet authorization failed.');
  return {p,payload,user};
}
export async function importMain(req:Request){
  const {p,user}=await walletPayload(req,'Add Triple Pairs main coin');
  const mint=new PublicKey(p.mint),rpc=connection();
  const used=await db().prepare("SELECT id FROM triple_launches WHERE mint=? AND (status='finalized' OR active=1) LIMIT 1").bind(mint.toBase58()).first();
  if(used)throw new Error('This coin already belongs to a triple. Choose a different main CA.');
  const [curve,account]=await rpc.getMultipleAccountsInfo([bondingCurvePda(mint),mint],'finalized');
  if(!curve||!account||!curve.owner.equals(PUMP_PROGRAM_ID)||![TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].some(k=>k.equals(account.owner)))throw new Error('This CA is not a verified live Pump.fun coin on Solana mainnet.');
  PUMP_SDK.decodeBondingCurve(curve);
  let onchain:{name:string;symbol:string}|null=null;
  if(account.owner.equals(TOKEN_2022_PROGRAM_ID))onchain=await getTokenMetadata(rpc,mint,'finalized',TOKEN_2022_PROGRAM_ID);
  const name=String(onchain?.name||p.name||'Main '+mint.toBase58().slice(0,6)).trim();
  const symbol=String(onchain?.symbol||p.symbol||'MAIN').trim();
  if(!name||Buffer.byteLength(name)>32||!symbol||Buffer.byteLength(symbol)>13)throw new Error('Use a display name up to 32 bytes and a ticker up to 13 bytes.');
  const id=crypto.randomUUID(),now=Date.now();
  try{
    const result=await db().prepare("INSERT INTO triple_groups(id,mint,name,symbol,image,description,owner,source,status,sequence,created_at,finalized_at) SELECT ?,?,?,?,'','',?,'imported','live',(SELECT COALESCE(MAX(sequence),0)+1 FROM triple_groups),?,? WHERE (SELECT COUNT(*) FROM triple_groups WHERE owner=? AND created_at>?)<10 AND NOT EXISTS(SELECT 1 FROM triple_launches WHERE mint=? AND (status='finalized' OR active=1))")
      .bind(id,mint.toBase58(),name,symbol,user.toBase58(),now,now,user.toBase58(),now-600000,mint.toBase58()).run();
    if(!result.meta.changes)throw new Error('This coin already has a group, or the main-coin limit was reached. Please choose a new CA or wait a few minutes.');
  }catch(e){if(String(e).includes('UNIQUE'))throw new Error('This CA already has a main coin group. Find it in Tokens launched.');throw e;}
  return {id,mint:mint.toBase58(),name,symbol};
}
export async function pairTarget(p:{mode?:string;groupId?:string;slot?:number}){
  let group:Group|null=null;
  if(p.mode==='auto')group=await db().prepare("SELECT g.* FROM triple_groups g WHERE g.status='live' AND NOT EXISTS(SELECT 1 FROM triple_launches l WHERE l.group_id=g.id AND (l.slot=2 AND l.status='finalized' OR l.active=1)) ORDER BY MAX(g.finalized_at,COALESCE((SELECT MAX(finalized_at) FROM triple_launches WHERE group_id=g.id AND status='finalized'),0)) DESC,g.sequence DESC LIMIT 1").first<Group>();
  else if(p.mode==='pair'&&typeof p.groupId==='string')group=await db().prepare("SELECT * FROM triple_groups WHERE id=? AND status='live'").bind(p.groupId).first<Group>();
  if(!group)throw new Error('No open group is available. Start a new main coin.');
  const tokens=(await db().prepare("SELECT slot,mint,symbol FROM triple_launches WHERE group_id=? AND status='finalized' AND slot>0").bind(group.id).all<{slot:number;mint:string;symbol:string}>()).results;
  const slot=p.mode==='auto'?nextPairSlot(tokens):p.slot;
  if(slot==null)throw new Error('This group is complete. Start a new main coin.');
  const predecessor=pairPredecessor(group,tokens,slot);
  return {group,slot,predecessor};
}
export async function groupPage(before?:number){
  const groups=(await db().prepare("SELECT * FROM triple_groups WHERE status='live' AND sequence<? ORDER BY sequence DESC LIMIT 41").bind(before??Number.MAX_SAFE_INTEGER).all<Group>()).results;
  const visible=groups.slice(0,40);
  return {groups:await decorateGroups(visible),hasMore:groups.length>40,nextCursor:visible.at(-1)?.sequence??null};
}
async function decorateGroups(groups:Group[]){
  const tokens=groups.length?(await db().prepare(`SELECT * FROM triple_launches WHERE group_id IN (${groups.map(()=>'?').join(',')}) AND (status='finalized' OR active=1) ORDER BY slot`).bind(...groups.map(g=>g.id)).all<Launch>()).results:[];
  return groups.map(g=>({...g,tokens:tokens.filter(t=>t.group_id===g.id).map(publicLaunch)}));
}
export async function changedGroups(ids:string[]){
  if(!ids.length)return [];
  const groups=(await db().prepare(`SELECT * FROM triple_groups WHERE status='live' AND id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all<Group>()).results;
  return decorateGroups(groups);
}
export async function availablePage(before=Number.MAX_SAFE_INTEGER){
  const rows=(await db().prepare(`SELECT g.id AS groupId,g.name AS groupName,g.symbol AS groupSymbol,g.sequence,
    COALESCE(p.mint,g.mint) AS mint,COALESCE(p.name,g.name) AS name,COALESCE(p.symbol,g.symbol) AS symbol,
    CASE WHEN p.id IS NULL THEN 1 ELSE 2 END AS slot,CASE WHEN p.id IS NULL THEN 2 ELSE 1 END AS spaces
    FROM triple_groups g LEFT JOIN triple_launches p ON p.group_id=g.id AND p.slot=1 AND p.status='finalized'
    WHERE g.status='live' AND g.sequence<? AND NOT EXISTS(
      SELECT 1 FROM triple_launches l WHERE l.group_id=g.id AND (l.active=1 OR l.slot=2 AND l.status='finalized'))
    ORDER BY g.sequence DESC LIMIT 81`).bind(before).all()).results;
  const options=rows.slice(0,80);
  return {options,hasMore:rows.length>80,nextCursor:options.at(-1)?.sequence??null};
}
