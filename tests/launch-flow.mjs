import assert from 'node:assert/strict';
import {createPrivateKey,sign,verify,createPublicKey} from 'node:crypto';
import {Keypair,VersionedTransaction} from '@solana/web3.js';
import {baseUnits,base58,fallbackReason,validUri} from '../app/lib/rules.ts';
assert.equal(baseUnits('0.100000001',9),'100000001');assert.equal(baseUnits('100.25',6),'100250000');assert.throws(()=>baseUnits('0.0000001',6));assert.throws(()=>baseUnits('-1',9));assert.throws(()=>baseUnits('1e9',9));
assert.equal(base58(new Uint8Array([0,0,1])),'112');assert(validUri('ipfs://bafytest/metadata.json'));assert(!validUri('javascript:alert(1)'));assert(!validUri('https://example.com/'+'x'.repeat(200)));
const depthError=new Error('depth');depthError.name='CurveDepthExceededError';assert(fallbackReason(depthError));assert.equal(fallbackReason(new Error('RPC unavailable')),null);const migration=new Error();migration.name='QuoteCurveAwaitingMigrationError';assert.equal(fallbackReason(migration),null);
console.log('Precision, URI validation, base58, and eligibility-only fallback checks passed.');
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:5173';
async function post(path,body){const r=await fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};}
const unsigned=await post('/api/prepare',{payload:'{}',signature:''});assert.equal(unsigned.status,400);
const users=[Keypair.generate(),Keypair.generate()];
function auth(user,name='Infinite Pairs') {const payload=JSON.stringify({domain:origin,action:'Prepare Infinite Pairs launch',wallet:user.publicKey.toBase58(),name,symbol:'INFINITE',uri:'https://example.com/'+'m'.repeat(170),description:'LOCAL API TEST — NEVER BROADCAST',image:'',devBuy:'0.1',slippage:1,timestamp:Date.now(),nonce:crypto.randomUUID()});const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(user.secretKey.slice(0,32))]),format:'der',type:'pkcs8'});return{payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')};}
assert.equal((await post('/api/prepare',auth(users[0],'Not the genesis'))).status,400);
const results=await Promise.all(users.map(u=>post('/api/prepare',auth(u))));
assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results.map(x=>({status:x.status,error:x.data.error}))));assert.equal(results.filter(r=>r.status===400).length,1);
const prepared=results.find(r=>r.status===200).data;assert.equal(prepared.quoteSymbol,'SOL');assert(prepared.setupTransaction,'Long create + dev buy must request lookup-table setup');
const tx=VersionedTransaction.deserialize(Buffer.from(prepared.transaction,'base64'));assert(tx.serialize().length<=1232);const setup=VersionedTransaction.deserialize(Buffer.from(prepared.setupTransaction,'base64'));assert(setup.serialize().length<=1232);assert(prepared.setupRent>0);
assert(tx.signatures[0].every(b=>b===0),'Wallet must not be signed by the server');assert(tx.signatures[1].some(b=>b!==0),'Mint must be partially signed');
const pub=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),tx.message.staticAccountKeys[1].toBuffer()]),format:'der',type:'spki'});assert(verify(null,Buffer.from(tx.message.serialize()),pub,Buffer.from(tx.signatures[1])));
assert.equal((await post('/api/submit',{id:prepared.id,transaction:prepared.transaction})).status,400,'Unsigned transaction must be rejected');
tx.message.recentBlockhash=Keypair.generate().publicKey.toBase58();assert.equal((await post('/api/submit',{id:prepared.id,transaction:Buffer.from(tx.serialize()).toString('base64')})).status,400,'Tampered message must be rejected');
const feed=await(await fetch(origin+'/api/feed')).json();assert.equal(feed.total,0,'Prepared tokens must never appear as live launches');assert(feed.active);
console.log('API checks passed: signed authorization, genesis reservation, concurrent-wallet serialization, v0 transaction sizing, lookup-table rent, mint partial signature, unsigned/tampered rejection, and finalized-only feed.');console.log('No transaction was broadcast.');
