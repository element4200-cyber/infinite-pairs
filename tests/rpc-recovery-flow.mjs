import assert from 'node:assert/strict';
import {createServer} from 'node:http';
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:4173';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw Error('Localhost only.');
let injected=false,alwaysLimit=false;const calls=[];
const server=createServer(async(req,res)=>{try{
 let body='';for await(const chunk of req)body+=chunk;const rpc=JSON.parse(body);calls.push({method:rpc.method,params:rpc.params,time:Date.now()});
 assert.notEqual(rpc.method,'sendTransaction','This test must never broadcast');
 if(alwaysLimit||(!injected&&rpc.method==='getMultipleAccounts')){injected=true;res.writeHead(429,{'Retry-After':alwaysLimit?'30':'1','Content-Type':'application/json'});res.end(JSON.stringify({error:{code:-32005,message:'Rate limit exceeded. Local simulation, never a real launch.'}}));return;}
 const r=await fetch('https://solana-rpc.publicnode.com',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(15000)});res.writeHead(r.status,{'Content-Type':'application/json',...(r.headers.get('retry-after')?{'Retry-After':r.headers.get('retry-after')}:{})});res.end(await r.text());
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}
});
await new Promise(resolve=>server.listen(4199,'127.0.0.1',resolve));
try{
 await import('./public-flow.mjs');assert(injected,'Rate limit must be exercised');
 const fee='8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt';
 assert(calls.some(c=>c.method==='getMultipleAccounts'&&c.params[0].includes(fee)&&c.params[0].length===3),'Pump configuration must be batched');
 assert(!calls.some(c=>c.method==='getAccountInfo'&&c.params[0]===fee),'No standalone fee-config burst');
 alwaysLimit=true;
 const r=await fetch(origin+'/api/base',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','oai-authenticated-user-id':'local-owner-test','oai-authenticated-user-email':'seedy@sites.test'},body:JSON.stringify({mint:'C8sJ5fZ4SFFT6WhwPRFhEj9jPRfQsyCahfcN1shgpump'})});
 const d=await r.json();assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'30');assert.match(d.error,/Solana connection is busy/);assert(!d.error.includes('failed to get info'));
 const response=await fetch(origin+'/api/feed');assert.equal(response.status,200);const feed=await response.json();assert.equal(feed.base.mint,'C8sJ5fZ4SFFT6WhwPRFhEj9jPRfQsyCahfcN1shgpump');assert.equal(feed.total,0,'Pending transactions remain excluded during RPC cooldown');
 console.log('PASS: complete unsigned preparation recovers from injected 429, batched configuration, persistent throttling returns safe 503/Retry-After, and the feed remains available. No broadcasts.');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
