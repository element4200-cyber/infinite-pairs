import {uploadArtwork,artwork} from '../../lib/artwork';
import {rpcFailure} from '../../lib/rpc';
import { prepare, submit, feed, olderFeed, db, reconcile, publicLaunch, setupStatus, sameOrigin, runtime, setBase, type Launch } from '../../lib/launches';
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
function failure(error:unknown,status:number){const rpc=rpcFailure(error);return rpc?Response.json({error:rpc.message,retryAfter:rpc.retryAfter},{status:503,headers:{'Cache-Control':'no-store','Retry-After':String(rpc.retryAfter)}}):json({error:error instanceof Error?error.message:'Service temporarily unavailable'},status);}
export async function GET(req:Request) {
  try {
    const url=new URL(req.url), path=url.pathname;
    if(path.startsWith('/api/assets/'))return artwork(path);
    if(path==='/api/feed') return json(url.searchParams.has('before')?await olderFeed(Math.max(1,Number(url.searchParams.get('before'))||1)):await feed());
    if(path.startsWith('/api/launch/')) {
      await reconcile();
      const row=await db().prepare('SELECT * FROM launches WHERE id=?').bind(path.split('/').pop()).first<Launch>();
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
    if(path==='/api/base')return json(await setBase(req));
    return json({error:'Not found'},404);
  } catch(e) { return failure(e,400); }
}
