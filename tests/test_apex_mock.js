'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../extension/background.js'),'utf8');
function fixture(behavior='stage'){
  const records=[{id:'1',SERIAL_NUMBER:'A12345',ASSET_TAG:'TAG12',STATUS:'Not Audited'},{id:'2',SERIAL_NUMBER:'B76543',STATUS:'Staged for Audit'},{id:'3',SERIAL_NUMBER:'C56789',STATUS:'Not Audited'}];
  const metadata={};let submissions=0,deletions=0,saves=0,last='',site='SPA1',dirty=false;
  const code={value:''};const input={};const model={
    getTotalRecords:()=>records.length,forEach:cb=>records.forEach((r,i)=>cb(r,i,r.id)),getValue:(r,k)=>r[k],getRecordMetadata:id=>metadata[id]||{},
    isChanged:()=>dirty||Object.values(metadata).some(m=>m.inserted||m.updated),getChanges:()=>records.filter(r=>metadata[r.id]?.inserted||metadata[r.id]?.updated),
    deleteRecords(rows){deletions++;for(const r of rows){records.splice(records.indexOf(r),1);delete metadata[r.id];}return rows.length;},
    save(){saves++;return Promise.resolve();}
  };
  const jq=()=>({trigger(){submissions++;
    if(behavior==='throw')throw new Error('Network interrupted');
    if(behavior==='stage')records.find(r=>r.SERIAL_NUMBER===last).STATUS='Staged for Audit';
    else if(['unsafe','safe','persisted','otheredit'].includes(behavior)){
      records.push({id:'new',SERIAL_NUMBER:behavior==='unsafe'?'LEGITIMATE':'',SCANNED_ASSET_SERIAL:last,STATUS:'Error'});
      if(behavior!=='persisted')metadata.new={inserted:true};
      if(behavior==='otheredit')metadata['3']={updated:true};code.value='2';
    }
  },one(){},off(){}});
  jq.Event=(type,args)=>({...args,type});
  const apex={region:()=>({widget:()=>({interactiveGrid:()=>({model})})}),item:()=>({setValue:v=>{last=v;}}),jQuery:jq};
  const document={querySelector(s){if(s==='#P4_SITE')return {selectedOptions:[{textContent:site}]};if(['#P4_SELECT_SERIAL','#CYCLE_COUNT'].includes(s))return input;if(s==='#P4_COUNTED_SERIAL')return code;return null;},querySelectorAll:()=>[]};
  const sandbox={window:{apex},apex,document,Promise,Date,console,clearTimeout,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,5))};
  const fn=vm.runInNewContext('('+source.slice(source.indexOf('async function apexWork('))+')',sandbox);
  return {fn,records,metadata,model,setSite:v=>site=v,setDirty:v=>dirty=v,counts:()=>({submissions,deletions,saves}),last:()=>last};
}
(async()=>{
  let f=fixture();assert.equal((await f.fn({op:'inspect'})).indexed,3);
  assert.equal((await f.fn({op:'stage',serial:'UNKNOWN'})).outcome,'not_in_audit');assert.equal(f.counts().submissions,0);
  assert.equal((await f.fn({op:'stage',serial:'B76543'})).outcome,'already_audited');
  assert.equal((await f.fn({op:'stage',serial:'TAG12'})).outcome,'audited');assert.equal(f.last(),'A12345','Asset scan must submit canonical serial');
  assert.equal((await f.fn({op:'stage',serial:'A12345'})).outcome,'already_audited');assert.equal(f.counts().submissions,1);
  assert.equal((await f.fn({op:'reconcile',serial:'C56789'})).outcome,'needs_review');
  assert.equal((await f.fn({op:'verify_many',serials:['A12345','C56789']})).failed.length,1);
  f=fixture();f.records.push({id:'4',SERIAL_NUMBER:'A12345',STATUS:'Not Audited'});assert.equal((await f.fn({op:'stage',serial:'A12345'})).outcome,'needs_review');assert.equal(f.counts().submissions,0);
  f=fixture();f.setSite('SPA10');assert.equal((await f.fn({op:'inspect'})).ok,false);
  f=fixture();f.setDirty(true);assert.equal((await f.fn({op:'stage',serial:'A12345'})).outcome,'needs_review');assert.equal(f.counts().submissions,0);
  f=fixture('safe');assert.match((await f.fn({op:'stage',serial:'A12345'})).message,/removed/);assert.deepEqual(f.counts(),{submissions:1,deletions:1,saves:1});
  for(const behavior of ['unsafe','persisted','otheredit']){f=fixture(behavior);assert.equal((await f.fn({op:'stage',serial:'A12345'})).outcome,'needs_review');assert.equal(f.counts().deletions,0,behavior+' must not delete');}
  f=fixture('throw');assert.equal((await f.fn({op:'stage',serial:'A12345'})).ok,false);assert.equal((await f.fn({op:'reconcile',serial:'A12345'})).outcome,'needs_review');assert.equal(f.counts().submissions,1);
  console.log('PASS APEX: identity, canonical serial, repeats, ambiguity, site scope, dirty edits, verified cleanup, unsafe deletion refusal, interruption, reconciliation');
})().catch(e=>{console.error(e);process.exitCode=1;});
