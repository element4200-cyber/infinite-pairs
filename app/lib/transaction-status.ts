import {SendTransactionError} from '@solana/web3.js';
export const terminalLaunch=(status:string)=>['finalized','failed','expired'].includes(status);
export const trackingLaunch=(status:string)=>['submitted','confirmed'].includes(status);
export function preflightRejection(error:unknown):string|null{
 if(!(error instanceof SendTransactionError)||!/simulation failed/i.test(error.message))return null;
 const reason=error.transactionError.message;
 if(/insufficient|insufficien|no record of a prior credit/i.test(reason))return 'Solana rejected the launch before broadcast: the wallet needs enough SOL for the dev buy, account rent, and network fees.';
 if(/blockhash not found|block height exceeded/i.test(reason))return 'This launch review expired before broadcast. Prepare a fresh launch and approve it promptly.';
 const safe=reason.replace(/https?:\/\/\S+/g,'[RPC]').slice(0,260);
 return 'Solana rejected the launch before broadcast: '+safe;
}
