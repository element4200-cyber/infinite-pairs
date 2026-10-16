import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SendTransactionError} from '@solana/web3.js';
import {terminalLaunch,trackingLaunch,preflightRejection} from '../app/lib/transaction-status.ts';
for(const status of ['finalized','expired','failed']){assert(terminalLaunch(status));assert(!trackingLaunch(status));}
for(const status of ['submitted','confirmed'])assert(trackingLaunch(status));
assert(!trackingLaunch('prepared'));
const rejected=new SendTransactionError({action:'simulate',signature:'',transactionMessage:'Transaction simulation failed: Insufficient funds for rent',logs:[]});
assert.match(preflightRejection(rejected),/rent, and network fees/);assert.equal(preflightRejection(new Error('Network timeout')),null);
// Render the real dialog, including the stale signature that caused the perpetual spinner.
const output=path.resolve('.wrangler/ui-status-tests');
for(const file of ['app/ui/dialogs.tsx','app/ui/shared.tsx','app/ui/markets.tsx','app/ui/pair-picker.tsx','app/lib/transaction-status.ts']){
 const dest=path.join(output,file.replace(/\.tsx?$/,'.js'));mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,q,p)=>'from '+q+p+'.js'+q);writeFileSync(dest,code);
}
const {Dialogs}=await import(pathToFileURL(path.join(output,'app/ui/dialogs.js')).href);
const spinning=html=>/class="[^"]*\bspin\b/.test(html);
const noop=()=>{},props={modal:'create',selected:null,feed:{groups:[],openGroups:0,uploads:true},wallet:'',busy:'',error:'',prepared:null,pendingId:'',signature:'an-old-signature',launchStatus:'finalized',signedTx:'',setupReady:false,setupSignature:'',choice:{mode:'main'},setChoice:noop,close:noop,connect:noop,review:noop,launch:noop,copy:noop,upload:noop,importMain:noop,disconnect:noop};
for(const status of ['finalized','failed','expired']){
 const html=renderToStaticMarkup(React.createElement(Dialogs,{...props,launchStatus:status}));
 assert(!html.includes('Tracking your transaction'));assert(!spinning(html),'A terminal launch must not spin');
}
for(const status of ['submitted','confirmed']){
 const html=renderToStaticMarkup(React.createElement(Dialogs,{...props,launchStatus:status}));assert(spinning(html));assert(html.includes(status==='confirmed'?'Confirmed on Solana':'Submitted to Solana'));
}
const token={id:'local',slot:0,name:'Local receipt',symbol:'LOCAL',mint:'local-mint',description:'',predecessor:null,dev_buy:'0.09',quote_symbol:'SOL',signature:'local-signature'};
const success=renderToStaticMarkup(React.createElement(Dialogs,{...props,modal:'success',selected:token}));
assert(success.includes('Launch finalized on Solana.'));assert(success.includes('Your dev buy was included'));assert(success.includes('0.09'));assert(!spinning(success));
console.log('PASS: real dialog stops spinning for finalized, failed, or expired launches even with a retained signature; confirmed progress and explicit dev-buy success; definite rejection vs ambiguous network failure. No network or transactions.');
