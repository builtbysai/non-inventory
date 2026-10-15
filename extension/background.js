/* Firefox-only coordinator. No cookie access, credentials, or vendor API calls. */
'use strict';
let port, seq=0;
const inflight=new Map();
function host(command) {
  if (!port) {
    port=browser.runtime.connectNative('non_inventory_host');
    port.onMessage.addListener(m=>{
      const entry=inflight.get(m.requestId); if(!entry)return;
      clearTimeout(entry.t);inflight.delete(m.requestId);
      (m.ok?entry.resolve:entry.reject)(m.ok?m:new Error(m.error||'Local companion failed'));
    });
    port.onDisconnect.addListener(()=>{
      const reason=browser.runtime.lastError?.message||'Local companion disconnected';
      for(const item of inflight.values()){clearTimeout(item.t);item.reject(new Error(reason));}
      inflight.clear();port=null;
    });
  }
  return new Promise((resolve,reject)=>{
    const id=String(++seq),t=setTimeout(()=>{inflight.delete(id);reject(new Error('Local companion timed out'));},20000);
    inflight.set(id,{t,resolve,reject});
    try{port.postMessage({...command,requestId:id});}catch(e){inflight.delete(id);clearTimeout(t);reject(e)}
  });
}
async function inject(tabId,request){
  const scripts=await browser.scripting.executeScript({target:{tabId},world:'MAIN',func:apexWork,args:[request]});
  const result=scripts?.[0]?.result;
  if(!result?.ok)throw new Error(result?.message||'Official tab unavailable');
  return result;
}
async function activeAuditTab(){
  const {tabId,origin}=await browser.storage.local.get(['tabId','origin']);
  if (!Number.isInteger(tabId)||!origin)throw new Error('Connect the official audit tab first.');
  const tab=await browser.tabs.get(tabId);
  if(new URL(tab.url).origin!==origin)throw new Error('Audit tab navigated to a different website; reconnect.');
  return tabId;
}
async function route(msg){
  if(msg.action==='host')return host(msg.payload);
  if(msg.action==='tabs'){
    const tabs=await browser.tabs.query({});
    return {ok:true,tabs:tabs.filter(t=>/^https?:/.test(t.url||'')).map(t=>({id:t.id,title:t.title,url:t.url}))};
  }
  if(msg.action==='connect'){
    const tab=await browser.tabs.get(Number(msg.tabId));
    const u=new URL(tab.url);
    if(u.protocol!=='https:' && u.protocol!=='http:')throw new Error('Select an ordinary browser tab');
    if(!await browser.permissions.contains({origins:[u.origin+'/*']}))throw new Error('Allow access to the selected official site first.');
    const result=await inject(tab.id,{op:'inspect'});
    await browser.storage.local.set({tabId:tab.id,origin:u.origin});
    return result;
  }
  if(['inspect','stage','reconcile'].includes(msg.action)){
    const tabId=await activeAuditTab();
    return inject(tabId,{op:msg.action,serial:msg.serial});
  }
  throw new Error('Unknown command');
}
browser.runtime.onMessage.addListener(msg=>route(msg).catch(e=>({ok:false,message:String(e.message||e)})));

// Runs within the already-authenticated Oracle APEX page's MAIN world.
async function apexWork(command){
  const n=v=>String(v??'').trim().toUpperCase(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const fail=message=>({ok:false,message});
  try{
    if(!document.querySelector('#P4_SELECT_SERIAL')||!document.querySelector('#CYCLE_COUNT')||!window.apex?.region)
      return fail('Not the Field IT Audit Count page. Open the actual live APEX audit.');
    const site=document.querySelector('#P4_SITE');
    const siteName=site?.selectedOptions?.[0]?.textContent||site?.value||'';
    if(!n(siteName).includes('SPA1'))return fail('Select SPA1 on the inventory website.');
    const region=apex.region('CYCLE_COUNT');
    const model=()=>region.widget().interactiveGrid('getCurrentView').model;
    function get(m,record,key){
      try{const v=m.getValue(record,key);return String(v&&typeof v==='object'?(v.v??v.d??''):v??'').trim();}
      catch(_){return ''}
    }
    function snapshot(m){
      const rows=[];
      m.forEach((r,index,id)=>{
        const fields=['SERIAL_NUMBER','SCANNED_ASSET_SERIAL','ASSET_TAG'];
        rows.push({id:String(id),serials:fields.map(f=>n(get(m,r,f))).filter(Boolean),status:get(m,r,'STATUS')});
      });
      return rows;
    }
    async function allRows(){
      let m=model(),count=0;m.forEach(()=>count++);
      const total=Number(m.getTotalRecords?.()||count);
      if(count<total){
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
      if(rows.length<expected)throw new Error(`Only ${rows.length}/${expected} official audit rows available; audit submissions blocked.`);
      return {rows,total:expected};
    }
    // Cache the full serial index within this audit tab. Reconnecting or a page
    // refresh causes a new read. Status verification always re-reads the model.
    let state=window.__nonInventoryState;
    if(command.op==='inspect'||!state||state.site!==siteName||Date.now()-state.at>180000){
      const data=await allRows();state={...data,site:siteName,at:Date.now()};window.__nonInventoryState=state;
    }
    if(command.op==='inspect'){
      const indexed=state.rows.filter(r=>r.serials.length).length;
      if(!indexed)return fail('Official grid has no serials to match. CSV-only mode remains available.');
      return {ok:true,total:state.total,indexed,
        notAudited:state.rows.filter(r=>/not audited/i.test(r.status)).length,
        note:indexed<state.total?'Some official rows have no serial match. Unknown serials will be skipped.':'Full row index available.'};
    }
    const serial=n(command.serial);
    if(!/^[A-Z0-9][A-Z0-9._/-]{1,29}$/.test(serial))return fail('Invalid barcode');
    let matches=state.rows.filter(r=>r.serials.includes(serial));
    if(matches.length>1)return {ok:true,outcome:'needs_review',message:'Multiple audit rows match this barcode; no submission.'};
    if(command.op==='reconcile'){
      // Interrupted remote writes may have succeeded. Never blind-retry.
      const fresh=await allRows();state.rows=fresh.rows;state.at=Date.now();
      matches=fresh.rows.filter(r=>r.serials.includes(serial));
      if(matches.length===1 && /staged for audit/i.test(matches[0].status))
        return {ok:true,outcome:'audited',message:'Verified staged after reconnect.'};
      if(matches.length===0)return {ok:true,outcome:'needs_review',message:'Scan was interrupted; serial not found. Verify manually before retrying.'};
      return {ok:true,outcome:'needs_review',message:'Interrupted audit not confirmed. Verify official page manually.'};
    }
    if(command.op!=='stage')return fail('Unsupported action');
    if(matches.length===0)return {ok:true,outcome:'not_in_audit',message:'Not in loaded SPA1 serial index; official system not changed.'};
    const existing=matches[0];
    if(/staged for audit|^audited$|finalized/i.test(existing.status))
      return {ok:true,outcome:'already_audited',message:'Previously staged.'};
    if(!/not audited/i.test(existing.status))
      return {ok:true,outcome:'needs_review',message:'Unexpected audit status: '+existing.status};
    if([...document.querySelectorAll('.ui-dialog,[role="dialog"]')].some(x=>x.getClientRects().length))
      return {ok:true,outcome:'needs_review',message:'Dismiss official dialog before continuing.'};
    const input=document.querySelector('#P4_SELECT_SERIAL');
    // Clear stale flag before invoking the page's own Enter-key dynamic action.
    if(document.querySelector('#P4_COUNTED_SERIAL'))document.querySelector('#P4_COUNTED_SERIAL').value='';
    apex.item('P4_SELECT_SERIAL').setValue(serial,null,true);
    apex.jQuery(input).trigger(apex.jQuery.Event('keypress',{key:'Enter',which:13,keyCode:13}));
    const deadline=Date.now()+18000;
    while(Date.now()<deadline){
      await sleep(450);
      const code=String(document.querySelector('#P4_COUNTED_SERIAL')?.value||'');
      if(code==='1')return {ok:true,outcome:'already_audited',message:'Official site reports already scanned.'};
      if(['2','3','4','7','8','9'].includes(code))
        return {ok:true,outcome:'needs_review',message:'Official inventory returned exception code '+code+'. Review site.'};
      // Do not assume a counter increment is proof. Confirm the matching row.
      const current=snapshot(model());
      const candidate=current.filter(r=>r.serials.includes(serial));
      if(candidate.length===1 && /staged for audit/i.test(candidate[0].status)){
        state.rows=state.rows.map(r=>r.id===existing.id?{...r,status:'Staged for Audit'}:r);state.at=Date.now();
        return {ok:true,outcome:'audited',message:'Confirmed by official grid.'};
      }
    }
    // Site may refresh to a paginated first page. One complete read to verify.
    const check=await allRows();state.rows=check.rows;state.at=Date.now();
    const verified=check.rows.filter(r=>r.serials.includes(serial));
    if(verified.length===1 && /staged for audit/i.test(verified[0].status))
      return {ok:true,outcome:'audited',message:'Verified after full grid refresh.'};
    return {ok:true,outcome:'needs_review',message:'No verified staging after submission. Do not rescan until reviewed.'};
  }catch(e){return fail(String(e.message||e))}
}
