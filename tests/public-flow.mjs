import assert from 'node:assert/strict';
import {createPrivateKey,sign,createHash} from 'node:crypto';
import {Keypair,VersionedTransaction} from '@solana/web3.js';
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:4173';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('These write tests only run against a local preview.');
const owner={'oai-authenticated-user-id':'local-owner-test','oai-authenticated-user-email':'seedy@sites.test'};
const root='C8sJ5fZ4SFFT6WhwPRFhEj9jPRfQsyCahfcN1shgpump'; // Read-only mainnet fixture; never configured on the hosted Site.
async function request(path,body,headers={}){const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,...headers,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined});return {status:response.status,data:await response.json()};}
function authorize(user,data){const payload=JSON.stringify({domain:origin,wallet:user.publicKey.toBase58(),timestamp:Date.now(),nonce:crypto.randomUUID(),...data});const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(user.secretKey.slice(0,32))]),format:'der',type:'pkcs8'});return{payload,signature:sign(null,Buffer.from(payload),key).toString('base64')};}
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZ8AAAAASUVORK5CYII=','base64');
const users=[Keypair.generate(),Keypair.generate()];
const uploaded=[];
for(let i=0;i<2;i++){const user=users[i],name='Local image test '+i,symbol='LINK'+i,description='LOCAL PUBLIC FLOW TEST — NEVER BROADCAST';const data={action:'Upload Infinite Pairs artwork',imageHash:createHash('sha256').update(bytes).digest('hex'),name,symbol,description};const auth=authorize(user,data);const form=new FormData();form.append('file',new File([bytes],'token.png',{type:'image/png'}));form.append('payload',auth.payload);form.append('signature',auth.signature);const r=await request('/api/upload',form);assert.equal(r.status,200,JSON.stringify(r.data));const meta=await(await fetch(r.data.uri)).json();assert.equal(meta.name,name);assert.equal(meta.image,r.data.image);const image=await fetch(meta.image);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);uploaded.push({...r.data,name,symbol,description});}
assert.notEqual((await request('/api/base',{mint:root})).status,200,'Anonymous visitors cannot change the root CA');
assert.equal((await request('/api/feed')).data.owner,false);
assert.equal((await request('/api/feed',undefined,owner)).data.owner,true);
const configured=await request('/api/base',{mint:root},owner);assert.equal(configured.status,200,JSON.stringify(configured.data));assert.equal(configured.data.base.mint,root);
const bad=authorize(users[0],{action:'Prepare Infinite Pairs launch',...uploaded[0],name:'changed',devBuy:'0',slippage:1});assert.equal((await request('/api/prepare',bad)).status,400,'Metadata mismatches must be rejected');
const result=await Promise.all(users.map((u,i)=>request('/api/prepare',authorize(u,{action:'Prepare Infinite Pairs launch',...uploaded[i],devBuy:'0',slippage:1}))));
assert.equal(result.filter(r=>r.status===200).length,1,JSON.stringify(result));
const launch=result.find(r=>r.status===200).data;
assert.equal(launch.predecessor,root,'The first new coin must use the configured root CA');assert.equal(launch.quoteMint,root,'An eligible root must be the actual Pump.fun quote');assert.equal(launch.fallback,null);
assert(VersionedTransaction.deserialize(Buffer.from(launch.transaction,'base64')).serialize().length<=1232);
assert.notEqual((await request('/api/base',{mint:root},owner)).status,200,'Root cannot be changed during an active launch');
assert.equal((await request('/api/submit',{id:launch.id,transaction:launch.transaction})).status,400);
const feed=(await request('/api/feed')).data;assert.equal(feed.total,0);assert.equal(feed.base.mint,root);assert.equal(feed.uploads,true);
console.log('PASS: signed image import, anonymous image/JSON access, immutable matching metadata, owner-only CA update, CA locking, first-token CA pairing, cross-wallet launch serialization, unsigned rejection, pending exclusion from live list.');
console.log('No transaction was broadcast. All write operations targeted localhost.');
