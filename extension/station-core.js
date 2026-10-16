/* Pure display rules shared by the station and its regression tests. */
(function(root){
  'use strict';
  const audit={queued:['Queued','warn'],sending:['Checking website','warn'],audited:['Audited','success'],already_audited:['Already audited','success'],not_in_audit:['Not in this audit','warn'],needs_review:['Review needed','error'],csv_only:['Investigation only',''],invalid:['Ignored barcode',''],offline:['Offline','warn']};
  const missing=record=>record.investigation==='found'?[record.repeat?'Already found':'Found','success']:record.investigation==='pending'?['Checking CSVs','warn']:record.investigation==='ambiguous'?['Ambiguous match','error']:record.investigation==='rejected'?['Ignored barcode','']:['Not on missing lists',''];
  const foundFeedback=record=>record.repeat?{title:'Already found · '+record.serial,message:'Repeat scan. Last-seen time and login refreshed.'}:{title:'Missing item found · '+record.serial,message:record.matches+' matching monthly record(s) updated.'};
  const visibleMode=mode=>({hid:mode==='hid',com:mode==='com',field:mode==='station'});
  const time=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});};
  const changedValues=(original,current)=>Object.fromEntries(Object.entries(current).filter(([key,value])=>original[key]!==value));
  const api={audit,missing,foundFeedback,visibleMode,time,changedValues};
  if(typeof module!=='undefined')module.exports=api;else root.StationUI=api;
})(typeof window==='undefined'?{}:window);
