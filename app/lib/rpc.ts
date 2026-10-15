// Numeric cooldowns can be shared between Worker requests without sharing I/O promises.
const cooldowns = new Map<string, number>();
const readMethods = new Set(['getAccountInfo','getMultipleAccounts','getLatestBlockhash','getSlot','getBlockHeight','getTokenAccountBalance','getSignatureStatuses','getTransaction','getSignaturesForAddress','getMinimumBalanceForRentExemption']);
type Options = { fetch?: typeof fetch; now?:()=>number; sleep?:(ms:number)=>Promise<void>; cooldowns?:Map<string,number>; spacingMs?:number };
export class RpcBusyError extends Error {
  constructor(seconds:number){super(`RPC_BUSY:${Math.max(1,Math.ceil(seconds))}`);}
}
export function rpcFailure(error:unknown):{message:string;retryAfter:number}|null {
  const message=error instanceof Error?error.message:String(error);
  const busy=message.match(/RPC_BUSY:(\d+)/);
  if(busy||/429|too many requests|rate.?limit exceeded/i.test(message)){
    const retryAfter=busy?Number(busy[1]):30;
    return {message:`The Solana connection is busy. Please try again in ${retryAfter} seconds.`,retryAfter};
  }
  if(message.includes('RPC_UNAVAILABLE'))return {message:'The Solana connection is temporarily unavailable. Please try again shortly.',retryAfter:10};
  return null;
}
export function missingTokenAccount(error:unknown){return /could not find account|account (does not exist|not found)/i.test(error instanceof Error?error.message:String(error));}
function retryDelay(header:string|null,now:number,fallback:number){
  if(header!==null){const seconds=Number(header);if(Number.isFinite(seconds)&&seconds>=0)return Math.max(100,seconds*1000);const date=Date.parse(header);if(Number.isFinite(date))return Math.max(100,date-now);}
  return fallback;
}
export function createRpcFetch(options:Options={}){
  const request=options.fetch??globalThis.fetch, now=options.now??Date.now;
  const sleep=options.sleep??((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  const blocked=options.cooldowns??cooldowns;
  let queue:Promise<unknown>=Promise.resolve(),lastStart=-Infinity;
  const transport:typeof fetch=(input,init)=>{
    // Queue only within this Connection/request. Do not replay transaction sends.
    const run=async()=>{
      const endpoint=String(input);let method='';
      try{method=JSON.parse(String(init?.body)).method;}catch{/* Non-RPC requests are never retried. */}
      for(let attempt=0;attempt<3;attempt++){
        const remaining=(blocked.get(endpoint)??0)-now();
        if(remaining>0){if(attempt===0||remaining>2000)throw new RpcBusyError(remaining/1000);await sleep(remaining);}
        const gap=(options.spacingMs??200)-(now()-lastStart);if(gap>0)await sleep(gap);
        lastStart=now();let response:Response;
        try{response=await request(input,{...init,signal:AbortSignal.timeout(12000)});}catch{throw new Error('RPC_UNAVAILABLE');}
        let limited=response.status===429;
        if(response.ok){try{const body=await response.clone().json() as {error?:{message?:string}};limited=/rate.?limit|too many requests/i.test(body.error?.message??'');}catch{/* Let web3 validate any other response. */}}
        if(!limited){if(response.status>=500)throw new Error('RPC_UNAVAILABLE');return response;}
        const delay=retryDelay(response.headers.get('retry-after'),now(),attempt===2?15000:1000*2**attempt);
        blocked.set(endpoint,now()+delay);
        if(!readMethods.has(method)||attempt===2||delay>2000)throw new RpcBusyError(delay/1000);
      }
      throw new RpcBusyError(15);
    };
    const result=queue.then(run);queue=result.catch(()=>{});return result;
  };
  return transport;
}
