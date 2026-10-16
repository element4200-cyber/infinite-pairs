import {importMain,availablePage} from '../../lib/groups';
import {markets} from '../../lib/markets';
import {PublicKey} from '@solana/web3.js';
import {uploadArtwork,artwork} from '../../lib/artwork';
import {rpcFailure} from '../../lib/rpc';
import { prepare, submit, feed, olderFeed, creationPage, db, reconcile, publicLaunch, setupStatus, sameOrigin, runtime, type Launch } from '../../lib/launches';
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
function failure(error:unknown,status:number){const rpc=rpcFailure(error);return rpc?Response.json({error:rpc.message,retryAfter:rpc.retryAfter},{status:503,headers:{'Cache-Control':'no-store','Retry-After':String(rpc.retryAfter)}}):json({error:error instanceof Error?error.message:'Service temporarily unavailable'},status);}
export async function GET(req:Request) {
  try {
    const url=new URL(req.url), path=url.pathname;
    if(path.startsWith('/api/assets/'))return artwork(path);
    if(path==='/api/available')return json(await availablePage(Math.max(1,Number(url.searchParams.get('before'))||Number.MAX_SAFE_INTEGER)));
    if(path==='/api/markets'){
      const requested=[...new Set((url.searchParams.get('mints')||'').split(',').filter(Boolean))];
      if(requested.length>30)return json({error:'Request at most 30 tokens.'},400);
      try{requested.forEach(m=>{if(new PublicKey(m).toBase58()!==m)throw Error();});}catch{return json({error:'Invalid token address.'},400);}
      if(!requested.length)return json({markets:{}});
      const marks=requested.map(()=>'?').join(',');
      const visible=(await db().prepare(`SELECT mint FROM triple_groups WHERE status='live' AND mint IN (${marks}) UNION SELECT mint FROM triple_launches WHERE status='finalized' AND mint IN (${marks})`).bind(...requested,...requested).all<{mint:string}>()).results;
      return json({markets:await markets(visible.map(t=>t.mint))});
    }
    if(path==='/api/feed') return json(url.searchParams.has('before')?await olderFeed(Math.max(1,Number(url.searchParams.get('before'))||1)):await feed());
    if(path==='/api/creations')return json(await creationPage(Math.max(1,Number(url.searchParams.get('before'))||Number.MAX_SAFE_INTEGER)));
    if(path.startsWith('/api/launch/')) {
      await reconcile(path.split('/').pop());
      const row=await db().prepare('SELECT * FROM triple_launches WHERE id=?').bind(path.split('/').pop()).first<Launch>();
      return row?json({...publicLaunch(row),...await setupStatus(row)}):json({error:'Launch not found'},404);
    }
    return json({error:'Not found'},404);
  } catch(e) { return failure(e,503); }
}
export async function POST(req:Request) {
  try {
    const path=new URL(req.url).pathname;
    if(path==='/api/prepare') return json(await prepare(req));
    if(path==='/api/submit') return json(await submit(req));
    if(path==='/api/upload')return json(await uploadArtwork(req));
    if(path==='/api/groups')return json(await importMain(req));
    return json({error:'Not found'},404);
  } catch(e) { return failure(e,400); }
}
