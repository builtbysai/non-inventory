'use strict';
const $=id=>document.getElementById(id);
const send=async msg=>{const r=await browser.runtime.sendMessage(msg);if(!r?.ok)throw new Error(r?.message||r?.error||'Unknown error');return r;};
const host=payload=>send({action:'host',payload});
let connected=false,paused=false,busy=false,queue=[],allTabs=[],speechOn=true;
const sound={capture:760,found:1080,audited:920,duplicate:560,review:255};
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function focusInput(){if(!document.querySelector('dialog[open]') && !['login','tabs'].includes(document.activeElement?.id))$('serial').focus({preventScroll:true});}
function announce(tone,words=''){
  try{const C=window.AudioContext||window.webkitAudioContext;const a=new C();const osc=a.createOscillator(),gain=a.createGain();osc.type='sine';osc.frequency.value=sound[tone]||550;gain.gain.value=.055;osc.connect(gain);gain.connect(a.destination);osc.start();osc.stop(a.currentTime+.10);osc.onended=()=>a.close();}catch(_){}
  if(speechOn&&words&&window.speechSynthesis){speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(words);u.rate=1.2;u.volume=.85;speechSynthesis.speak(u);}
}
function notice(kind,title,description){$('result').className='result '+(kind||'');$('symbol').textContent=kind==='error'?'×':kind==='warn'?'!':'✓';$('resultTitle').textContent=title;$('resultMessage').textContent=description||'';}
function setPaused(value){paused=value;$('pause').innerHTML=paused?'Resume <kbd>F9</kbd>':'Pause <kbd>F9</kbd>';$('state').textContent=paused?'Paused':connected?'Official audit connected':'Local capture only';$('state').className='state '+(paused?'paused':connected?'connected':'');if(!paused)void processQueue();}
async function persistOptions(){await browser.storage.local.set({login:$('login').value,voice:$('voice').checked,csvOnly:$('csvOnly').checked});speechOn=$('voice').checked;}
async function state(){
  try{
    const s=await host({action:'status'});
    $('countScanned').textContent=s.scanned;$('countFound').textContent=s.found;$('countAudited').textContent=s.audit.audited||0;
    $('countQueued').textContent=(s.audit.queued||0)+(s.audit.sending||0)+(s.audit.needs_review||0)+(s.audit.offline||0);
    $('footer').textContent=s.files.length+' investigation CSVs ready';
    $('files').replaceChildren();for(const name of s.files){const d=document.createElement('div');d.className='file';d.textContent=name;$('files').append(d);}
    $('activity').replaceChildren();for(const item of s.recent.slice(0,14)){
      const li=document.createElement('li'),serial=document.createElement('span'),result=document.createElement('span'),time=document.createElement('time');
      serial.className='serial';serial.textContent=item.serial;result.className='label';result.textContent=(item.investigation==='found'?'MISSING FOUND · ':'')+item.audit.replaceAll('_',' ');time.textContent=new Date(item.scanned_at).toLocaleTimeString();
      li.append(serial,result,time);$('activity').append(li);
    }
    return s;
  }catch(e){$('footer').textContent='Local companion not available';notice('error','Local companion not connected',e.message);return null;}
}
async function tabs(){const r=await send({action:'tabs'});allTabs=r.tabs;const selected=$('tabs').value;$('tabs').replaceChildren();
  for(const t of allTabs){const o=document.createElement('option');o.value=t.id;o.textContent=t.title||new URL(t.url).host;o.title=t.url;$('tabs').append(o)}
  if([...$('tabs').options].some(o=>o.value===selected))$('tabs').value=selected;
  else {const t=allTabs.find(t=>/audit|inventory|cycle count/i.test(t.title));if(t)$('tabs').value=t.id;}
}
async function connect(){
  const t=allTabs.find(t=>t.id===Number($('tabs').value));if(!t){notice('error','No audit tab','Open the official inventory page and refresh tabs.');return;}
  // Request origin permission from a direct click, before any asynchronous tab calls.
  const origin=new URL(t.url).origin+'/*';
  if(!await browser.permissions.request({origins:[origin]})){notice('error','Permission denied','The audit site needs browser permission.');return;}
  $('connect').disabled=true;
  try{
    const r=await send({action:'connect',tabId:t.id});connected=true;
    $('auditInfo').textContent=`${r.total} rows loaded · ${r.indexed} with serials · ${r.notAudited} not audited. ${r.note}`;
    setPaused(false);notice('','Official site connected','Scanning can begin. Pending captures will be submitted.');await reloadQueue();
  }catch(e){connected=false;notice('error','Cannot connect to APEX',e.message);setPaused(true);}
  finally{$('connect').disabled=false;focusInput();}
}
async function reloadQueue(){
  const r=await host({action:'pending'});
  queue=r.pending.map(s=>({id:s.id,serial:s.serial,found:s.investigation==='found',sending:s.audit==='sending',matches:s.matches}));
  $('modeText').textContent=`${queue.length} queued / persistent`;
  if(!paused)void processQueue();
}
async function capture(raw){
  const serial=String(raw||'').trim();if(!serial)return;
  const login=$('login').value.trim();if(!login){setPaused(true);notice('error','Enter your login','Your technician login is required for CSV tracking.');announce('review','Enter your login');return;}
  try{
    const rec=await host({action:'scan',serial,username:login});
    const found=rec.investigation==='found';queue.push({id:rec.id,serial:rec.serial,found,sending:false,matches:rec.matches.length});
    $('modeText').textContent=`${queue.length} audit items queued`;
    notice('',found?(rec.repeat?'Missing item seen again':'Missing item found'):'Captured '+rec.serial,
      found?`${rec.matches.length} investigation record(s) updated. Official audit queued.`:'Saved locally. Official audit queued.');
    announce(found?'found':'capture',found?'Missing item found':'');await state();
    if(queue.length>200){setPaused(true);notice('warn','Queue is full','200 captures queued. Pause scanning until the browser catches up.');announce('review','Queue full');}
    if(!paused)void processQueue();
  }catch(e){
    if(/Unsupported barcode|product item number/i.test(e.message)){notice('warn','Barcode ignored',e.message);announce('duplicate','Invalid barcode');}
    else {setPaused(true);notice('error','Capture not saved',e.message);announce('review','Scan capture failed');}
  }finally{focusInput()}
}
async function processQueue(){
  if(busy||paused||!queue.length)return;
  if(!connected&&!$('csvOnly').checked)return;
  busy=true;
  try{
    while(queue.length&&!paused&&(connected||$('csvOnly').checked)){
      const item=queue[0];let outcome='',message='';
      try{
        if($('csvOnly').checked){outcome='csv_only';message='Investigation only. Official site not changed.';}
        else if(item.sending){const r=await send({action:'reconcile',serial:item.serial});outcome=r.outcome;message=r.message;}
        else {
          // Durable state before any external write: interrupted scans are
          // reconciled read-only after a Firefox restart, never blind-retried.
          await host({action:'audit_result',id:item.id,outcome:'sending',message:'Submitting to official browser tab'});
          const r=await send({action:'stage',serial:item.serial});outcome=r.outcome;message=r.message;
        }
        await host({action:'audit_result',id:item.id,outcome,message});queue.shift();
        if(outcome==='audited'){notice('',item.found?'Found and audited':'Audit confirmed',item.serial+' · '+message);announce('audited',item.found?'Found and audited':'Audited');}
        else if(outcome==='already_audited') {notice('', 'Already audited',item.serial+' · '+message);announce('duplicate');}
        else if(outcome==='not_in_audit'){notice('warn','Not on official audit',item.serial+' · '+message);announce('duplicate');}
        else if(outcome==='needs_review'){notice('error','Official audit needs review',item.serial+' · '+message);setPaused(true);announce('review','Audit review needed. Scanning paused.');}
      }catch(e){
        // If a remote write may have occurred, do not resubmit. "sending"
        // remains in the local journal for safe reconciliation on reconnect.
        notice('error','Official audit connection interrupted',item.serial+' · '+e.message);
        connected=false;setPaused(true);announce('review','Audit connection lost.');break;
      }finally{$('modeText').textContent=`${queue.length} pending official updates`;await state();}
    }
  }finally{busy=false;focusInput();}
}
function modal(title){$('dialogTitle').textContent=title;$('dialogBody').replaceChildren();$('dialog').showModal();}
async function exceptions(){
  const r=await host({action:'exceptions'});modal('Pending & exceptions');
  if(!r.exceptions.length){$('dialogBody').textContent='No unresolved scans.';return;}
  for(const x of r.exceptions){const d=document.createElement('div');d.className='exceptionrow';d.textContent=x.serial+'   /   '+x.audit+'   /   '+x.detail;$('dialogBody').append(d);}
}
async function found(){
  const r=await host({action:'found_list'});modal('Found items · Edit later');
  for(const item of r.found){
    const row=document.createElement('div');row.className='reviewrow';const name=document.createElement('strong');name.textContent=item.serial;
    const loc=document.createElement('input');loc.placeholder='Found location';loc.value=item.location||'';loc.setAttribute('aria-label','Location for '+item.serial);
    const notes=document.createElement('input');notes.placeholder='Notes';notes.value=item.notes||'';notes.setAttribute('aria-label','Notes for '+item.serial);
    const btn=document.createElement('button');btn.textContent='Save';btn.addEventListener('click',async()=>{
      try{const result=await host({action:'update_details',serial:item.serial,location:loc.value,notes:notes.value});btn.textContent='Saved '+result.updated;}
      catch(e){btn.textContent='Failed';btn.title=e.message}
    });row.append(name,loc,notes,btn);$('dialogBody').append(row);
  }
  if(!r.found.length)$('dialogBody').textContent='No missing items found yet.';
}
$('serial').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const serial=$('serial').value;$('serial').value='';void capture(serial)}});
document.addEventListener('keydown',e=>{if(e.key==='F8'){e.preventDefault();$('serial').focus();}if(e.key==='F9'){e.preventDefault();setPaused(!paused);}});
$('pause').addEventListener('click',()=>setPaused(!paused));$('connect').addEventListener('click',connect);$('refresh').addEventListener('click',()=>void tabs());
$('review').addEventListener('click',()=>void found());$('exceptions').addEventListener('click',()=>void exceptions());
$('close').addEventListener('click',()=>$('dialog').close());$('dialog').addEventListener('close',focusInput);
for(const id of ['login','voice','csvOnly'])$(id).addEventListener('change',()=>{void persistOptions();if(id==='csvOnly')void processQueue();});
(async()=>{
  const s=await browser.storage.local.get(['login','voice','csvOnly']);$('login').value=s.login||'';$('voice').checked=s.voice!==false;$('csvOnly').checked=s.csvOnly===true;speechOn=$('voice').checked;
  try{await tabs()}catch(_){};const info=await state();if(info){await reloadQueue();notice('','Ready to scan','Investigation CSVs are loaded. Connect the official audit tab.');}
  focusInput();
})();
