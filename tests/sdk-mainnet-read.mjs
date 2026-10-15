import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {Connection,Keypair,Transaction,ComputeBudgetProgram,PublicKey} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import BN from 'bn.js';
const require=createRequire(import.meta.url),{OnlinePumpSdk,PUMP_SDK,getBuyTokenAmountFromSolAmount,newBondingCurve}=require('@pump-fun/pump-sdk');
const c=new Connection('https://api.mainnet-beta.solana.com',{disableRetryOnRateLimit:true,fetch:(u,o)=>fetch(u,{...o,signal:AbortSignal.timeout(15000)})});
const online=new OnlinePumpSdk(c),g=await online.fetchGlobal(),feeConfig=await online.fetchFeeConfig();
console.log('Live Pump.fun config:',{creation:g.createV2Enabled,maxCurveDepth:g.maxCurveDepth});
const user=Keypair.generate(),mint=Keypair.generate(),quote=await online.resolveQuoteMint(NATIVE_MINT);
const common={mint:mint.publicKey,user:user.publicKey,creator:user.publicKey,name:'Infinite Pairs',symbol:'INFINITE',uri:'https://example.com/metadata.json',mayhemMode:false};
for(const buy of [false,true]){const ixs=[await PUMP_SDK.createV2Instruction(common),...(buy?await PUMP_SDK.buyV3Instructions({bondingCurve:newBondingCurve(g,NATIVE_MINT),associatedUserAccountInfo:null,mint:mint.publicKey,user:user.publicKey,quoteAmount:new BN(100000000),amount:getBuyTokenAmountFromSolAmount({global:g,feeConfig,mintSupply:null,bondingCurve:null,amount:new BN(100000000),quoteMint:NATIVE_MINT}),slippage:1}):[])];const tx=new Transaction({feePayer:user.publicKey,...await c.getLatestBlockhash()}).add(ComputeBudgetProgram.setComputeUnitLimit({units:650000}),...ixs);tx.sign(mint,user);assert(tx.verifySignatures());console.log(buy?'Create + dev buy':'Create only',tx.serialize().length,'bytes');}
// Encoding check only. These synthetic quotes are never submitted or broadcast.
const q=Keypair.generate().publicKey;
for(const depth of [1,2]){const pumpQuote={chain:depth===2?[{mint:Keypair.generate().publicKey}]:[]};const ixs=[await PUMP_SDK.createV2Instruction({...common,quoteMint:q,quoteTokenProgram:TOKEN_2022_PROGRAM_ID,pumpQuote}),...await PUMP_SDK.buyV3Instructions({bondingCurve:{quoteMint:q,isCashbackCoin:false},associatedUserAccountInfo:null,mint:mint.publicKey,user:user.publicKey,quoteTokenProgram:TOKEN_2022_PROGRAM_ID,quoteAmount:new BN(1000),amount:new BN(1000),slippage:1})];try{const tx=new Transaction({feePayer:user.publicKey,...await c.getLatestBlockhash()}).add(ComputeBudgetProgram.setComputeUnitLimit({units:650000}),...ixs);tx.sign(mint,user);console.log('Token pair depth',depth,tx.serialize().length,'bytes');}catch(e){console.log('Token pair depth',depth,e.message)}}
