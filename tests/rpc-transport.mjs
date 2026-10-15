import assert from 'node:assert/strict';
import {Connection,PublicKey} from '@solana/web3.js';
import {createRpcFetch,rpcFailure,missingTokenAccount} from '../app/lib/rpc.ts';
const endpoint='http://127.0.0.1:9999';
const call=(method='getAccountInfo')=>({method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:'test',method,params:[]})});
const ok=()=>Response.json({jsonrpc:'2.0',id:'test',result:123});
function clock(){let time=100000;const sleeps=[];return {now:()=>time,sleeps,sleep:async ms=>{sleeps.push(ms);time+=ms;},advance:ms=>{time+=ms;}};}
{
 const c=clock(),starts=[];let calls=0;
 const f=createRpcFetch({...c,cooldowns:new Map(),fetch:async()=>{starts.push(c.now());return calls++===0?new Response('busy',{status:429,headers:{'Retry-After':'1'}}):ok();}});
 assert.equal((await f(endpoint,call())).status,200);assert.equal(calls,2);assert(starts[1]-starts[0]>=1000,'Honor Retry-After');
}
{
 const c=clock(),shared=new Map();let calls=0;
 const f=createRpcFetch({...c,cooldowns:shared,fetch:async()=>{calls++;return new Response('busy',{status:429,headers:{'Retry-After':'60'}});}});
 await assert.rejects(f(endpoint,call()),/RPC_BUSY:60/);assert.equal(calls,1);assert.equal(c.sleeps.length,0);
 const other=createRpcFetch({...c,cooldowns:shared,fetch:async()=>{calls++;return ok();}});
 await assert.rejects(other(endpoint,call()),/RPC_BUSY:60/);assert.equal(calls,1,'Cooldown protects the provider across connections');
 c.advance(60000);assert.equal((await other(endpoint,call())).status,200);
}
{
 const c=clock();let calls=0;
 const f=createRpcFetch({...c,cooldowns:new Map(),fetch:async()=>{calls++;return new Response('busy',{status:429});}});
 await assert.rejects(f(endpoint,call()),/RPC_BUSY:15/);assert.equal(calls,3,'Retries are bounded');assert.deepEqual(c.sleeps,[1000,2000]);
}
{
 const c=clock();let calls=0;
 const f=createRpcFetch({...c,cooldowns:new Map(),fetch:async()=>{calls++;return new Response('busy',{status:429,headers:{'Retry-After':'1'}});}});
 await assert.rejects(f(endpoint,call('sendTransaction')),/RPC_BUSY/);assert.equal(calls,1,'Never replay a signed transaction automatically');
}
{
 const c=clock();let calls=0;
 const f=createRpcFetch({...c,cooldowns:new Map(),fetch:async()=>calls++===0?Response.json({error:{code:-32005,message:'Rate limit exceeded'}}):ok()});
 assert.equal((await f(endpoint,call())).status,200);assert.equal(calls,2,'Handle JSON-RPC throttling even with HTTP 200');
}
{
 const c=clock(),starts=[];
 const f=createRpcFetch({...c,cooldowns:new Map(),fetch:async()=>{starts.push(c.now());await Promise.resolve();return ok();}});
 await Promise.all([f(endpoint,call()),f(endpoint,call()),f(endpoint,call())]);assert.deepEqual(starts,[100000,100200,100400],'Space concurrent calls');
}
{
 const c=clock();
 const rpc=new Connection(endpoint,{disableRetryOnRateLimit:true,fetch:createRpcFetch({...c,cooldowns:new Map(),fetch:async()=>new Response('Provider request id and upgrade URL',{status:429,headers:{'Retry-After':'30'}})})});
 let error;try{await rpc.getAccountInfo(new PublicKey('11111111111111111111111111111111'));}catch(e){error=e;}
 assert(error);const safe=rpcFailure(error);assert.equal(safe.retryAfter,30);assert(!safe.message.includes('11111111'));assert(!safe.message.includes('Provider'));
 assert.equal(missingTokenAccount(error),false,'A rate limit is never a zero balance');assert.equal(missingTokenAccount(new Error('Invalid param: could not find account')),true);
 assert.equal(rpcFailure(new Error('Not enough tokens')),null);
}
{
 const c=clock();const f=createRpcFetch({...c,cooldowns:new Map(),fetch:async()=>new Response('temporarily down',{status:503})});
 await assert.rejects(f(endpoint,call()),/RPC_UNAVAILABLE/);
}
console.log('PASS: bounded read retries, Retry-After, shared cooldown, request pacing, JSON-RPC throttling, no send replay, sanitized web3 errors, accurate balance errors, and provider outages. No network or transactions.');
