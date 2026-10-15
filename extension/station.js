'use strict';
const $=id=>document.getElementById(id);
async function send(msg){const r=await browser.runtime.sendMessage(msg);if(!r?.ok)throw new Error(r?.message||r?.error||'Companion unavailable');return r;}
const host=payload=>send({action:'host',payload});
let paused=true,speechOn=false,allTabs=[],inputMode='station',refreshing=false,lastScanned=0,seenFound=new Set(),initialRefresh=true;
function notice(kind,title,message=''){$('result').className='result '+kind;$('symbol').textContent=kind==='error'?'×':kind==='warn'?'!':'✓';$('resultTitle').textContent=title;$('resultMessage').textContent=message;}
function announce(kind,words=''){
  try{const audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain();osc.frequency.value=({capture:760,found:1080,audited:920,duplicate:560,review:255})[kind]||550;gain.gain.value=.06;osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+.12);osc.onended=()=>audio.close();}catch(_){}
  if(speechOn&&words&&window.speechSynthesis){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(words));}
}
function focusInput(){if(inputMode==='station'&&!document.querySelector('dialog[open]'))$('serial').focus();}
async function setPaused(value){paused=value;await send({action:'pause',value});await refresh();}
async function tabs(){const r=await send({action:'tabs'});allTabs=r.tabs;$('tabs').replaceChildren();for(const t of allTabs){const o=document.createElement('option');o.value=t.id;o.textContent=t.title||new URL(t.url).host;$('tabs').append(o);}const candidate=allTabs.find(t=>/audit|inventory/i.test(t.title));if(candidate)$('tabs').value=candidate.id;}
async function connect(){
  const t=allTabs.find(t=>t.id===Number($('tabs').value));if(!t)return notice('error','Open an inventory tab first');
  try{
    if(!await browser.permissions.request({origins:[new URL(t.url).origin+'/*']}))return;
    const r=await send({action:'connect',tabId:t.id});$('auditInfo').textContent=`${r.total} rows · ${r.indexed} indexed · ${r.notAudited} not audited. ${r.note}`;
    notice('','Official audit connected','Validate one known staged and one known not-audited item before your cage walk.');await refresh();focusInput();
  }catch(e){notice('error','Cannot connect',e.message);}
}
async function capture(raw){
  if(inputMode!=='station')return; // Raw Input already captured the same keyboard wedge.
  try{
    // UUID retained for a transport retry so one physical capture has one receipt.
    const id=crypto.randomUUID();await host({action:'scan',serial:raw,username:$('login').value.trim(),id});
    notice('','Captured',raw+' · Saved to durable journal');announce('capture');await refresh();
  }catch(e){notice('error','Check capture journal before rescanning',e.message);announce('review','Capture needs attention');}
}
async function refresh(){
  if(refreshing)return;refreshing=true;
  try{
    const s=await host({action:'status'}),cfg=await browser.storage.local.get(['connected','paused']);paused=cfg.paused!==false;
    $('countScanned').textContent=s.scanned;$('countFound').textContent=s.found;$('countAudited').textContent=(s.audit.audited||0)+(s.audit.already_audited||0);
    $('countQueued').textContent=(s.audit.queued||0)+(s.audit.sending||0)+(s.audit.needs_review||0);
    $('modeText').textContent=`${s.csv_pending} CSV pending · ${s.audit.queued||0} audit queued`;
    $('state').textContent=paused?'Audit paused · capture continues':cfg.connected?'Official audit connected':'Local capture';$('state').className='state '+(paused?'paused':'connected');$('pause').textContent=paused?'Resume audit · F9':'Pause audit · F9';
    $('footer').textContent=s.files.length+' local CSVs';$('files').replaceChildren();for(const name of s.files){const d=document.createElement('div');d.className='file';d.textContent=name;$('files').append(d);}
    $('activity').replaceChildren();for(const item of s.recent){const li=document.createElement('li');const label=document.createElement('span');label.className='serial';label.textContent=item.serial;const result=document.createElement('span');result.textContent=`${item.investigation} / ${item.csv_state==='done'?item.audit:'CSV pending: '+item.csv_error}`;li.append(label,result);$('activity').append(li);}
    const newlyFound=s.recent.filter(r=>r.investigation==='found'&&!seenFound.has(r.id));
    for(const r of newlyFound)seenFound.add(r.id);
    if(!initialRefresh&&newlyFound.length)announce('found','Missing item found');initialRefresh=false;
    if(lastScanned&&s.scanned>lastScanned&&inputMode!=='station')announce('capture');lastScanned=s.scanned;
    const h=await host({action:'health'});const age=Date.now()-Date.parse(h.health.at||0);$('health').textContent=age<5000?h.health.input:'Companion offline or stale; device capture unavailable. Run START.cmd.';
  }catch(e){notice('error','Companion unavailable',e.message);}
  finally{refreshing=false;}
}
function modal(title){$('dialogTitle').textContent=title;$('dialogBody').replaceChildren();$('dialog').showModal();}
async function exceptions(){
  try{
    const r=await host({action:'exceptions'});modal('Pending & exceptions');
    if(!r.exceptions.length)$('dialogBody').textContent='No unresolved scans.';
    for(const x of r.exceptions){
      const row=document.createElement('div');row.className='exceptionrow';const text=document.createElement('p');text.textContent=`${x.serial} / ${x.audit} / ${x.csv_error||x.detail}`;row.append(text);
      if(['needs_review','not_in_audit','offline'].includes(x.audit)&&x.csv_state==='done'){
        const note=document.createElement('input');note.placeholder='What did you verify on the official site?';note.setAttribute('aria-label','Resolution for '+x.serial);
        const button=document.createElement('button');button.textContent='Record manual resolution';button.onclick=async()=>{try{await host({action:'resolve',id:x.id,note:note.value});row.textContent=x.serial+' · resolution recorded';}catch(e){notice('error','Resolution not saved',e.message);}};
        row.append(note,button);
      }
      $('dialogBody').append(row);
    }
  }catch(e){notice('error','Review unavailable',e.message);}
}
async function found(){
  try{const r=await host({action:'found_list'});modal('Found items');for(const x of r.found){const row=document.createElement('div');row.className='reviewrow';const label=document.createElement('strong');label.textContent=x.serial+' · '+x.last_seen;
    const location=document.createElement('input'),notes=document.createElement('input');location.placeholder='Location (replaces current value)';notes.placeholder='Notes (replaces current value)';location.setAttribute('aria-label','Location for '+x.serial);notes.setAttribute('aria-label','Notes for '+x.serial);
    location.value=x.location||'';notes.value=x.notes||'';const button=document.createElement('button');button.textContent='Save details';button.onclick=async()=>{try{await host({action:'update_details',serial:x.serial,location:location.value,notes:notes.value});button.textContent='Saved';}catch(e){button.textContent=e.message;}};row.append(label,location,notes,button);$('dialogBody').append(row);}}
  catch(e){notice('error','Found list unavailable',e.message);}
}
async function saveInput(){
  try{
    const mode=$('inputMode').value;if(mode==='hid'&&!$('device').value)throw new Error('Choose the scanner device');
    await host({action:'configure',values:{username:$('login').value.trim(),input_mode:mode,device:$('device').value,port:$('comPort').value.trim(),baud:Number($('baud').value),capture_enabled:$('captureEnabled').checked}});
    inputMode=mode;$('serial').readOnly=mode!=='station';await browser.storage.local.set({login:$('login').value.trim()});notice('','Scanner settings saved');
  }catch(e){notice('error','Settings not saved',e.message);}
}
$('serial').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const value=$('serial').value;$('serial').value='';if(value)void capture(value);}};
document.onkeydown=e=>{if(e.key==='F8'){e.preventDefault();focusInput();}if(e.key==='F9'){e.preventDefault();void setPaused(!paused);}};
$('pause').onclick=()=>void setPaused(!paused);$('refresh').onclick=()=>void tabs();$('connect').onclick=connect;$('saveInput').onclick=saveInput;
$('devicesRefresh').onclick=async()=>{try{const selected=$('device').value;const r=await host({action:'devices'});$('device').replaceChildren();for(const name of r.devices){const option=document.createElement('option');option.value=name;option.textContent=name;$('device').append(option);}$('device').value=selected;}catch(e){notice('error','Device list unavailable',e.message);}};
$('review').onclick=found;$('exceptions').onclick=exceptions;$('close').onclick=()=>$('dialog').close();$('dialog').onclose=focusInput;
$('csvOnly').onchange=()=>browser.storage.local.set({csvOnly:$('csvOnly').checked});$('voice').onchange=()=>{speechOn=$('voice').checked;void browser.storage.local.set({voice:speechOn});};
$('complete').onclick=async()=>{try{
  await setPaused(true);
  await host({action:'configure',values:{capture_enabled:false}});$('captureEnabled').checked=false;
  // Read-only reconciliation of every successfully staged receipt in this session.
  const result=await send({action:'complete'});notice('','Reconciliation recorded',result.completed_at+' · Confirm the official site finalization separately.');
}catch(e){notice('error','Audit cannot be marked complete',e.message);}};
browser.runtime.onMessage.addListener(m=>{if(m.action!=='event')return;if(m.type==='error'){notice('error','Audit paused; capture continues',m.message);announce('review','Audit needs attention');}
 else{notice(m.outcome==='needs_review'?'error':'',m.serial+' · '+m.outcome,m.message);announce(m.outcome==='audited'?'audited':m.outcome==='needs_review'?'review':'duplicate',m.outcome==='audited'?'Audited':'');}void refresh();});
(async()=>{try{
  const local=await browser.storage.local.get(['voice','csvOnly']);speechOn=local.voice===true;$('voice').checked=speechOn;$('csvOnly').checked=local.csvOnly===true;
  const {config:c}=await host({action:'config'});$('login').value=c.username||'';inputMode=c.input_mode||'station';$('inputMode').value=inputMode;$('comPort').value=c.port||'COM3';$('baud').value=c.baud||9600;$('captureEnabled').checked=c.capture_enabled!==false;$('serial').readOnly=inputMode!=='station';
  const ds=await host({action:'devices'});for(const name of ds.devices){const option=document.createElement('option');option.value=name;option.textContent=name;$('device').append(option);}if(c.device)$('device').value=c.device;
  await tabs();await refresh();focusInput();
}catch(e){notice('error','First-run setup unavailable',e.message);}setInterval(()=>void refresh(),1200);})();
