import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Keypair} from '@solana/web3.js';
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:4173',file=process.env.TEST_DB;
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname)||!file)throw Error('Requires localhost URL and explicit disposable TEST_DB.');
const localRoot=path.resolve('.wrangler/triple-state')+path.sep,target=path.resolve(file);
if(!target.startsWith(localRoot)||!target.endsWith('.sqlite'))throw Error('Only the isolated .wrangler/triple-state database is allowed.');
const db=new DatabaseSync(target);db.exec('PRAGMA busy_timeout=5000');
const baseline=db.prepare("SELECT * FROM triple_launches WHERE status='finalized' LIMIT 1").get();assert(baseline,'Run triple-flow first.');
const oldGroup=db.prepare("SELECT g.* FROM triple_groups g WHERE status='live' AND EXISTS(SELECT 1 FROM triple_launches l WHERE l.group_id=g.id AND slot=1 AND status='finalized') AND NOT EXISTS(SELECT 1 FROM triple_launches l WHERE l.group_id=g.id AND slot=2 AND status='finalized') LIMIT 1").get();assert(oldGroup,'Need one group with Pair 2 open.');
const originalGroups=db.prepare("SELECT COUNT(*) AS n FROM triple_groups WHERE status='live'").get().n,originalLaunches=db.prepare("SELECT COUNT(*) AS n FROM triple_launches WHERE status='finalized'").get().n;
const columns=Object.keys(baseline),insert=db.prepare(`INSERT INTO triple_launches(${columns.map(k=>'"'+k+'"').join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
function launch(data){const row={...baseline,...data};insert.run(...columns.map(k=>row[k]??null));}
async function get(url){const r=await fetch(origin+url);assert.equal(r.status,200);return r.json();}
try{
 db.exec('BEGIN');
 for(let i=0;i<67;i++){
  const id='pagination-group-'+i,mint=Keypair.generate().publicKey.toBase58(),now=Date.now()-10000+i;
  db.prepare("INSERT INTO triple_groups(id,mint,name,symbol,owner,source,status,sequence,created_at,finalized_at) VALUES(?,?,?,'LOCAL','synthetic-local-wallet','synthetic','live',?,?,?)").run(id,mint,'LOCAL PAGINATION '+i,1000+i,now,now);
  launch({id:'pagination-launch-'+i,auth_hash:'pagination-auth-'+i,group_id:id,slot:0,slot_key:id+':0',mint,name:'LOCAL PAGINATION '+i,sequence:1000+i,predecessor:null,active:null,checked_at:0});
 }
 launch({id:'pagination-new-pair',auth_hash:'pagination-new-pair',group_id:oldGroup.id,slot:2,slot_key:oldGroup.id+':2',mint:Keypair.generate().publicKey.toBase58(),name:'LOCAL OLD GROUP UPDATE',sequence:9999,active:null,finalized_at:Date.now(),checked_at:0});
 db.prepare("INSERT INTO chain_config(id,mint,name,symbol,configured_by,updated_at) VALUES(9000,'ARCHIVED-CA-DO-NOT-USE','ARCHIVED ROOT','OLD','local-test',1)").run();
 db.exec('COMMIT');
 const first=await get('/api/feed');assert.equal(first.groups.length,40);assert.equal(first.hasMore,true);assert.equal('base' in first,false);assert(!JSON.stringify(first).includes('ARCHIVED-CA-DO-NOT-USE'));
 assert(first.updatedGroups.some(g=>g.id===oldGroup.id&&g.tokens.some(t=>t.name==='LOCAL OLD GROUP UPDATE')),'New pair activity updates older groups outside the first page');
 const groupIds=new Set(first.groups.map(g=>g.id));let page=first;
 while(page.hasMore){page=await get('/api/feed?before='+page.nextCursor);for(const g of page.groups){assert(!groupIds.has(g.id));groupIds.add(g.id);}}
 assert.equal(groupIds.size,originalGroups+67,'All groups are reachable without gaps');
 const creationIds=new Set(first.launches.map(t=>t.id));page=first;
 while(page.hasMoreCreations){page=await get('/api/creations?before='+page.nextCreationCursor);for(const t of page.launches){assert(!creationIds.has(t.id));creationIds.add(t.id);}}
 assert.equal(creationIds.size,originalLaunches+68,'All creations are reachable without gaps');
 console.log('PASS: independent group and creation pagination, no duplicate/gapped entries, older-group live updates, and no archived CA in the current feed. Fixtures are localhost-only.');
}finally{
 if(db.isTransaction)db.exec('ROLLBACK');
 db.exec('BEGIN');db.prepare("DELETE FROM triple_launches WHERE id LIKE 'pagination-%'").run();db.prepare("DELETE FROM triple_groups WHERE id LIKE 'pagination-%'").run();db.prepare('DELETE FROM chain_config WHERE id=9000').run();db.exec('COMMIT');db.close();
}
