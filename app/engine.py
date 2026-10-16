"""Durable local journal. SQLite is authoritative; CSV changes are replayable projections."""
from __future__ import annotations
from contextlib import contextmanager
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import threading
from datetime import datetime, timezone
from uuid import uuid4

LOCK = threading.RLock()
REQUIRED = {'Serial Number', 'Asset ID', 'Status', 'Found By', 'Found Date'}
FINAL = {'audited','already_audited','not_in_audit','needs_review','csv_only','invalid','offline','recovered'}
ALLOWED = re.compile(r'^[A-Z0-9][A-Z0-9 ._:/+\-]{1,119}$')
def norm(v): return str(v or '').strip().upper().replace('\u200b','')
def now(): return datetime.now(timezone.utc).isoformat(timespec='microseconds')
def aliases(v):
    """Only explicit scanner framing/prefixes; no truncation or fuzzy matching."""
    s=norm(v)
    if s.startswith(']C1') or s.startswith(']D2'): s=s[3:]
    s=re.sub(r'^(?:S/N|SN|SERIAL(?: NUMBER)?)[\s:#=]+','',s)
    return s, re.sub(r'[ ._:/+\-]','',s)
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()

class Ledger:
    def __init__(self, root):
        self.root=Path(root).resolve(); self.workspace=self.root/'workspace'; self.workspace.mkdir(parents=True,exist_ok=True)
        self.backups=self.workspace/'backups'; self.backups.mkdir(exist_ok=True)
        self.db=self.workspace/'session.sqlite3'; self._cache=None
        with self.db_open() as c:
            c.execute('PRAGMA journal_mode=WAL')
            c.executescript('''CREATE TABLE IF NOT EXISTS scans(
              id TEXT PRIMARY KEY,serial TEXT NOT NULL,scanned_at TEXT NOT NULL,username TEXT NOT NULL,
              investigation TEXT NOT NULL,matches INTEGER NOT NULL,audit TEXT NOT NULL DEFAULT 'queued',
              detail TEXT NOT NULL DEFAULT '',finished_at TEXT);
              CREATE TABLE IF NOT EXISTS observations(serial TEXT PRIMARY KEY,first_seen TEXT NOT NULL,
              last_seen TEXT NOT NULL,username TEXT NOT NULL,scans INTEGER NOT NULL);
              CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS resolutions(id TEXT PRIMARY KEY,note TEXT NOT NULL,at TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS completions(at TEXT PRIMARY KEY,summary TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS runtime_status(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS detail_edits(id TEXT PRIMARY KEY,at TEXT NOT NULL,username TEXT NOT NULL,file TEXT NOT NULL,serial TEXT NOT NULL,changes TEXT NOT NULL);
              CREATE INDEX IF NOT EXISTS audit_queue ON scans(audit,scanned_at);''')
            cols={r[1] for r in c.execute('PRAGMA table_info(scans)')}
            for key,decl in [('raw',"TEXT NOT NULL DEFAULT ''"),('source',"TEXT NOT NULL DEFAULT 'station'"),
                             ('csv_state',"TEXT NOT NULL DEFAULT 'done'"),('plan',"TEXT NOT NULL DEFAULT '[]'"),
                             ('csv_error',"TEXT NOT NULL DEFAULT ''"),('repeat',"INTEGER NOT NULL DEFAULT 0")]:
                if key not in cols: c.execute(f'ALTER TABLE scans ADD COLUMN {key} {decl}')
    @contextmanager
    def db_open(self):
        c=sqlite3.connect(self.db,timeout=30);c.row_factory=sqlite3.Row
        c.execute('PRAGMA synchronous=FULL')
        try:
            with c:yield c
        finally:c.close()
    def config(self):
        with self.db_open() as c:return {r['key']:json.loads(r['value']) for r in c.execute('SELECT * FROM settings')}
    def configure(self,values):
        allowed={'username','input_mode','device','port','baud','capture_enabled','companion_enabled','identify_until','identified_device'}
        if set(values)-allowed: raise ValueError('Unknown setting')
        if 'input_mode' in values and values['input_mode'] not in {'station','hid','com'}:raise ValueError('Invalid input mode')
        if 'username' in values and not 1<=len(str(values['username']).strip())<=80:raise ValueError('Enter technician login')
        if 'baud' in values and int(values['baud']) not in {9600,19200,38400,57600,115200}:raise ValueError('Unsupported baud rate')
        with self.db_open() as c:
            for k,v in values.items():c.execute('INSERT OR REPLACE INTO settings VALUES(?,?)',(k,json.dumps(v)))
        return {'ok':True,'config':self.config()}
    def files(self): return sorted(p for p in self.workspace.glob('*.csv') if p.name!='audit-export-reference.csv')
    def load(self,path):
        data=path.read_bytes(); encoding='utf-8-sig' if data.startswith(b'\xef\xbb\xbf') else 'utf-8'
        try: text=data.decode(encoding)
        except UnicodeDecodeError: encoding='cp1252';text=data.decode(encoding)
        try: dialect=csv.Sniffer().sniff(text[:16384],delimiters=',;\t')
        except csv.Error: dialect=csv.excel
        rd=csv.DictReader(io.StringIO(text,newline=''),dialect=dialect)
        fields=rd.fieldnames or []
        if not REQUIRED.issubset(fields) or len(set(fields))!=len(fields):raise ValueError(f'{path.name}: missing or duplicate required CSV headers')
        rows=list(rd)
        if any(None in r or any(v is None for v in r.values()) for r in rows):raise ValueError(f'{path.name}: malformed CSV row')
        return fields,rows,{'encoding':encoding,'dialect':dialect,'newline':'\r\n' if '\r\n' in text else '\n','hash':hashlib.sha256(data).hexdigest()}
    def store(self,path,fields,rows,fmt=None):
        fmt=fmt or self.load(path)[2]
        if digest(path)!=fmt['hash']:raise RuntimeError('CSV changed externally; will reload before retry')
        backup=self.backups/f'{path.stem}.{uuid4().hex}.csv';shutil.copy2(path,backup)
        # Windows _commit (os.fsync) requires a writable descriptor.
        with backup.open('r+b') as f:os.fsync(f.fileno())
        fd,tmp=tempfile.mkstemp(prefix='.non-inventory-',suffix='.tmp',dir=path.parent)
        try:
            with os.fdopen(fd,'w',encoding=fmt['encoding'],newline='') as f:
                w=csv.DictWriter(f,fieldnames=fields,dialect=fmt['dialect'],lineterminator=fmt['newline']);w.writeheader();w.writerows(rows);f.flush();os.fsync(f.fileno())
            if digest(path)!=fmt['hash']:raise RuntimeError('CSV changed externally; update deferred')
            os.replace(tmp,path)
        finally:
            if os.path.exists(tmp):os.remove(tmp)
        self._cache=None
    def reference(self):
        paths=self.files();ref=self.workspace/'audit-export-reference.csv'
        sig=tuple((str(p),p.stat().st_mtime_ns,p.stat().st_size) for p in paths+([ref] if ref.exists() else []))
        if self._cache and self._cache[0]==sig:return self._cache[1]
        exact={}; loose={}; items=set()
        for path in paths:
            _,rows,_=self.load(path)
            for row in rows:
                serial=norm(row.get('Serial Number'));asset=norm(row.get('Asset ID'));canonical=serial or asset
                if not canonical:continue
                for value in {serial,asset}-{''}:
                    a,b=aliases(value)
                    exact.setdefault(a,set()).add(canonical);loose.setdefault(b,set()).add(canonical)
        if ref.exists():
            with ref.open(encoding='utf-8-sig',newline='') as f:
                for r in csv.DictReader(f):
                    items.add(norm(r.get('Item Number(LOV)',r.get('Item Number',''))))
                    serial=norm(r.get('Serial Number'));asset=norm(r.get('Asset ID'))
                    if serial:
                        for value in {serial,asset}-{''}:
                            a,b=aliases(value);exact.setdefault(a,set()).add(serial);loose.setdefault(b,set()).add(serial)
        result=(exact,loose,items);self._cache=(sig,result);return result
    def capture(self,serial,username,source='station',receipt_id=None):
        """Commit raw receipt before indexing or touching a CSV. Safe to acknowledge after return."""
        raw=str(serial or '');username=str(username or '').strip()
        if not username or len(username)>80:raise ValueError('Enter your technician login before scanning.')
        if not raw or len(raw)>512:raise ValueError('Barcode must contain 1–512 characters')
        scanid=receipt_id or uuid4().hex
        if self.config().get('companion_enabled') is False:raise ValueError('Capture is stopped. Select Start scanning to resume.')
        with self.db_open() as c:
            c.execute('INSERT OR IGNORE INTO scans(id,serial,raw,source,scanned_at,username,investigation,matches,audit,csv_state) VALUES(?,?,?,?,?,?,?,?,?,?)',
                      (scanid,norm(raw),raw,source,now(),username,'pending',0,'queued','pending'))
        return {'ok':True,'id':scanid,'serial':norm(raw),'investigation':'pending','matches':[],'repeat':False}
    def process(self,limit=100):
        """Single SQLite write lease across processes. Replay row patches after a crash."""
        count=0
        for _ in range(limit):
            with LOCK,self.db_open() as c:
                c.execute('BEGIN IMMEDIATE')
                scan=c.execute("SELECT * FROM scans WHERE csv_state!='done' ORDER BY scanned_at,rowid LIMIT 1").fetchone()
                if scan is None:break
                try:self._apply(c,scan);count+=1
                except Exception as e:
                    c.execute('UPDATE scans SET csv_error=? WHERE id=?',(str(e)[:500],scan['id']))
                    break
        return count
    def _apply(self,c,scan):
        a,b=aliases(scan['raw'] or scan['serial']);exact,loose,items=self.reference()
        candidates=exact.get(a,set()) or loose.get(b,set())
        ambiguous=len(candidates)>1
        serial=next(iter(candidates)) if len(candidates)==1 else a
        invalid=not ALLOWED.fullmatch(a) or (a in items and not candidates)
        if ambiguous or invalid:
            c.execute("UPDATE scans SET csv_state='done',investigation=?,audit=?,detail=? WHERE id=?",
                      ('ambiguous' if ambiguous else 'rejected','needs_review' if ambiguous else 'invalid',
                       'Ambiguous identifier; no files or website changed' if ambiguous else 'Unsupported or product barcode',scan['id']));return
        plan=[];matches=[]
        # Construct a deterministic patch from the durable receipt, never increment CSV counters.
        for path in self.files():
            fields,rows,fmt=self.load(path);changed=False
            for row in rows:
                if serial not in {norm(row.get('Serial Number')),norm(row.get('Asset ID'))}:continue
                matches.append({'file':path.name,'item':row.get('Item Number','')})
                patch={'Status':'found','Found By':scan['username'],'Found Date':scan['scanned_at']}
                if any(row[k]!=v for k,v in patch.items()):row.update(patch);changed=True
            if changed:plan.append((path,fields,rows,fmt))
        for path,fields,rows,fmt in plan:self.store(path,fields,rows,fmt)
        previous=c.execute('SELECT * FROM observations WHERE serial=?',(serial,)).fetchone()
        if matches:
            c.execute('''INSERT INTO observations VALUES(?,?,?,?,1) ON CONFLICT(serial) DO UPDATE SET
                last_seen=excluded.last_seen,username=excluded.username,scans=observations.scans+1''',
                (serial,previous['first_seen'] if previous else scan['scanned_at'],scan['scanned_at'],scan['username']))
        c.execute("UPDATE scans SET serial=?,csv_state='done',csv_error='',investigation=?,matches=?,repeat=? WHERE id=?",
                  (serial,'found' if matches else 'not_listed',len(matches),bool(previous),scan['id']))
    def pending(self):
        with self.db_open() as c:return {'ok':True,'pending':[dict(r) for r in c.execute("SELECT * FROM scans WHERE csv_state='done' AND audit IN ('queued','sending') ORDER BY scanned_at,rowid LIMIT 500")]}
    def result(self,scanid,outcome,detail=''):
        if outcome not in FINAL|{'sending'}:raise ValueError('Unknown audit result')
        with self.db_open() as c:
            c.execute('BEGIN IMMEDIATE');old=c.execute('SELECT * FROM scans WHERE id=?',(scanid,)).fetchone()
            if old is None:raise ValueError('Unknown scan receipt')
            if old['csv_state']!='done':raise ValueError('CSV processing not complete')
            if old['audit'] in FINAL and outcome!=old['audit']:raise ValueError('Finalized receipt cannot be overwritten')
            c.execute('UPDATE scans SET audit=?,detail=?,finished_at=? WHERE id=?',(outcome,str(detail)[:1000],now() if outcome in FINAL else None,scanid))
        return {'ok':True}
    def status(self):
        with self.db_open() as c:
            grouped={r['audit']:r['n'] for r in c.execute('SELECT audit,COUNT(*) n FROM scans GROUP BY audit')}
            return {'ok':True,'files':[p.name for p in self.files()],'scanned':sum(grouped.values()),'audit':grouped,
                    'csv_pending':c.execute("SELECT COUNT(*) FROM scans WHERE csv_state!='done'").fetchone()[0],
                    'found':c.execute('SELECT COUNT(*) FROM observations').fetchone()[0],
                    'missing_repeats':c.execute("SELECT COUNT(*) FROM scans WHERE investigation='found' AND repeat=1").fetchone()[0],
                    'details_saved':c.execute('SELECT COUNT(*) FROM detail_edits').fetchone()[0],
                    'audited_unique':c.execute("SELECT COUNT(DISTINCT serial) FROM scans WHERE audit IN ('audited','already_audited')").fetchone()[0],
                    'review_count':c.execute("SELECT COUNT(*) FROM scans s LEFT JOIN resolutions r ON s.id=r.id WHERE r.id IS NULL AND (s.audit IN ('needs_review','not_in_audit','offline') OR s.csv_error!='')").fetchone()[0],
                    'recent':[dict(r) for r in c.execute('SELECT * FROM scans ORDER BY scanned_at DESC,rowid DESC LIMIT 35')]}
    def found(self):
        with self.db_open() as c:results={r['serial']:dict(r) for r in c.execute('SELECT * FROM observations ORDER BY last_seen DESC')}
        for path in self.files():
            _,rows,_=self.load(path)
            for row in rows:
                for key in ('Serial Number','Asset ID'):
                    item=results.get(norm(row.get(key)))
                    if item is not None and 'location' not in item:
                        item['location']=row.get('Found Location','');item['notes']=row.get('Found Notes','')
        return {'ok':True,'found':list(results.values())}
    def details(self,serial,location,notes):
        if len(str(location))>200 or len(str(notes))>4000:raise ValueError('Details too long')
        updated=0
        with LOCK,self.db_open() as c:
            c.execute('BEGIN IMMEDIATE')
            for path in self.files():
                fields,rows,fmt=self.load(path);changed=False
                for row in rows:
                    if norm(serial) in {norm(row.get('Serial Number')),norm(row.get('Asset ID'))}:
                        if not {'Found Location','Found Notes'}.issubset(fields):raise ValueError('CSV has no location/notes columns')
                        row['Found Location']=str(location);row['Found Notes']=str(notes);changed=True;updated+=1
                if changed:self.store(path,fields,rows,fmt)
        return {'ok':True,'updated':updated}
    @staticmethod
    def editable(fields):
        protected={'Serial Number','Asset ID','Status','Found By','Found Date'}
        return [f for f in fields if f not in protected and (f.lower().startswith(('found ','investigation ')) or f.lower() in {'notes','location','owner','assigned to'})]
    def investigation(self,serial):
        serial=norm(serial);records=[]
        for path in self.files():
            fields,rows,fmt=self.load(path)
            for index,row in enumerate(rows):
                if serial in {norm(row.get('Serial Number')),norm(row.get('Asset ID'))}:
                    records.append({'file':path.name,'row':index,'version':fmt['hash'],'values':row,'fields':fields,'editable':self.editable(fields)})
        return {'ok':True,'serial':serial,'records':records}
    def save_investigation(self,serial,file,index,version,changes,username,expected=None):
        serial=norm(serial)
        if not isinstance(changes,dict) or not changes:raise ValueError('No changes to save')
        if not str(username or '').strip():raise ValueError('Save your technician login first')
        path=next((p for p in self.files() if p.name==file),None)
        if path is None:raise ValueError('Investigation file unavailable')
        with LOCK,self.db_open() as c:
            c.execute('BEGIN IMMEDIATE')
            fields,rows,fmt=self.load(path)
            if fmt['hash']!=version and not isinstance(expected,dict):raise ValueError('File changed since this form opened. Reload the form; your draft has not been applied.')
            if not isinstance(index,int) or index<0 or index>=len(rows):raise ValueError('Row unavailable')
            row=rows[index]
            if serial not in {norm(row.get('Serial Number')),norm(row.get('Asset ID'))}:raise ValueError('Item identity changed; reload the form')
            if set(changes)-set(self.editable(fields)):raise ValueError('These fields are read-only')
            if any(not isinstance(v,str) or len(v)>4000 for v in changes.values()):raise ValueError('Field values must be text up to 4000 characters')
            if isinstance(expected,dict) and any(k not in expected or row[k]!=expected[k] for k in changes):raise ValueError('An edited field changed since this form opened. Reload the record before saving.')
            delta={k:{'before':row[k],'after':v} for k,v in changes.items() if row[k]!=v}
            if delta:
                row.update(changes);self.store(path,fields,rows,fmt)
                c.execute('INSERT INTO detail_edits VALUES(?,?,?,?,?,?)',(uuid4().hex,now(),str(username),path.name,serial,json.dumps(delta)))
        return {'ok':True,'updated':len(delta)}
    def exceptions(self):
        with self.db_open() as c:return {'ok':True,'exceptions':[dict(r) for r in c.execute("SELECT s.*,r.note resolution FROM scans s LEFT JOIN resolutions r ON r.id=s.id WHERE (s.audit IN ('needs_review','sending','offline','queued','not_in_audit') OR s.csv_state!='done') AND r.id IS NULL ORDER BY s.scanned_at LIMIT 200")]}
    def resolve(self,scanid,note):
        if len(str(note).strip())<5:raise ValueError('Record what you verified on the website (at least 5 characters)')
        with self.db_open() as c:
            s=c.execute('SELECT * FROM scans WHERE id=?',(scanid,)).fetchone()
            if not s or s['audit'] not in {'needs_review','not_in_audit','offline'} or s['csv_state']!='done':raise ValueError('Only completed exceptions can be resolved')
            c.execute('INSERT OR REPLACE INTO resolutions VALUES(?,?,?)',(scanid,str(note)[:1000],now()))
        return {'ok':True}
    def complete(self):
        if self.config().get('capture_enabled',False):raise ValueError('Disable device capture before completion')
        if self.exceptions()['exceptions']:raise ValueError('Reconcile pending scans and exceptions first')
        with self.db_open() as c:
            # Check every receipt, not only the UI page limit.
            n=c.execute("SELECT COUNT(*) FROM scans s LEFT JOIN resolutions r ON s.id=r.id WHERE s.csv_state!='done' OR s.audit IN ('queued','sending') OR (s.audit IN ('needs_review','offline','not_in_audit') AND r.id IS NULL)").fetchone()[0]
            if n:raise ValueError('Unresolved scans remain')
            if not c.execute('SELECT COUNT(*) FROM scans').fetchone()[0]:raise ValueError('No scans to complete')
            stamp=now();c.execute('INSERT INTO completions VALUES(?,?)',(stamp,json.dumps(self.status())))
        return {'ok':True,'completed_at':stamp}
    def dispatch(self,r):
        a=r.get('action')
        if a=='scan':return self.capture(r.get('serial'),r.get('username'),r.get('source','station'),r.get('id'))
        if a=='bind_site':
            site=r.get('site',{})
            if not isinstance(site,dict) or not site.get('value') or not site.get('label'):raise ValueError('Site identity missing')
            existing=self.config().get('audit_site')
            if existing and existing['value']!=site['value']:raise ValueError('This journal belongs to '+existing['label']+'. Use a separate installation for a different site.')
            with self.db_open() as c:c.execute('INSERT OR REPLACE INTO settings VALUES(?,?)',('audit_site',json.dumps(site)))
            return {'ok':True}
        if a=='status':return self.status()
        if a=='investigation':return self.investigation(r.get('serial'))
        if a=='save_investigation':return self.save_investigation(r.get('serial'),r.get('file'),r.get('row'),r.get('version'),r.get('changes'),r.get('username'),r.get('expected'))
        if a=='audit_receipts':
            with self.db_open() as c:return {'ok':True,'receipts':[dict(x) for x in c.execute("SELECT DISTINCT serial FROM scans WHERE audit IN ('audited','already_audited')")]}
        if a=='verify_failed':
            with self.db_open() as c:c.execute("UPDATE scans SET audit='needs_review',detail=? WHERE serial=? AND audit IN ('audited','already_audited')",(str(r.get('message','Reconciliation failed'))[:500],r.get('serial')))
            return {'ok':True}
        if a=='pending':return self.pending()
        if a=='audit_result':return self.result(r.get('id'),r.get('outcome'),r.get('message',''))
        if a=='found_list':return self.found()
        if a=='update_details':return self.details(r.get('serial'),r.get('location',''),r.get('notes',''))
        if a=='exceptions':return self.exceptions()
        if a=='resolve':return self.resolve(r.get('id'),r.get('note'))
        if a=='complete':return self.complete()
        if a=='config':return {'ok':True,'config':self.config()}
        if a=='configure':return self.configure(r.get('values',{}))
        raise ValueError('Unknown local command')
