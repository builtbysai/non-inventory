'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../extension/background.js'),'utf8');
const functionSource=source.slice(source.indexOf('async function apexWork('));
const records=[
  {id:'1',SERIAL_NUMBER:'A12345',SCANNED_ASSET_SERIAL:'',ASSET_TAG:'TAG-12',STATUS:'Not Audited'},
  {id:'2',SERIAL_NUMBER:'B76543',SCANNED_ASSET_SERIAL:'',ASSET_TAG:'',STATUS:'Staged for Audit'},
  {id:'3',SERIAL_NUMBER:'C56789',SCANNED_ASSET_SERIAL:'',ASSET_TAG:'',STATUS:'Not Audited'},
];
let submissions=0,last='';
const model={
  getTotalRecords:()=>records.length,
  forEach(callback){records.forEach((r,i)=>callback(r,i,r.id));},
  getValue:(r,k)=>r[k]
};
const input={};const code={value:''};
const apex={region:()=>({widget:()=>({interactiveGrid:()=>({model})})}),
  item:()=>({setValue(v){last=v;}}),
  jQuery:Object.assign(()=>({trigger(){submissions++;const rec=records.find(r=>r.SERIAL_NUMBER===last);if(rec)rec.STATUS='Staged for Audit';}}),
    {Event:(type,args)=>({...args,type})})};
const document={querySelector(s){if(s==='#P4_SITE')return {selectedOptions:[{textContent:'SPA1'}]};if(s==='#P4_SELECT_SERIAL'||s==='#CYCLE_COUNT')return input;if(s==='#P4_COUNTED_SERIAL')return code;return null;},querySelectorAll:()=>[]};
const sandbox={window:{apex},apex,document,setTimeout,Promise,Date,console};
const fn=vm.runInNewContext('('+functionSource+')',sandbox);
(async()=>{
  const info=await fn({op:'inspect'});
  assert.equal(info.ok,true);assert.equal(info.total,3);assert.equal(info.indexed,3);
  assert.equal((await fn({op:'stage',serial:'DOESNOTEXIST'})).outcome,'not_in_audit');
  assert.equal(submissions,0,'Unknown serial must never reach official input');
  assert.equal((await fn({op:'stage',serial:'B76543'})).outcome,'already_audited');
  assert.equal(submissions,0,'Duplicate must not reach official input');
  assert.equal((await fn({op:'stage',serial:'A12345'})).outcome,'audited');
  assert.equal(submissions,1,'One valid submission');
  assert.equal((await fn({op:'stage',serial:'A12345'})).outcome,'already_audited');
  assert.equal(submissions,1,'A valid scan cannot be submitted twice');
  assert.equal((await fn({op:'reconcile',serial:'C56789'})).outcome,'needs_review');
  console.log('PASS APEX mock: inspect, skip unknown, skip duplicates, verify stage, reconcile interrupted, no deletion');
})().catch(e=>{console.error(e);process.exitCode=1});
