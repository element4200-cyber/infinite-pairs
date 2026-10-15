import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Connection,PublicKey} from '@solana/web3.js';
import {bondingCurvePda} from '@pump-fun/pump-sdk';

// Run on a fresh localhost DB with STARTING_TOKEN_CA set to this read-only fixture
// and SOLANA_RPC_URL=http://127.0.0.1:4199. Never configure it on the hosted site.
const mint='C8sJ5fZ4SFFT6WhwPRFhEj9jPRfQsyCahfcN1shgpump';
const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:4173';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('Localhost-only activation test.');
const account=await new Connection('https://solana-rpc.publicnode.com').getAccountInfo(bondingCurvePda(new PublicKey(mint)),'finalized');
assert(account,'Read-only Pump.fun fixture must exist.');
const live={data:[account.data.toString('base64'),'base64'],owner:account.owner.toBase58(),lamports:account.lamports,executable:false,rentEpoch:0,space:account.data.length};
let mode='waiting';
const server=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 const rpc=JSON.parse(body);assert.equal(rpc.method,'getAccountInfo');
 const response=mode==='error'?{jsonrpc:'2.0',id:rpc.id,error:{code:-32000,message:'Local simulated delay'}}:{jsonrpc:'2.0',id:rpc.id,result:{context:{slot:1},value:mode==='waiting'?null:mode==='wrong-owner'?{...live,owner:'11111111111111111111111111111111'}:live}};
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(response));
});
await new Promise(resolve=>server.listen(4199,'127.0.0.1',resolve));
async function feed(){const r=await fetch(origin+'/api/feed');assert.equal(r.status,200);return r.json();}
try{
 let state=await feed();assert.equal(state.base,null);assert.equal(state.activation.status,'waiting-for-token');assert.equal(state.activation.mint,mint);
 mode='error';state=await feed();assert.equal(state.base,null);assert.equal(state.activation.status,'verification-delayed');
 mode='wrong-owner';state=await feed();assert.equal(state.base,null);assert.equal(state.activation.status,'invalid-ca');
 mode='live';const states=await Promise.all([feed(),feed(),feed()]);for(const s of states){assert.equal(s.base.mint,mint);assert.equal(s.activation.status,'active');assert.equal(s.owner,false);assert.equal(s.total,0);}
 mode='waiting';state=await feed();assert.equal(state.base.mint,mint,'Activation persists after verification');assert.equal(state.activation.status,'active');
 const denied=await fetch(origin+'/api/base',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({mint})});assert.notEqual(denied.status,200,'Anonymous users cannot change the CA');
 console.log('PASS: prelaunch CA stays pending; RPC delays retry; non-Pump accounts rejected; live verification activates anonymously; concurrent activation is safe; activation persists; public CA editing denied. No transactions broadcast.');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
