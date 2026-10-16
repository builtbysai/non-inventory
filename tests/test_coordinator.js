'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../extension/background.js'),'utf8');
let messageListener,disconnectListener,submissions=0,reconciliations=0,fail=false;
const config={connected:true,paused:false,csvOnly:false,tabId:4,auditSite:{value:'SPA1',label:'SPA1'},origin:'https://inventory.example.invalid'};
const receipts=[{id:'one',serial:'A12345',audit:'queued'}];
const native={postMessage(msg){queueMicrotask(()=>{
  let result={ok:true,requestId:msg.requestId};
  if(msg.action==='config')result.config={companion_enabled:true};
  if(msg.action==='pending')result.pending=receipts.filter(x=>['queued','sending'].includes(x.audit));
  if(msg.action==='audit_result')receipts.find(x=>x.id===msg.id).audit=msg.outcome;
  messageListener(result);
});},onMessage:{addListener:f=>messageListener=f},onDisconnect:{addListener:f=>disconnectListener=f}};
const browser={runtime:{connectNative:()=>native,onMessage:{addListener(){}},onStartup:{addListener(){}},sendMessage:async()=>{}},
  storage:{local:{get:async()=>({...config}),set:async x=>Object.assign(config,x)}},
  tabs:{get:async()=>({url:config.origin+'/audit'})},scripting:{executeScript:async({args})=>{
    if(args[0].op==='stage'){submissions++;if(fail)throw new Error('Lost connection after submission');}
    if(args[0].op==='reconcile')reconciliations++;
    return [{result:{ok:true,outcome:'audited',message:'Verified'}}];
  }}};
const context=vm.createContext({browser,console,setInterval(){},setTimeout,clearTimeout,URL,Map,Promise});vm.runInContext(source,context);
const worker=()=>vm.runInContext('processQueue()',context);
(async()=>{
  fail=true;await Promise.all([worker(),worker()]);assert.equal(submissions,1,'One worker only');assert.equal(receipts[0].audit,'sending','Uncertain write must remain sending');assert.equal(config.paused,true);
  fail=false;config.connected=true;config.paused=false;config.csvOnly=true;
  await worker();assert.equal(receipts[0].audit,'audited');assert.equal(submissions,1,'Never resubmit interrupted receipt');assert.equal(reconciliations,1,'CSV-only must still reconcile uncertain remote writes');
  receipts.push({id:'two',serial:'B76543',audit:'queued'});await worker();assert.equal(receipts[1].audit,'csv_only');assert.equal(submissions,1);
  config.paused=true;receipts.push({id:'three',audit:'queued'});await worker();assert.equal(receipts[2].audit,'queued');
  console.log('PASS coordinator: one worker, interrupted writes persisted, read-only recovery, CSV-only semantics, pause');
})().catch(e=>{console.error(e);process.exitCode=1;});
