"use client";
import {useState} from 'react';
import type {VersionedTransaction} from '@solana/web3.js';
export type Token={id:string;mint:string;name:string;symbol:string;description:string;image:string;predecessor:string|null;quote_mint:string;quote_symbol:string;fallback:string|null;sequence:number;dev_buy:string;depth:number;owner:string;finalized_at:number;signature:string;status:string;error?:string};
export type Feed={launches:Token[];total:number;tail:Token|null;active:{id:string;status:string}|null;hasMore:boolean;uploads:boolean};
export type Provider={publicKey:{toBase58():string}|null;isPhantom?:boolean;connect:()=>Promise<{publicKey:{toBase58():string}}>;disconnect:()=>Promise<void>;signMessage:(m:Uint8Array,encoding?:string)=>Promise<{signature:Uint8Array}|Uint8Array>;signTransaction:(t:VersionedTransaction)=>Promise<VersionedTransaction>};
export type Prepared={id:string;transaction:string;setupTransaction:string|null;setupRent:number;mint:string;name:string;symbol:string;predecessor:string|null;quoteMint:string;quoteSymbol:string;fallback:string|null;devBuy:string;slippage:number;tokens:string;decimals:number;maxDevBuy:string};
export const short=(s:string)=>s.slice(0,5)+'…'+s.slice(-4);
export function InfinityMark({className=''}:{className?:string}){return <svg className={className} viewBox="0 0 100 50" fill="none" aria-hidden="true"><path d="M50 25C35 0 10 0 10 25s25 25 40 0S90 0 90 25 65 50 50 25Z" stroke="currentColor" strokeWidth="7" strokeLinecap="round"/></svg>;}
export function TokenIcon({token}:{token:Token}){const [failed,setFailed]=useState(false);return <div className={'token-icon hue-'+(token.sequence%3)}>{token.image&&!failed?<img src={token.image} alt="" onError={()=>setFailed(true)}/>:token.sequence===1?<InfinityMark/>:<span>{token.symbol.slice(0,2)}</span>}</div>;}
