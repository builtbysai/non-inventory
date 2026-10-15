/* Local transport and one durable audit worker shared by every station window. */
'use strict';
let port,seq=0,working=false;
const inflight=new Map();
function host(command){
  if(!port){
    port=browser.runtime.connectNative('non_inventory_host');
    port.onMessage.addListener(m=>{const e=inflight.get(m.requestId);if(!e)return;clearTimeout(e.t);inflight.delete(m.requestId);m.ok?e.resolve(m):e.reject(new Error(m.error||'Companion failed'));});
    port.onDisconnect.addListener(()=>{const error=browser.runtime.lastError?.message||'Companion disconnected';for(const e of inflight.values()){clearTimeout(e.t);e.reject(new Error(error));}inflight.clear();port=null;});
  }
  return new Promise((resolve,reject)=>{const id=String(++seq),t=setTimeout(()=>{inflight.delete(id);reject(new Error('Companion timeout; receipt may already be saved. Reconnect before rescanning.'));},35000);inflight.set(id,{resolve,reject,t});try{port.postMessage({...command,requestId:id});}catch(e){clearTimeout(t);inflight.delete(id);reject(e);}});
}
async function inject(tabId,request){
  const result=(await browser.scripting.executeScript({target:{tabId},world:'MAIN',func:apexWork,args:[request]}))?.[0]?.result;
  if(!result?.ok)throw new Error(result?.message||'Official tab unavailable');return result;
}
async function activeAuditTab(){
  const {tabId,origin}=await browser.storage.local.get(['tabId','origin']);
  if(!Number.isInteger(tabId)||!origin)throw new Error('Connect official audit first');
  const tab=await browser.tabs.get(tabId);if(new URL(tab.url).origin!==origin)throw new Error('Official tab changed origin');return tabId;
}
async function notify(event){try{await browser.runtime.sendMessage({action:'event',...event});}catch(_){} }
async function processQueue(){
  if(working)return;working=true;
  try{
    const cfg=await browser.storage.local.get(['paused','connected','csvOnly']);
    if(cfg.paused||(!cfg.connected&&!cfg.csvOnly))return;
    const {pending}=await host({action:'pending'});const item=pending[0];if(!item)return;
    let result;
    if(cfg.csvOnly&&item.audit!=='sending')result={outcome:'csv_only',message:'Investigation only; website unchanged.'};
    else{
      const tab=await activeAuditTab();
      if(item.audit==='sending')result=await inject(tab,{op:'reconcile',serial:item.serial});
      else{
        await host({action:'audit_result',id:item.id,outcome:'sending',message:'External write may occur; reconcile before retry'});
        result=await inject(tab,{op:'stage',serial:item.serial});
      }
    }
    await host({action:'audit_result',id:item.id,...result});
    await notify({type:'audit',serial:item.serial,...result});
    if(result.outcome==='needs_review')await browser.storage.local.set({paused:true});
  }catch(e){
    await browser.storage.local.set({paused:true,connected:false});await notify({type:'error',message:e.message});
  }finally{working=false;}
}
async function route(msg){
  if(msg.action==='host')return host(msg.payload);
  if(msg.action==='tabs'){const ts=await browser.tabs.query({});return {ok:true,tabs:ts.filter(t=>/^https?:/.test(t.url||'')).map(t=>({id:t.id,title:t.title,url:t.url}))};}
  if(msg.action==='connect'){
    const tab=await browser.tabs.get(Number(msg.tabId)),u=new URL(tab.url);
    if(!/^https?:$/.test(u.protocol)||!await browser.permissions.contains({origins:[u.origin+'/*']}))throw new Error('Grant access to the selected official site');
    const r=await inject(tab.id,{op:'inspect'});await browser.storage.local.set({tabId:tab.id,origin:u.origin,connected:true,paused:false});return r;
  }
  if(msg.action==='complete'){
    if(working)throw new Error('Wait for the in-flight audit submission to finish, then complete again.');
    const config=(await host({action:'config'})).config;
    if(config.capture_enabled!==false)throw new Error('Disable device capture before completion.');
    const receipts=(await host({action:'audit_receipts'})).receipts;
    if(receipts.length){
      const result=await inject(await activeAuditTab(),{op:'verify_many',serials:[...new Set(receipts.map(r=>r.serial))]});
      const failures=receipts.filter(r=>result.failed.includes(r.serial));
      for(const r of failures)await host({action:'verify_failed',serial:r.serial,message:'Final read-only reconciliation did not confirm this serial'});
      if(failures.length)throw new Error(failures.length+' staged receipts no longer confirmed. Review exceptions.');
    }
    return host({action:'complete'});
  }
  if(msg.action==='reconcile')return inject(await activeAuditTab(),{op:'reconcile',serial:msg.serial});
  if(msg.action==='pause'){await browser.storage.local.set({paused:msg.value});return {ok:true};}
  throw new Error('Unknown command');
}
browser.runtime.onMessage.addListener(msg=>msg.action==='event'?undefined:route(msg).catch(e=>({ok:false,message:e.message})));
// A persistent Firefox background page survives closing the station tab.
setInterval(()=>void processQueue(),700);
browser.runtime.onStartup.addListener(()=>browser.storage.local.set({connected:false,paused:true}));
async function apexWork(command){
  const n=v=>String(v??'').trim().toUpperCase();
  const fail=message=>({ok:false,message});
  try{
    if(!document.querySelector('#P4_SELECT_SERIAL')||!document.querySelector('#CYCLE_COUNT')||!window.apex?.region)
      return fail('Not the Field IT Audit Count page. Open the actual live APEX audit.');
    const site=document.querySelector('#P4_SITE');
    const siteName=site?.selectedOptions?.[0]?.textContent||site?.value||'';
    if(!/^SPA1(?:\s|$|\s*[-(])/.test(n(siteName)))return fail('Select SPA1 on the inventory website.');
    const region=apex.region('CYCLE_COUNT');
    const model=()=>region.widget().interactiveGrid('getCurrentView').model;
    if(typeof model().getRecordMetadata!=='function')return fail('APEX record metadata unavailable; cannot verify saved records.');
    function get(m,record,key){
      try{const v=m.getValue(record,key);return String(v&&typeof v==='object'?(v.v??v.d??''):v??'').trim();}
      catch(_){return ''}
    }
    function snapshot(m){
      const rows=[];
      m.forEach((r,index,id)=>{
        const meta=m.getRecordMetadata?.(id);if(meta?.deleted||meta?.agg)return;
        const fields=['SERIAL_NUMBER','SCANNED_ASSET_SERIAL','ASSET_TAG'];
        rows.push({id:String(id),serials:fields.map(f=>n(get(m,r,f))).filter(Boolean),status:get(m,r,'STATUS'), meta:m.getRecordMetadata?.(id)||{}, record:r});
      });
      return rows;
    }
    async function allRows(){
      let m=model(),count=0;m.forEach(()=>count++);
      const total=Number(m.getTotalRecords?.() ?? -1);
      if(total<0 || count<total){
        if(typeof m.fetchAll!=='function')throw new Error('APEX grid cannot load all rows.');
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('Loading official audit rows timed out')),20000);
          let finished=false;
          const done=e=>{if(finished)return;finished=true;clearTimeout(timer);e?reject(e):resolve()};
          try{const p=m.fetchAll(status=>{if(status?.done)done()});
              if(p===null||p===false){const current=snapshot(model()); if(current.length>=total)done(); else done(new Error('Grid busy: refresh the official page and reconnect.'));}
              else if(p?.catch)p.catch(done);
          }catch(e){done(e)}
        });
      }
      m=model();const rows=snapshot(m),expected=Number(m.getTotalRecords?.()||rows.length);
      if(expected<0 || rows.length<expected)throw new Error(`Only ${rows.length}/${expected} official audit rows available; audit submissions blocked.`);
      return {rows,total:expected};
    }
    // Cache the full serial index within this audit tab. Reconnecting or a page
    // refresh causes a new read. Status verification always re-reads the model.
    let state=window.__nonInventoryState;
    if(command.op==='inspect'||!state||state.site!==siteName||state.model!==model()||Date.now()-state.at>180000){
      const data=await allRows();state={...data,site:siteName,model:model(),at:Date.now()};window.__nonInventoryState=state;
    }
    if(command.op==='inspect'){
      const indexed=state.rows.filter(r=>r.serials.length).length;
      if(!indexed)return fail('Official grid has no serials to match. CSV-only mode remains available.');
      return {ok:true,total:state.total,indexed,
        notAudited:state.rows.filter(r=>/^not audited$/i.test(r.status)).length,
        note:indexed<state.total?'Some official rows have no serial match. Unknown serials will be skipped.':'Full row index available.'};
    }
    if(command.op==='verify_many'){
      const fresh=await allRows();
      const failed=command.serials.filter(serial=>{
        const rows=fresh.rows.filter(r=>r.serials.includes(n(serial)));
        return rows.length!==1||!/^(?:staged for audit|audited|finalized)$/i.test(rows[0].status)||rows[0].meta.updated||rows[0].meta.inserted||rows[0].meta.error;
      });return {ok:true,failed};
    }
    const serial=n(command.serial);
    if(!/^[A-Z0-9][A-Z0-9 ._:/+\-]{1,119}$/.test(serial))return fail('Invalid barcode');
    const compact=v=>n(v).replace(/[ ._:/+\-]/g,'');
    const find=rows=>{const exact=rows.filter(r=>r.serials.includes(serial));return exact.length?exact:rows.filter(r=>r.serials.some(s=>compact(s)===compact(serial)));};
    const confirmed=r=>/^(?:staged for audit|audited|finalized)$/i.test(r.status)&&!r.meta?.inserted&&!r.meta?.updated&&!r.meta?.error;
    let matches=find(state.rows);
    if(matches.length>1)return {ok:true,outcome:'needs_review',message:'Multiple audit rows match this barcode; no submission.'};
    if(command.op==='reconcile'){
      // Interrupted remote writes may have succeeded. Never blind-retry.
      const fresh=await allRows();state.rows=fresh.rows;state.at=Date.now();
      matches=find(fresh.rows);
      if(matches.length===1 && confirmed(matches[0]))
        return {ok:true,outcome:'audited',message:'Verified staged after reconnect.'};
      if(matches.length===0)return {ok:true,outcome:'needs_review',message:'Scan was interrupted; serial not found. Verify manually before retrying.'};
      return {ok:true,outcome:'needs_review',message:'Interrupted audit not confirmed. Verify official page manually.'};
    }
    if(command.op!=='stage')return fail('Unsupported action');
    if(matches.length===0)return {ok:true,outcome:'not_in_audit',message:'Not in loaded SPA1 serial index; official system not changed.'};
    // Re-read status immediately before a write; cached identifiers are only hints.
    const live=await allRows();state.rows=live.rows;
    matches=find(live.rows);
    if(matches.length!==1)return {ok:true,outcome:'needs_review',message:'Audit identity changed; no submission.'};
    const existing=matches[0];
    const m=model();
    if(typeof m.isChanged!=='function'||m.isChanged())return {ok:true,outcome:'needs_review',message:'Save or discard existing grid edits before scanning.'};
    const baseline=new Set(live.rows.map(r=>r.id));
    async function cleanup(){
      // Only a newly inserted, unsaved scan-only row is provably ours.
      // Persisted rows and rows carrying legitimate inventory identity are never deleted.
      const rows=snapshot(model());const added=rows.filter(r=>!baseline.has(r.id));
      if(added.length!==1)return false;
      const row=added[0], mm=model();
      if(mm!==m||!row.meta.inserted||row.meta.deleted||
         get(mm,row.record,'SERIAL_NUMBER')||get(mm,row.record,'ASSET_TAG')||
         n(get(mm,row.record,'SCANNED_ASSET_SERIAL'))!==n(get(m,existing.record,'SERIAL_NUMBER')||serial))return false;
      const changes=mm.getChanges?.();
      if(!Array.isArray(changes)||changes.length!==1||changes[0]!==row.record)return false;
      if(mm.deleteRecords([row.record])!==1)return false;
      // An inserted then deleted record has no persisted counterpart. Save only this model.
      const saved=mm.save();if(saved&&typeof saved.then==='function')await saved;
      if(mm.isChanged()||snapshot(mm).some(r=>r.id===row.id))return false;
      return true;
    }
    if(confirmed(existing))
      return {ok:true,outcome:'already_audited',message:'Previously staged.'};
    if(!/^not audited$/i.test(existing.status))
      return {ok:true,outcome:'needs_review',message:'Unexpected audit status: '+existing.status};
    if([...document.querySelectorAll('.ui-dialog,[role="dialog"]')].some(x=>x.getClientRects().length))
      return {ok:true,outcome:'needs_review',message:'Dismiss official dialog before continuing.'};
    const input=document.querySelector('#P4_SELECT_SERIAL');
    // Clear stale flag before invoking the page's own Enter-key dynamic action.
    if(document.querySelector('#P4_COUNTED_SERIAL'))document.querySelector('#P4_COUNTED_SERIAL').value='';
    apex.item('P4_SELECT_SERIAL').setValue(get(m,existing.record,'SERIAL_NUMBER')||serial,null,true);
    apex.jQuery(input).trigger(apex.jQuery.Event('keypress',{key:'Enter',which:13,keyCode:13}));
    const started=Date.now(), deadline=started+18000;
    async function changed(){
      await new Promise(resolve=>{
        let sub=null;const jq=apex.jQuery('#CYCLE_COUNT');
        const done=()=>{clearTimeout(timer);try{if(sub!==null)m.unSubscribe(sub);jq.off?.('apexafterrefresh.nonInventory',done);}catch(_){}resolve();};
        const timer=setTimeout(done,1000);
        try{jq.one?.('apexafterrefresh.nonInventory',done);sub=m.subscribe?.({onChange:done});}catch(_){}
      });
    }
    let nextFullRead=started+2300;
    while(Date.now()<deadline){
      const code=String(document.querySelector('#P4_COUNTED_SERIAL')?.value||'');
      // Return codes alone never prove row identity or successful staging.
      if(['2','3','4','7','8','9'].includes(code)){
        const removed=await cleanup();
        return {ok:true,outcome:'needs_review',message:removed?'Verified new unsaved error row removed; scan still requires review.':'Official inventory exception '+code+'. No safe deletion proof; review site.'};
      }
      // Do not assume a counter increment is proof. Confirm the matching row.
      const current=snapshot(model());
      const added=current.filter(r=>!baseline.has(r.id));
      if(added.length){
        const removed=await cleanup();
        return {ok:true,outcome:'needs_review',message:removed?'Verified new unsaved error row removed. Review scan before continuing.':'Unexpected new row; deletion identity not proven. Review official grid.'};
      }
      const candidate=find(current);
      if(candidate.length===1 && candidate[0].id===existing.id && confirmed(candidate[0])){
        state.rows=state.rows.map(r=>r.id===existing.id?{...r,status:'Staged for Audit'}:r);state.at=Date.now();
        return {ok:true,outcome:'audited',message:'Confirmed by official grid.'};
      }
      // Some APEX reports show only the first page after a refresh. Reindex
      // earlier instead of wasting the full 18-second verification window.
      if(Date.now()>=nextFullRead){
        try{
          const full=await allRows();state.rows=full.rows;state.at=Date.now();
          const match=find(full.rows);
          if(match.length===1 && match[0].id===existing.id && confirmed(match[0]))
            return {ok:true,outcome:'audited',message:'Verified in refreshed audit index.'};
        }catch(_){}
        nextFullRead=Date.now()+4500;
      }
      await changed();
    }
    // Site may refresh to a paginated first page. One complete read to verify.
    const check=await allRows();state.rows=check.rows;state.at=Date.now();
    const verified=find(check.rows);
    if(verified.length===1 && verified[0].id===existing.id && confirmed(verified[0]))
      return {ok:true,outcome:'audited',message:'Verified after full grid refresh.'};
    return {ok:true,outcome:'needs_review',message:'No verified staging after submission. Do not rescan until reviewed.'};
  }catch(e){return fail(String(e.message||e))}
}
