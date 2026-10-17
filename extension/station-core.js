/* Pure display rules shared by the station and its regression tests. */
(function(root){
  'use strict';
  const audit={queued:['Queued','warn'],sending:['Checking website','warn'],audited:['Audited','success'],already_audited:['Already audited','success'],not_in_audit:['Not in this audit','warn'],needs_review:['Review needed','error'],csv_only:['Investigation only',''],invalid:['Ignored barcode',''],offline:['Offline','warn']};
  const missing=record=>record.investigation==='found'?[record.repeat?'Already found':'Found','success']:record.investigation==='pending'?['Checking CSVs','warn']:record.investigation==='ambiguous'?['Ambiguous match','error']:record.investigation==='rejected'?['Ignored barcode','']:['Not on missing lists',''];
  const foundFeedback=record=>record.repeat?{title:'Already found · '+record.serial,message:'Repeat scan. Last-seen time and login refreshed.'}:{title:'Missing item found · '+record.serial,message:record.matches+' matching monthly record(s) updated.'};
  const visibleMode=mode=>({hid:mode==='hid',com:mode==='com',field:mode==='station'});
  const time=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});};
  const changedValues=(original,current)=>Object.fromEntries(Object.entries(current).filter(([key,value])=>original[key]!==value));
  function readiness(running,config,health,focused){
    if(!running)return {ready:false,label:'Stopped',kind:'',hint:'Start scanning to resume.'};
    if(!config.username)return {ready:false,label:'Login needed',kind:'warning',hint:'Save your login in Settings before scanning.'};
    if(config.capture_enabled===false)return {ready:false,label:'Capture paused',kind:'warning',hint:'Start scanning to enable capture.'};
    if((config.input_mode||'station')==='station')return focused?{ready:true,label:'Ready to scan',kind:'running',hint:''}:{ready:false,label:'Barcode not focused',kind:'warning',hint:'Press F8 or click Barcode before scanning. Your details draft stays saved.'};
    if(health.capture_ready===false||/error|failed|unavailable|reconnecting/i.test(health.input||''))return {ready:false,label:'Scanner needs attention',kind:'warning',hint:health.capture_reason||health.input||'Check the selected device in Settings.'};
    return {ready:true,label:'Device capture ready',kind:'running',hint:''};
  }
  const api={readiness,audit,missing,foundFeedback,visibleMode,time,changedValues};
  if(typeof module!=='undefined')module.exports=api;else root.StationUI=api;
})(typeof window==='undefined'?{}:window);
