"use client";
import {createContext,useContext,useEffect,useRef,useState,useCallback} from 'react';
import type {Market} from '../lib/markets';
const MarketContext=createContext<{values:Record<string,Market>;watch:(mint:string)=>()=>void}>({values:{},watch:()=>()=>{}});
export function MarketProvider({children}:{children:React.ReactNode}){
 const [values,setValues]=useState<Record<string,Market>>({}),[revision,setRevision]=useState(0),watched=useRef(new Map<string,number>());
 const watch=useCallback((mint:string)=>{watched.current.set(mint,(watched.current.get(mint)||0)+1);setRevision(n=>n+1);return()=>{const count=(watched.current.get(mint)||1)-1;if(count)watched.current.set(mint,count);else watched.current.delete(mint);};},[]);
 useEffect(()=>{let alive=true,running=false;
  async function refresh(){if(running||document.hidden)return;running=true;try{
   const mints=[...watched.current.keys()];
   for(let i=0;i<mints.length&&alive;i+=30){try{const r=await fetch('/api/markets?mints='+mints.slice(i,i+30).join(','));if(!r.ok)throw Error();const data=await r.json() as {markets:Record<string,Market>};if(alive)setValues(p=>({...p,...data.markets}));}catch{if(alive)setValues(p=>({...p,...Object.fromEntries(mints.slice(i,i+30).map(m=>[m,p[m]?{...p[m],stale:true}:{usd:null,source:null,checkedAt:Date.now(),stale:false}]))}));}}
  }finally{running=false;}}
  const soon=setTimeout(refresh,100),timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);
  return()=>{alive=false;clearTimeout(soon);clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[revision]);
 return <MarketContext.Provider value={{values,watch}}>{children}</MarketContext.Provider>;
}
export function MarketCap({mint}:{mint:string}){
 const {values,watch}=useContext(MarketContext),ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const node=ref.current;if(!node)return;const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting),{rootMargin:'180px'});observer.observe(node);return()=>observer.disconnect();},[]);
 useEffect(()=>visible?watch(mint):undefined,[visible,mint,watch]);
 const market=values[mint],stale=market&&(market.stale||Date.now()-market.checkedAt>65000);
 const usd=market&&Date.now()-market.checkedAt<300000?market.usd:null;
 return <div className={'market-cap '+(stale?'is-stale':'')} ref={ref} title={market?.source?market.source+' · checked '+new Date(market.checkedAt).toLocaleTimeString():undefined}>
  <span>Market cap</span><strong>{usd?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:usd>=1000?'compact':'standard',maximumFractionDigits:2}).format(usd):market?'Unavailable':'Loading…'}</strong>
  <small>{usd?(stale?'Delayed · ':'')+market?.source:market?'Awaiting market data':'Checking price'}</small>
 </div>;
}
