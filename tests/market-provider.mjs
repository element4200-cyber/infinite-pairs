import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {PublicKey} from '@solana/web3.js';
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:4173',file=process.env.TEST_DB,mint=process.env.TEST_MARKET_MINT;
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname)||!file||!mint)throw Error('Requires localhost, disposable TEST_DB, and a public TEST_MARKET_MINT.');
const target=path.resolve(file);if(!target.startsWith(path.resolve('.wrangler/triple-state')+path.sep)||!target.endsWith('.sqlite'))throw Error('Only the isolated local database is allowed.');
new PublicKey(mint);const db=new DatabaseSync(target),id='local-market-provider-probe';db.exec('PRAGMA busy_timeout=5000');
try{
 db.prepare("INSERT INTO triple_groups(id,mint,name,symbol,owner,source,status,sequence,created_at,finalized_at) VALUES(?,?,'LOCAL MARKET READ PROBE','PROBE','local-test','synthetic','live',987654321,1,1)").run(id,mint);
 const r=await fetch(origin+'/api/markets?mints='+mint),d=await r.json();assert.equal(r.status,200);
 assert(d.markets[mint].usd>0,'A live public token should have a numeric USD market cap');assert(d.markets[mint].source);
 console.log('PASS: Worker API returns real provider USD market cap with source and timestamp.',JSON.stringify(d.markets[mint]));
}finally{db.prepare('DELETE FROM triple_groups WHERE id=?').run(id);db.close();}
