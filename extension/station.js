'use strict';
const $=id=>document.getElementById(id);
const UI=window.StationUI;
const state={config:{},running:false,paused:true,connected:false,view:'recent',tabs:[],devices:[],seen:new Set(),initialized:false,refreshing:false,drawer:null,drafts:new Map(),feedbackSerial:null,resolutionId:null,identifying:false};
async function send(message){
  const result=await browser.runtime.sendMessage(message);
  if(!result?.ok)throw new Error(result?.message||result?.error||'Local connection unavailable.');
  return result;
}
const host=payload=>send({action:'host',payload});
function feedback(kind,title,message='',serial=null){
  $('feedback').className='feedback '+kind;$('feedbackTitle').textContent=title;$('feedbackText').textContent=message;
  $('feedback').querySelector('.feedback-mark').textContent=kind==='error'?'!':kind==='success'?'✓':kind==='warn'?'!':'•';
  state.feedbackSerial=serial;$('feedbackDetails').hidden=!serial;
}
function tone(kind,words=''){
  try{
    const audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain();
    osc.frequency.value=({capture:760,found:1080,repeat:540,audited:920,error:250})[kind]||650;
    gain.gain.value=.055;osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+.11);osc.onended=()=>audio.close();
  }catch(_){}
  if($('voice').checked&&words&&window.speechSynthesis){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(words));}
}
function error(message){feedback('error','Needs attention',message);tone('error');}
function showSettings(){updateModeOptions();$('settingsMessage').textContent='';$('settings').showModal();}
function focusScan(){
  if(!state.running)return;
  // F8 is an explicit request to return to scanning; background modes can use the same field as a focus sink.
  $('serial').focus({preventScroll:true});
}
async function toggleRunning(){
  const stopping=state.running;$('runButton').disabled=true;
  if(stopping){state.running=false;updateCapture();$('runButton').textContent='Stopping…';}
  try{
    if(!stopping&&!state.config.username){showSettings();return;}
    const result=await send({action:stopping?'stop':'start'});
    feedback('',stopping?(result.stopped?'Scanning stopped':'Stopping companion…'):'Scanning started',stopping?'Pending scans and your journal are retained.':'Scans are saved locally before the website is updated.');
    await refresh();if(!stopping)focusScan();
  }catch(e){error(e.message);}finally{$('runButton').disabled=false;}
}
function updateCapture(){
  const mode=state.config.input_mode||'station';
  $('serial').readOnly=!state.running||mode!=='station';
  $('serial').placeholder=!state.running?'Scanning stopped':mode==='station'?'Scan a barcode, then Enter':'Device capture is active';
  $('modeLabel').textContent=({station:'This scan field',hid:'Background USB',com:'Serial port · '+(state.config.port||'')})[mode];
  $('scanHint').textContent=!state.running?'Start scanning to resume. Your saved queue is retained.':mode==='station'?'Keep this field focused. Your scanner should append Enter.':'Scans are captured by the companion. Keep this window open for feedback.';
  $('runButton').textContent=state.running?'Stop scanning':'Start scanning';$('runButton').className=state.running?'danger':'primary';
  $('connection').textContent=state.running?'Companion running':'Stopped';$('connection').className='connection '+(state.running?'running':'');
  $('auditPause').textContent=state.paused?'Resume audit · F9':'Pause audit · F9';
}
async function capture(raw){
  if((state.config.input_mode||'station')!=='station'||!state.running)return;
  try{
    await host({action:'scan',id:crypto.randomUUID(),serial:raw,username:state.config.username});
    feedback('','Captured · '+raw,'Saved locally. Checking inventory references.');tone('capture');await refresh();
  }catch(e){error(e.message+' Check recent scans before rescanning.');}
}
function cell(row,text,className=''){const td=document.createElement('td');td.textContent=text;td.className=className;row.append(td);return td;}
function statusCell(row,label,kind=''){
  const td=document.createElement('td'),span=document.createElement('span');span.className='status '+kind;span.textContent=label;td.append(span);row.append(td);return td;
}
function detailsButton(row,serial){const td=document.createElement('td'),button=document.createElement('button');button.className='text-button';button.textContent='Add details';button.onclick=()=>openDetails(serial);td.append(button);row.append(td);}
async function renderRecords(status){
  const view=state.view;
  if($('tableBody').contains(document.activeElement))return;
  $('tableHead').replaceChildren();$('tableBody').replaceChildren();
  const columns=view==='recent'?['Serial / asset','Missing inventory','Official audit','Captured','']:view==='found'?['Serial','Monthly investigation','Last seen','Scans','']:['Serial / asset','What needs attention','Captured',''];
  const heading=document.createElement('tr');for(const label of columns){const th=document.createElement('th');th.scope='col';th.textContent=label;heading.append(th);}$('tableHead').append(heading);
  let records;
  if(view==='recent')records=status.recent;
  else if(view==='found')records=(await host({action:'found_list'})).found;
  else records=(await host({action:'exceptions'})).exceptions;
  $('viewHint').textContent=view==='recent'?'Latest 35 captures. The full history stays in your local journal.':view==='found'?'One row per missing item. Repeat scans refresh last-seen; details are optional.':'Pending work and exceptions. Resolve only after checking the official inventory.';
  if(state.view!==view)return;
  for(const item of records){
    const row=document.createElement('tr');cell(row,item.serial,'serial-value');
    if(view==='recent'){
      const [label,kind]=UI.missing(item);const missing=statusCell(row,label,kind);
      if(item.repeat&&item.investigation==='found'){const sub=document.createElement('small');sub.className='subtext';sub.textContent='Last-seen refreshed';missing.append(sub);}
      statusCell(row,...(item.csv_state!=='done'?['CSV pending','warn']:UI.audit[item.audit]||[item.audit,'']));
      cell(row,UI.time(item.scanned_at),'time');
      if(item.investigation==='found')detailsButton(row,item.serial);else cell(row,'');
    }else if(view==='found'){
      statusCell(row,item.scans>1?'Already found · seen again':'Found','success');cell(row,UI.time(item.last_seen),'time');cell(row,String(item.scans));detailsButton(row,item.serial);
    }else{
      const td=cell(row,item.csv_error||item.detail||UI.audit[item.audit]?.[0]||item.audit);td.style.maxWidth='420px';
      cell(row,UI.time(item.scanned_at),'time');const action=document.createElement('td');
      if(['needs_review','not_in_audit','offline'].includes(item.audit)&&item.csv_state==='done'){
        const button=document.createElement('button');button.className='text-button';button.textContent='Resolve';button.onclick=()=>openResolution(item);action.append(button);
      }row.append(action);
    }$('tableBody').append(row);
  }
  $('emptyState').hidden=records.length>0;
  $('emptyState').querySelector('strong').textContent=view==='review'?'Nothing to review':view==='found'?'No missing items found yet':'No scans yet';
  $('emptyState').querySelector('p').textContent=view==='review'?'New exceptions will appear here.':'Keep scanning. Items will appear automatically.';
}
async function refresh(){
  if(state.refreshing)return;state.refreshing=true;
  try{
    const status=await host({action:'status'}),config=(await host({action:'config'})).config;
    const health=(await host({action:'health'})).health;
    const options=await browser.storage.local.get(['connected','paused','auditSite']);
    state.config=config;state.running=health.running&&config.companion_enabled!==false;state.paused=options.paused!==false;state.connected=options.connected===true;
    updateCapture();
    const site=options.auditSite||config.audit_site;
    $('siteLabel').textContent=site?site.label:'Local investigation';
    $('sessionInfo').textContent=config.username?'Operator '+config.username+' · saved locally':'Save your login in Settings to begin.';
    $('capturedCount').textContent=status.scanned;$('foundCount').textContent=status.found;$('repeatCount').textContent=status.missing_repeats||0;$('auditCount').textContent=status.audited_unique||0;
    $('pendingCount').textContent=(status.audit.queued||0)+(status.audit.sending||0);$('reviewCount').textContent=status.review_count||0;
    $('localStatus').textContent=state.running?(health.input||'Companion running')+' · '+status.files.length+' investigation file(s)':'Companion stopped · local queue retained';
    $('auditStatus').textContent=state.connected?(state.paused?'Audit paused':'Audit connected')+(site?' · '+site.label:''):'Official audit not connected';
    $('files').replaceChildren();for(const file of status.files){const li=document.createElement('li');li.textContent=file;$('files').append(li);}
    if(!status.files.length){const li=document.createElement('li');li.textContent='No CSVs found. Add monthly investigation files to workspace.';$('files').append(li);}
    const newlyProcessed=status.recent.filter(x=>x.csv_state==='done'&&!state.seen.has(x.id));
    for(const item of newlyProcessed){
      state.seen.add(item.id);
      if(state.initialized&&item.investigation==='found'){
        const text=UI.foundFeedback(item);feedback('success',text.title,text.message,item.serial);tone(item.repeat?'repeat':'found',item.repeat?'Already found':'Missing item found');break;
      }
    }
    if(state.initialized&&!newlyProcessed.some(x=>x.investigation==='found')){
      const rejected=newlyProcessed.find(x=>['rejected','ambiguous'].includes(x.investigation));
      if(rejected){feedback(rejected.investigation==='ambiguous'?'error':'warn',rejected.investigation==='ambiguous'?'Ambiguous identifier':'Barcode ignored',rejected.detail);tone('error');}
    }
    for(const item of newlyProcessed)state.seen.add(item.id);
    state.initialized=true;
    if(state.identifying){
      if(config.identified_device){
        state.identifying=false;await loadDevices();$('device').value=config.identified_device;showDevicePath();
        $('identifyHint').textContent='Device identified. Save settings to use it. Your setup scan was not added to inventory.';$('identifyButton').disabled=false;$('identifyInput').hidden=true;
      }else if(config.identify_until<Date.now()/1000){state.identifying=false;$('identifyButton').disabled=false;$('identifyInput').hidden=true;$('identifyHint').textContent='No complete scan received. Try again and scan a barcode with an Enter suffix.';}
    }
    await renderRecords(status);
  }catch(e){$('connection').textContent='Connection needs attention';$('connection').className='connection error';$('localStatus').textContent=e.message;}
  finally{state.refreshing=false;}
}
function selectedMode(){return document.querySelector('input[name="inputMode"]:checked').value;}
function updateModeOptions(){
  const visible=UI.visibleMode(selectedMode());$('hidOptions').hidden=!visible.hid;$('comOptions').hidden=!visible.com;
  $('auditOptions').hidden=$('csvOnly').checked;
}
function cancelIdentification(){
  if(!state.identifying)return;
  state.identifying=false;$('identifyButton').disabled=false;$('identifyInput').hidden=true;
  void host({action:'configure',values:{identify_until:0}}).catch(()=>{});
}
function showDevicePath(){$('devicePath').textContent=$('device').value||'No device selected';}
async function loadDevices(){
  const result=await host({action:'devices'}),current=$('device').value||state.config.device;
  state.devices=result.devices;$('device').replaceChildren();
  const blank=document.createElement('option');blank.value='';blank.textContent='Choose or identify a device';$('device').append(blank);
  for(const device of result.devices){const option=document.createElement('option');option.value=device.path;option.textContent=device.label;$('device').append(option);}
  if(current&&!result.devices.some(d=>d.path===current)){const option=document.createElement('option');option.value=current;option.textContent='Saved device · currently disconnected';$('device').append(option);}
  $('device').value=current||'';showDevicePath();$('ports').replaceChildren();
  for(const port of result.ports||[]){const option=document.createElement('option');option.value=port.port;option.label=port.label;$('ports').append(option);}
}
async function loadTabs(){
  state.tabs=(await send({action:'tabs'})).tabs;const selected=$('auditTab').value;$('auditTab').replaceChildren();
  for(const tab of state.tabs){const option=document.createElement('option');option.value=tab.id;option.textContent=tab.title||new URL(tab.url).host;$('auditTab').append(option);}
  if(state.tabs.some(t=>String(t.id)===selected))$('auditTab').value=selected;
  else{const audit=state.tabs.find(t=>/audit|inventory/i.test(t.title));if(audit)$('auditTab').value=audit.id;}
}
async function connectAudit(){
  try{
    const tab=state.tabs.find(t=>t.id===Number($('auditTab').value));if(!tab)throw new Error('Open the official inventory tab, then refresh the list.');
    if(!await browser.permissions.request({origins:[new URL(tab.url).origin+'/*']}))throw new Error('Access to the selected inventory tab was not granted.');
    const result=await send({action:'connect',tabId:tab.id});
    $('auditInfo').textContent=result.site.label+' · '+result.total+' rows, '+result.indexed+' indexed. '+result.note;
    await refresh();
  }catch(e){$('auditInfo').textContent=e.message;}
}
async function saveSettings(event){
  event.preventDefault();$('settingsMessage').textContent='';
  try{
    const mode=selectedMode(),username=$('login').value.trim();
    if(!username)throw new Error('Enter your login.');
    if(mode==='hid'&&!$('device').value)throw new Error('Identify or select your USB scanner.');
    if(mode==='com'&&!/^COM\d+$/i.test($('comPort').value.trim()))throw new Error('Enter a COM port, for example COM3.');
    await host({action:'configure',values:{username,input_mode:mode,device:$('device').value,port:$('comPort').value.trim(),baud:Number($('baud').value)}});
    await browser.storage.local.set({voice:$('voice').checked,csvOnly:$('csvOnly').checked});
    $('settings').close();await refresh();feedback('','Settings saved',state.running?'Continue scanning.':'Select Start scanning when ready.');focusScan();
  }catch(e){$('settingsMessage').textContent=e.message;}
}
function rememberDraft(){
  if(!state.drawer)return;
  const record=state.drawer.records[Number($('detailRecord').value)];if(!record)return;
  const values={};for(const field of $('detailFields').querySelectorAll('[data-field]'))values[field.dataset.field]=field.value;
  const previous=state.drafts.get(record.file+':'+record.row);
  state.drafts.set(record.file+':'+record.row,{version:previous?.version||record.version,original:previous?.original||record.values,values});
}
function renderDetails(){
  const record=state.drawer.records[Number($('detailRecord').value)];$('detailFields').replaceChildren();$('detailReadOnly').replaceChildren();$('detailMessage').textContent='';
  if(!record){$('detailSave').disabled=true;$('detailMessage').textContent='No matching monthly record.';return;}
  const draft=state.drafts.get(record.file+':'+record.row);$('detailSave').disabled=!record.editable.length;
  for(const name of record.fields){
    if(record.editable.includes(name)){
      const label=document.createElement('label');label.textContent=name;
      const field=document.createElement(/notes/i.test(name)?'textarea':'input');field.dataset.field=name;field.value=draft?.values[name]??record.values[name];field.maxLength=4000;field.setAttribute('aria-label',name);field.oninput=rememberDraft;label.append(field);$('detailFields').append(label);
    }else{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=record.values[name]||'—';$('detailReadOnly').append(dt,dd);}
  }
  if(!record.editable.length)$('detailMessage').textContent='This CSV has no editable investigation fields. Original inventory values are read-only.';
}
async function openDetails(serial){
  try{
    rememberDraft();const result=await host({action:'investigation',serial});state.drawer=result;
    $('detailFocusHint').textContent=state.config.input_mode==='com'?'Serial capture continues while you edit.':state.config.input_mode==='hid'?'USB keyboard scanners also type into focused fields. Use COM to scan while editing, or edit between batches.':'F8 returns to the scan field. Your draft stays here.';
    $('detailTitle').textContent=serial;$('detailRecord').replaceChildren();
    result.records.forEach((record,index)=>{const option=document.createElement('option');option.value=index;option.textContent=record.file;$('detailRecord').append(option);});
    $('detailDrawer').hidden=false;document.body.classList.add('drawer-open');renderDetails();
    // Opening a form never pauses the worker or steals focus from a scan in progress.
  }catch(e){error(e.message);}
}
async function saveDetails(event){
  event.preventDefault();rememberDraft();const record=state.drawer.records[Number($('detailRecord').value)];if(!record)return;
  const key=record.file+':'+record.row,draft=state.drafts.get(key);const changes=UI.changedValues(record.values,draft?.values||{});
  if(!Object.keys(changes).length){$('detailMessage').textContent='No changes to save.';return;}
  try{
    const result=await host({action:'save_investigation',serial:state.drawer.serial,file:record.file,row:record.row,version:draft?.version||record.version,changes,expected:draft?.original||record.values,username:state.config.username});
    state.drafts.delete(key);const selected=$('detailRecord').value;
    state.drawer=await host({action:'investigation',serial:state.drawer.serial});$('detailRecord').value=selected;renderDetails();
    $('detailMessage').className='inline-message success';$('detailMessage').textContent=result.updated+' field(s) saved. Original file backed up.';
  }catch(e){$('detailMessage').className='inline-message';$('detailMessage').textContent=e.message+' Your draft is kept here.';}
}
function closeDetails(){rememberDraft();$('detailDrawer').hidden=true;document.body.classList.remove('drawer-open');focusScan();}
function openResolution(item){state.resolutionId=item.id;$('reviewTitle').textContent='Resolve '+item.serial;$('reviewDescription').textContent=item.detail||item.csv_error||item.audit;$('resolution').value='';$('reviewMessage').textContent='';$('reviewDialog').showModal();}
async function resolve(event){event.preventDefault();try{await host({action:'resolve',id:state.resolutionId,note:$('resolution').value});$('reviewDialog').close();await refresh();}catch(e){$('reviewMessage').textContent=e.message;}}
async function finish(){
  try{
    await send({action:'pause',value:true});await send({action:'stop'});await refresh();
    const result=await send({action:'complete'});feedback('success','Reconciliation recorded',UI.time(result.completed_at)+' · Finalize the official audit separately.');
  }catch(e){error(e.message);}
}
function switchView(view){state.view=view;for(const [id,key] of [['tabRecent','recent'],['tabFound','found'],['tabReview','review']])$(id).setAttribute('aria-pressed',String(view===key));document.activeElement?.blur();void refresh();}
$('serial').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();const value=$('serial').value;$('serial').value='';if(value)void capture(value);}};
$('runButton').onclick=toggleRunning;$('settingsButton').onclick=showSettings;$('settingsClose').onclick=()=>$('settings').close();$('settingsForm').onsubmit=saveSettings;
$('settings').addEventListener('close',()=>{cancelIdentification();focusScan();});$('modeChoices').onchange=()=>{if(selectedMode()!=='hid')cancelIdentification();updateModeOptions();};$('csvOnly').onchange=updateModeOptions;
$('device').onchange=showDevicePath;$('devicesRefresh').onclick=()=>loadDevices().catch(e=>{$('identifyHint').textContent=e.message;});
$('identifyButton').onclick=async()=>{try{await host({action:'identify_scanner'});state.identifying=true;$('identifyButton').disabled=true;$('identifyInput').hidden=false;$('identifyInput').focus();$('identifyHint').textContent='Waiting for one scan… do not type. This barcode will not be recorded.';}catch(e){$('identifyHint').textContent=e.message;}};
$('refreshTabs').onclick=()=>loadTabs().catch(e=>{$('auditInfo').textContent=e.message;});$('connectButton').onclick=connectAudit;
$('focusButton').onclick=focusScan;$('auditPause').onclick=async()=>{try{await send({action:'pause',value:!state.paused});await refresh();}catch(e){error(e.message);}};
$('feedbackDetails').onclick=()=>openDetails(state.feedbackSerial);$('detailClose').onclick=closeDetails;$('detailRecord').onchange=renderDetails;$('detailForm').onsubmit=saveDetails;
$('detailReload').onclick=async()=>{if(!state.drawer)return;const record=state.drawer.records[Number($('detailRecord').value)];if(record)state.drafts.delete(record.file+':'+record.row);const serial=state.drawer.serial;state.drawer=null;await openDetails(serial);};
$('tabRecent').onclick=()=>switchView('recent');$('tabFound').onclick=()=>switchView('found');$('tabReview').onclick=()=>switchView('review');$('completeButton').onclick=finish;
$('reviewClose').onclick=()=>$('reviewDialog').close();$('reviewForm').onsubmit=resolve;
document.addEventListener('keydown',event=>{if(state.identifying&&event.key==='Enter'){event.preventDefault();return;}if(event.key==='F8'){event.preventDefault();focusScan();}if(event.key==='F9'){event.preventDefault();$('auditPause').click();}if(event.key==='Escape'&&!$('detailDrawer').hidden&&!$('settings').open&&!$('reviewDialog').open)closeDetails();});
browser.runtime.onMessage.addListener(message=>{
  if(message.action!=='event')return;
  if(message.type==='error'){feedback('error','Audit paused · capture continues',message.message);tone('error');}
  else if(message.outcome==='needs_review'){feedback('warn','Review needed · '+message.serial,message.message);tone('error');}
  else if(message.outcome==='audited')tone('audited');
  void refresh();
});
(async()=>{
  try{
    const config=(await host({action:'config'})).config,options=await browser.storage.local.get(['voice','csvOnly']);state.config=config;
    $('login').value=config.username||'';$('voice').checked=options.voice===true;$('csvOnly').checked=options.csvOnly===true;
    document.querySelector('input[name="inputMode"][value="'+(config.input_mode||'station')+'"]').checked=true;
    $('comPort').value=config.port||'COM3';$('baud').value=config.baud||9600;updateModeOptions();
    await loadDevices();await loadTabs();await refresh();
    if(!config.username)showSettings();else focusScan();
  }catch(e){error(e.message);}
  setInterval(()=>void refresh(),1000);
})();
