"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {Link2,ArrowUpRight,ChevronDown} from 'lucide-react';
import {short,type LaunchChoice} from './shared';
type Option={groupId:string;groupName:string;groupSymbol:string;mint:string;name:string;symbol:string;slot:number;spaces:number;sequence:number};
type Page={options:Option[];hasMore:boolean;nextCursor:number|null};
export function PairPicker({choice,onChoose,onLaunch}:{choice:LaunchChoice;onChoose:(c:LaunchChoice)=>void;onLaunch?:()=>void}){
 const [page,setPage]=useState<Page>({options:[],hasMore:false,nextCursor:null}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[more,setMore]=useState(false);
 const pages=useRef(1),running=useRef(false);
 const refresh=useCallback(async()=>{if(running.current)return;running.current=true;
  try{let cursor:number|null=null,result:Page={options:[],hasMore:false,nextCursor:null};
   for(let i=0;i<pages.current;i++){const r=await fetch('/api/available'+(cursor?'?before='+cursor:''));if(!r.ok)throw Error('Open slots could not be refreshed.');const p:Page=await r.json();result={...p,options:[...result.options,...p.options]};cursor=p.nextCursor;if(!p.hasMore)break;}
   setPage(result);setError('');
  }catch(e){setError(e instanceof Error?e.message:'Open slots unavailable.');}finally{running.current=false;setLoading(false);setMore(false);}
 },[]);
 useEffect(()=>{refresh();const timer=setInterval(()=>{if(!document.hidden)refresh();},5000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[refresh]);
 const value=choice.mode==='pair'?choice.groupId+':'+choice.slot:'',found=page.options.some(o=>o.groupId+':'+o.slot===value);
 const unavailable=!!value&&!found&&!page.hasMore&&!loading;
 return <div className="pair-picker">
  {onLaunch&&<button className="pair-action" onClick={onLaunch} disabled={loading||!!error||unavailable||!page.options.length}><Link2 size={20}/>Auto pair<ArrowUpRight size={19}/></button>}
  <label>Available tokens with open spaces<select aria-label="Available tokens with open spaces" value={value} onChange={e=>{
   const o=page.options.find(o=>o.groupId+':'+o.slot===e.target.value);
   onChoose(o?{mode:'pair',groupId:o.groupId,slot:o.slot,groupName:o.groupName,predecessorSymbol:o.symbol}:{mode:'auto'});
  }} disabled={loading||!!error}>
   <option value="">{loading?'Loading open slots…':page.options.length?'Auto · newest available coin':'No open spaces · create a main coin'}</option>
   {value&&!found&&<option value={value}>{unavailable?'Slot no longer available':(choice.groupName||'Selected group')+' · Pair '+choice.slot}</option>}
   {page.options.map(o=><option key={o.groupId} value={o.groupId+':'+o.slot}>{o.name} (${o.symbol}) · {short(o.mint)} · {o.spaces} {o.spaces===1?'space':'spaces'} · next: Pair {o.slot}</option>)}
  </select></label>
  {page.hasMore&&<button type="button" className="more-options" disabled={more} onClick={()=>{pages.current++;setMore(true);refresh();}}>{more?'Loading…':'Load more available tokens'}<ChevronDown size={13}/></button>}
  {unavailable&&<small className="picker-error">That slot was filled or reserved. Choose another token.</small>}
  {error&&<button type="button" className="picker-error" onClick={refresh}>{error} Retry</button>}
 </div>;
}
