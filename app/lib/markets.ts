export type Market = {usd:number|null;source:'Pump.fun'|'DEX Screener'|null;checkedAt:number;stale:boolean};
type Entry={value:Market;expires:number};
const cache=new Map<string,Entry>();
class MarketLookupError extends Error{status:number;constructor(status:number){super('Market provider HTTP '+status);this.status=status;}}
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function pumpMarket(data:Record<string,unknown>,mint:string,now:number):Market|null{
  if(data.mint!==mint)return null;
  const usd=data.market_cap_usd??data.usd_market_cap;
  return positive(usd)?{usd,source:'Pump.fun',checkedAt:now,stale:false}:null;
}
export function dexMarket(data:unknown,mint:string,now:number):Market|null{
  if(!Array.isArray(data))return null;
  // marketCap describes the base token, never the quote token. FDV is not market cap.
  const pairs=data.filter(p=>p?.chainId==='solana'&&p.baseToken?.address===mint&&positive(p.marketCap))
    .sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
  return pairs.length?{usd:pairs[0].marketCap,source:'DEX Screener',checkedAt:now,stale:false}:null;
}
async function providerJson(url:string){
  const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(3000)});
  if(!r.ok)throw new MarketLookupError(r.status);
  return r.json() as Promise<Record<string,unknown>>;
}
export async function markets(mints:string[]):Promise<Record<string,Market>>{
  const now=Date.now(),needed=mints.filter(m=>!cache.has(m)||cache.get(m)!.expires<=now);
  const missing:string[]=[];
  // Bound each request's concurrency. Only plain cached data may cross Worker requests.
  let index=0;
  await Promise.all(Array.from({length:Math.min(6,needed.length)},async()=>{
    while(index<needed.length){const mint=needed[index++];
      const task=(async()=>{
        try{const value=pumpMarket(await providerJson('https://frontend-api-v3.pump.fun/coins-v2/'+mint),mint,Date.now());if(value)return value;}catch(e){if(!(e instanceof MarketLookupError&&e.status===404))console.warn('Pump.fun market lookup:',e instanceof Error?e.message:'Provider unavailable');}
        return {usd:null,source:null,checkedAt:Date.now(),stale:false} as Market;
      })();
      const value=await task;
      if(value.usd===null)missing.push(mint);else cache.set(mint,{value,expires:Date.now()+30000});
    }
  }));
  if(missing.length){let fallback:unknown=null;
    try{fallback=await providerJson('https://api.dexscreener.com/tokens/v1/solana/'+missing.join(','));}catch(e){console.warn('DEX Screener market lookup:',e instanceof Error?e.message:'Provider unavailable');}
    for(const mint of missing){const old=cache.get(mint)?.value;
      const value=dexMarket(fallback,mint,Date.now())||(old?.usd&&Date.now()-old.checkedAt<300000?{...old,stale:true}:{usd:null,source:null,checkedAt:Date.now(),stale:false} as Market);
      cache.set(mint,{value,expires:Date.now()+(value.usd&&!value.stale?30000:15000)});
    }
  }
  if(cache.size>1500){for(const [key,value] of cache){if(value.expires<now)cache.delete(key);if(cache.size<=1000)break;}for(const key of cache.keys()){if(cache.size<=1500)break;cache.delete(key);}}
  return Object.fromEntries(mints.map(m=>[m,cache.get(m)?.value||{usd:null,source:null,checkedAt:now,stale:false}]));
}
