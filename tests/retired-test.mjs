import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {archiveRetiredTest,retiredTest as t} from '../app/lib/retired-test.ts';
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE triple_groups(id TEXT PRIMARY KEY,mint TEXT,status TEXT,sequence INTEGER UNIQUE);
    CREATE TABLE triple_launches(id TEXT PRIMARY KEY,mint TEXT,group_id TEXT,slot INTEGER,status TEXT,active INTEGER,sequence INTEGER UNIQUE,signature TEXT);`);
  sql.prepare('INSERT INTO triple_groups VALUES(?,?,?,?)').run(t.group,t.mint,'live',1);
  sql.prepare('INSERT INTO triple_launches VALUES(?,?,?,?,?,?,?,?)').run(t.launch,t.mint,t.group,0,'finalized',null,1,'preserved-receipt');
  const wrap=statement=>({bind(...values){return {run:()=>statement.run(...values)}}});
  const db={prepare:query=>wrap(sql.prepare(query)),async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  return {sql,db};
}
{
  const {sql,db}=fixture();
  await archiveRetiredTest(db);await archiveRetiredTest(db);
  assert.deepEqual({...sql.prepare('SELECT status,sequence,signature FROM triple_launches').get()},{status:'archived',sequence:null,signature:'preserved-receipt'});
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM triple_groups WHERE status='live'").get().n,0);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM triple_launches WHERE status='finalized'").get().n,0);
  assert.equal(sql.prepare('SELECT COALESCE(MAX(sequence),0)+1 n FROM triple_groups').get().n,1);
  sql.prepare('INSERT INTO triple_groups VALUES(?,?,?,?)').run('future-group','future-test-mint','live',1);
  sql.prepare('INSERT INTO triple_launches VALUES(?,?,?,?,?,?,?,?)').run('future-launch','future-test-mint','future-group',0,'finalized',null,1,'future-receipt');
  await archiveRetiredTest(db);
  assert.equal(sql.prepare("SELECT status FROM triple_groups WHERE id='future-group'").get().status,'live');
  assert.equal(sql.prepare("SELECT status FROM triple_launches WHERE id='future-launch'").get().status,'finalized');
  sql.close();
}
for(const [status,active] of [['finalized',null],['prepared',1]]){
  const {sql,db}=fixture();
  sql.prepare('INSERT INTO triple_launches VALUES(?,?,?,?,?,?,?,?)').run('pair','pair-mint',t.group,1,status,active,2,'pair-receipt');
  await archiveRetiredTest(db);
  assert.equal(sql.prepare('SELECT status FROM triple_groups').get().status,'live');
  assert.equal(sql.prepare('SELECT status FROM triple_launches WHERE id=?').get(t.launch).status,'finalized');
  sql.close();
}
console.log('PASS: precise, repeatable test-token archival; receipts retained; fresh numbering; future launches and occupied groups preserved.');
