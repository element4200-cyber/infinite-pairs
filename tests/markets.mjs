import assert from 'node:assert/strict';
import {pumpMarket,dexMarket,markets} from '../app/lib/markets.ts';
const mint='local-market-1',now=Date.now();
assert.equal(pumpMarket({mint,market_cap_usd:45678},mint,now).usd,45678);
assert.equal(pumpMarket({mint,usd_market_cap:123},mint,now).source,'Pump.fun');
for(const n of [null,undefined,0,-1,NaN,Infinity,'123'])assert.equal(pumpMarket({mint,market_cap_usd:n},mint,now),null);
assert.equal(pumpMarket({mint:'different',market_cap_usd:42},mint,now),null);
const pair=(address,marketCap,liquidity=0)=>({chainId:'solana',baseToken:{address},quoteToken:{address:mint},marketCap,liquidity:{usd:liquidity}});
assert.equal(dexMarket([pair('other',9999)],mint,now),null,'Never use the quote token market cap');
assert.equal(dexMarket([{...pair(mint,undefined),fdv:12345}],mint,now),null,'FDV is not market cap');
assert.equal(dexMarket([pair(mint,10,1),pair(mint,20,100)],mint,now).usd,20);
let calls=[];const actual=globalThis.fetch;
globalThis.fetch=async url=>{calls.push(url);if(url.includes('coins-v2/')){
 const m=url.split('/').at(-1);return Response.json(m==='local-market-1'?{mint:m,market_cap_usd:1200}:{mint:m});
}return Response.json([pair('local-market-2',3200),pair('unrequested',50000)]);};
try{
 const result=await markets(['local-market-1','local-market-2','local-market-3']);
 assert.equal(result['local-market-1'].usd,1200);assert.equal(result['local-market-2'].source,'DEX Screener');assert.equal(result['local-market-3'].usd,null);
 const count=calls.length;await markets(['local-market-1','local-market-2','local-market-3']);assert.equal(calls.length,count,'Cached positive and missing lookups');
 globalThis.fetch=async()=>{throw Error('Simulated provider outage');};
 const failed=await markets(['local-market-outage']);assert.equal(failed['local-market-outage'].usd,null);
 console.log('PASS: correct USD field, mint identity, positive finite market caps, base/quote distinction, no FDV substitution, liquidity selection, provider fallback, caching, and graceful outage. No network or transactions.');
}finally{globalThis.fetch=actual;}
