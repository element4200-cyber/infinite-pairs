import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash,createPrivateKey,sign} from 'node:crypto';
import {Connection,Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {PUMP_SDK,PUMP_PROGRAM_ID,GLOBAL_PDA,PUMP_FEE_CONFIG_PDA,QUOTE_CONTROL_PDA,bondingCurvePda,newBondingCurve} from '@pump-fun/pump-sdk';
import {base58,SOL} from '../app/lib/rules.ts';
import {nextPairSlot,pairPredecessor} from '../app/lib/triple-rules.ts';
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:4173';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw Error('Write tests are strictly localhost-only.');
assert.equal(nextPairSlot([]),1);assert.equal(nextPairSlot([{slot:1}]),2);assert.equal(nextPairSlot([{slot:1},{slot:2}]),null);assert.throws(()=>pairPredecessor({mint:'root'},[],2));assert.throws(()=>pairPredecessor({mint:'root'},[],3));
const cache='.wrangler/triple-rpc-fixture.json',keys=[GLOBAL_PDA,PUMP_FEE_CONFIG_PDA,QUOTE_CONTROL_PDA,new PublicKey(SOL)];
let fixture;
if(existsSync(cache))fixture=JSON.parse(readFileSync(cache,'utf8'));
else{
 const rpc=new Connection('https://solana-rpc.publicnode.com',{disableRetryOnRateLimit:true,fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})});
 fixture=(await rpc.getMultipleAccountsInfo(keys)).map(a=>a?{data:[a.data.toString('base64'),'base64'],owner:a.owner.toBase58(),lamports:a.lamports,executable:false,rentEpoch:0}:null);
 writeFileSync(cache,JSON.stringify(fixture));
}
const toInfo=a=>({...a,owner:new PublicKey(a.owner),data:Buffer.from(a.data[0],'base64')});
const global=PUMP_SDK.decodeGlobal(toInfo(fixture[0])),quoteControl=fixture[2]?PUMP_SDK.decodeQuoteControl(toInfo(fixture[2])):null;
const accounts=new Map(keys.map((k,i)=>[k.toBase58(),fixture[i]])),sent=new Map();let height=100,inject429=true,sendCount=0;
async function addMockCoin(mint,quote=SOL,depth=0,mayhem=false){
 const key=new PublicKey(mint),data=Buffer.alloc(82);data.writeBigUInt64LE(1000000000000000n,36);data[44]=6;data[45]=1;
 accounts.set(mint,{data:[data.toString('base64'),'base64'],owner:TOKEN_PROGRAM_ID.toBase58(),lamports:1000000,executable:false,rentEpoch:0});
 const curve={...newBondingCurve(global,new PublicKey(SOL),quoteControl),quoteMint:quote===SOL?PublicKey.default:new PublicKey(quote),depth,complete:false,isMayhemMode:mayhem};
 const bytes=await PUMP_SDK.offlinePumpProgram.coder.accounts.encode('bondingCurve',curve);
 accounts.set(bondingCurvePda(key).toBase58(),{data:[bytes.toString('base64'),'base64'],owner:PUMP_PROGRAM_ID.toBase58(),lamports:1000000,executable:false,rentEpoch:0});
}
const imported=Keypair.generate().publicKey.toBase58();await addMockCoin(imported);
const mock=createServer(async(req,res)=>{try{
 let text='';for await(const chunk of req)text+=chunk;const r=JSON.parse(text);let result;
 if(inject429&&r.method==='getMultipleAccounts'){inject429=false;res.writeHead(429,{'Content-Type':'application/json','Retry-After':'1'});res.end(JSON.stringify({error:{message:'Local simulated rate limit'}}));return;}
 const context={slot:1000};
 if(r.method==='getMultipleAccounts')result={context,value:r.params[0].map(k=>accounts.get(k)??null)};
 else if(r.method==='getAccountInfo')result={context,value:accounts.get(r.params[0])??null};
 else if(r.method==='getLatestBlockhash')result={context,value:{blockhash:SOL,lastValidBlockHeight:250}};
 else if(r.method==='getBlockHeight')result=height;
 else if(r.method==='getSlot')result=1000;
 else if(r.method==='getMinimumBalanceForRentExemption')result=1000000;
 else if(r.method==='getTokenAccountBalance')result={context,value:{amount:'1000000000000000',decimals:6,uiAmount:1000000000}};
 else if(r.method==='sendTransaction'){
   const tx=VersionedTransaction.deserialize(Buffer.from(r.params[0],'base64'));result=base58(tx.signatures[0]);sent.set(result,tx);sendCount++;
 }else if(r.method==='getSignatureStatuses')result={context,value:r.params[0].map(s=>sent.has(s)?{slot:1000,confirmations:null,err:null,confirmationStatus:'finalized'}:null)};
 else if(r.method==='getTransaction'){
   const tx=sent.get(r.params[0]);if(!tx)result=null;else{const m=tx.message;result={slot:1000,blockTime:Math.floor(Date.now()/1000),version:0,meta:{err:null,fee:5000,preBalances:m.staticAccountKeys.map(()=>0),postBalances:m.staticAccountKeys.map(()=>0),loadedAddresses:{writable:[],readonly:[]}},transaction:{signatures:tx.signatures.map(base58),message:{accountKeys:m.staticAccountKeys.map(k=>k.toBase58()),header:m.header,recentBlockhash:m.recentBlockhash,instructions:m.compiledInstructions.map(ix=>({programIdIndex:ix.programIdIndex,accounts:[...ix.accountKeyIndexes],data:base58(ix.data)})),addressTableLookups:m.addressTableLookups.map(l=>({accountKey:l.accountKey.toBase58(),readonlyIndexes:[...l.readonlyIndexes],writableIndexes:[...l.writableIndexes]}))}}};}
 }else if(r.method==='getSignaturesForAddress')result=[];
 else throw Error('Unexpected simulated RPC method: '+r.method);
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}
});
await new Promise(resolve=>mock.listen(4199,'127.0.0.1',resolve));
const users=Array.from({length:7},()=>Keypair.generate());
function auth(user,action,data){const payload=JSON.stringify({domain:origin,wallet:user.publicKey.toBase58(),action,timestamp:Date.now(),nonce:crypto.randomUUID(),...data});const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(user.secretKey.slice(0,32))]),format:'der',type:'pkcs8'});return {payload,signature:sign(null,Buffer.from(payload),key).toString('base64')};}
async function request(path,body){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined});return {status:r.status,data:await r.json()};}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZ8AAAAASUVORK5CYII=','base64');
async function artwork(user,name){const data={name,symbol:name.replace(/\s/g,'').slice(0,8).toUpperCase(),description:'SYNTHETIC LOCAL TEST ONLY'};const signed=auth(user,'Upload Triple Pairs artwork',{...data,imageHash:createHash('sha256').update(png).digest('hex')});const form=new FormData();form.append('file',new File([png],'test.png',{type:'image/png'}));form.append('payload',signed.payload);form.append('signature',signed.signature);const r=await request('/api/upload',form);assert.equal(r.status,200,JSON.stringify(r));assert.equal((await(await fetch(r.data.uri)).json()).name,name);return {...data,...r.data};}
async function prepare(user,metadata,choice,devBuy='0'){return request('/api/prepare',auth(user,'Prepare Triple Pairs launch',{...metadata,...choice,devBuy,slippage:1}));}
async function finalize(user,prepared){
 for(const kind of prepared.setupTransaction?['setup','launch']:['launch']){
  const tx=VersionedTransaction.deserialize(Buffer.from(kind==='setup'?prepared.setupTransaction:prepared.transaction,'base64'));tx.sign([user]);
  const sent=await request('/api/submit',{id:prepared.id,transaction:Buffer.from(tx.serialize()).toString('base64'),...(kind==='setup'?{kind}: {})});assert.equal(sent.status,200,JSON.stringify(sent));
  if(kind==='launch')await addMockCoin(prepared.mint,prepared.quoteMint,prepared.quoteMint===SOL?0:prepared.slot);
  await new Promise(resolve=>setTimeout(resolve,5200));
  const row=await request('/api/launch/'+prepared.id);assert.equal(row.status,200,JSON.stringify(row));if(kind==='setup')assert.equal(row.data.setupReady,true);else assert.equal(row.data.status,'finalized',JSON.stringify(row));
 }
}
try{
 const initial=(await request('/api/feed')).data;assert.equal(initial.totalGroups,0);assert.equal(initial.total,0);assert.equal('base' in initial,false,'No global CA remains');
 const added=await request('/api/groups',auth(users[0],'Add Triple Pairs main coin',{mint:imported,name:'Imported main',symbol:'IMPORT'}));assert.equal(added.status,200,JSON.stringify(added));
 assert.equal((await request('/api/groups',auth(users[1],'Add Triple Pairs main coin',{mint:imported}))).status,400,'Duplicate CA cannot create extra pair slots');
 const meta=await Promise.all(users.map((u,i)=>artwork(u,'Local '+i)));
 assert.equal((await prepare(users[0],meta[0],{mode:'pair',groupId:added.data.id,slot:2})).status,400,'Pair 2 cannot skip Pair 1');
 const race=await Promise.all([prepare(users[0],meta[0],{mode:'pair',groupId:added.data.id,slot:1}),prepare(users[1],meta[1],{mode:'pair',groupId:added.data.id,slot:1})]);
 assert.equal(race.filter(r=>r.status===200).length,1,JSON.stringify(race));const winning=race.findIndex(r=>r.status===200),pair1=race[winning].data;
 assert.equal(pair1.predecessor,imported);assert.equal(pair1.quoteMint,imported);
 const roots=await Promise.all([prepare(users[2],meta[2],{mode:'main'},'0.001'),prepare(users[3],meta[3],{mode:'main'})]);for(const r of roots){assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.predecessor,null);assert.equal(r.data.quoteMint,SOL);}
 assert.equal((await request('/api/submit',{id:pair1.id,transaction:pair1.transaction})).status,400,'Unsigned wallet transaction must be rejected');
 await finalize(users[winning],pair1);
 assert.equal((await request('/api/groups',auth(users[1],'Add Triple Pairs main coin',{mint:pair1.mint}))).status,400,'A pair coin cannot be reused as a main coin to bypass the cap');
 const pair2=await prepare(users[4],meta[4],{mode:'pair',groupId:added.data.id,slot:2});assert.equal(pair2.status,200,JSON.stringify(pair2));assert.equal(pair2.data.predecessor,pair1.mint);assert.equal(pair2.data.quoteMint,pair1.mint);await finalize(users[4],pair2.data);
 assert.equal((await prepare(users[5],meta[5],{mode:'pair',groupId:added.data.id,slot:3})).status,400,'No fourth coin is allowed');
 assert.equal((await prepare(users[5],meta[5],{mode:'pair',groupId:added.data.id,slot:1})).status,400,'Filled Pair 1 cannot be reused');
 await finalize(users[2],roots[0].data);await finalize(users[3],roots[1].data);
 const auto=await prepare(users[5],meta[5],{mode:'auto'});assert.equal(auto.status,200,JSON.stringify(auto));assert.equal(auto.data.groupId,roots[1].data.groupId);assert.equal(auto.data.predecessor,roots[1].data.mint);await finalize(users[5],auto.data);
 const final=(await request('/api/feed')).data;assert.equal(final.totalGroups,3);assert.equal(final.total,5);assert.equal(final.totalPairs,3);assert.equal(final.pending.length,0);assert.equal(final.groups.find(g=>g.id===added.data.id).tokens.filter(t=>t.slot>0).length,2);
 const serialized=JSON.stringify(final);assert(!serialized.includes('auth_hash'));assert(!serialized.includes('slot_key'));assert(!serialized.includes('setup_transaction'));
 const olderMeta=meta[6];
 const olderPair=await prepare(users[6],olderMeta,{mode:'pair',groupId:roots[0].data.groupId,slot:1});assert.equal(olderPair.status,200,JSON.stringify(olderPair));await finalize(users[6],olderPair.data);
 const newestCoin=await prepare(users[6],olderMeta,{mode:'auto'});assert.equal(newestCoin.status,200,JSON.stringify(newestCoin));assert.equal(newestCoin.data.groupId,roots[0].data.groupId,'Most recent coin wins even when its main group is older');assert.equal(newestCoin.data.predecessor,olderPair.data.mint);await finalize(users[6],newestCoin.data);
 const mayhemMint=Keypair.generate().publicKey.toBase58();await addMockCoin(mayhemMint,SOL,0,true);
 const mayhemGroup=await request('/api/groups',auth(users[0],'Add Triple Pairs main coin',{mint:mayhemMint,name:'Ineligible quote fixture',symbol:'LOCAL'}));assert.equal(mayhemGroup.status,200);
 const fallback=await prepare(users[0],meta[0],{mode:'pair',groupId:mayhemGroup.data.id,slot:1});assert.equal(fallback.status,200,JSON.stringify(fallback));assert.equal(fallback.data.predecessor,mayhemMint);assert.equal(fallback.data.quoteMint,SOL);assert(fallback.data.fallback);await finalize(users[0],fallback.data);
 // Keep the obsolete unconsumed-body request last: the local proxy closes its keepalive session afterward.
 assert.equal((await request('/api/base',{mint:imported})).status,404,'Legacy CA endpoint removed');
 assert(sendCount>=8);console.log('PASS: reset board, signed CA import, duplicate prevention, metadata upload, sequential pair slots, concurrent slot race, independent simultaneous groups, dev buy preparation, two-pair cap, newest-coin auto selection across older groups, explicit SOL fallback, unsigned rejection, exact-message receipt finalization, shared feed, and no private fields.');
 console.log('All writes and transaction simulations used localhost. No transaction was broadcast to Solana.');
}finally{mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));}
