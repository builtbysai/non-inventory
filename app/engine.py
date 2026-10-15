"""Local-only, serial-first inventory investigation and durable audit queue.

No network stack, no dependencies, no credentials, no employer data is uploaded.
"""
from __future__ import annotations
import csv
from datetime import datetime
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import threading
from uuid import uuid4

LOCK = threading.RLock()
REQUIRED = {'Serial Number','Asset ID','Status','Found By','Found Date','Found Location','Found Notes','Investigation Notes'}
FINAL = {'audited','already_audited','not_in_audit','needs_review','csv_only','invalid','offline'}
ALLOWED = re.compile(r'^[A-Z0-9][A-Z0-9._/-]{1,29}$')

def norm(v): return str(v or '').strip().upper().replace('\u200b','')
def now(): return datetime.now().astimezone().isoformat(timespec='seconds')

class Ledger:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.workspace = self.root/'workspace'
        self.workspace.mkdir(parents=True,exist_ok=True)
        self.backups = self.workspace/'backups'
        self.backups.mkdir(exist_ok=True)
        self.db = self.workspace/'session.sqlite3'
        with self.db_open() as c:
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('''CREATE TABLE IF NOT EXISTS scans(
              id TEXT PRIMARY KEY, serial TEXT NOT NULL, scanned_at TEXT NOT NULL,
              username TEXT NOT NULL, investigation TEXT NOT NULL, matches INTEGER NOT NULL,
              audit TEXT NOT NULL DEFAULT 'queued', detail TEXT NOT NULL DEFAULT '',
              finished_at TEXT)''')
            c.execute('''CREATE TABLE IF NOT EXISTS observations(
              serial TEXT PRIMARY KEY, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
              username TEXT NOT NULL, scans INTEGER NOT NULL)''')
    def db_open(self):
        c=sqlite3.connect(self.db,timeout=15)
        c.row_factory=sqlite3.Row
        return c
    def files(self): return sorted(self.workspace.glob('investigation-items *.csv'))
    def load(self, path):
        with path.open('r', encoding='utf-8-sig', newline='') as f:
            reader=csv.DictReader(f)
            fields=reader.fieldnames or []
            if not REQUIRED.issubset(fields):
                raise ValueError(f'{path.name}: missing required CSV headers')
            return fields,list(reader)
    def store(self,path,fields,rows):
        # Preserve the exact column layout, other columns, and a recoverable backup.
        backup=self.backups/f'{path.stem}.{datetime.now():%Y%m%d-%H%M%S-%f}.{uuid4().hex[:5]}.csv'
        shutil.copy2(path,backup)
        fd,tmp=tempfile.mkstemp(prefix='.non-inventory-',suffix='.csv',dir=path.parent)
        try:
            with os.fdopen(fd,'w',encoding='utf-8-sig',newline='') as f:
                w=csv.DictWriter(f,fieldnames=fields,extrasaction='raise',lineterminator='\r\n')
                w.writeheader();w.writerows(rows);f.flush();os.fsync(f.fileno())
            os.replace(tmp,path)
        finally:
            if os.path.exists(tmp):os.remove(tmp)
    def known_item_numbers(self):
        path=self.workspace/'audit-export-reference.csv'
        if not path.exists():return set()
        with path.open('r',encoding='utf-8-sig',newline='') as f:
            return {norm(row.get('Item Number(LOV)')) for row in csv.DictReader(f)}
    def capture(self,serial,username):
        serial=norm(serial)
        username=str(username or '').strip()
        if not 1<=len(username)<=80: raise ValueError('Enter your technician login before scanning.')
        if not ALLOWED.fullmatch(serial): raise ValueError('Unsupported barcode: expected a serial of 2–30 characters.')
        with LOCK, self.db_open() as c:
            # Stage input locally before any official-site interaction. A crash cannot
            # cause blind re-submission of a previously sent serial.
            targets=[]; matches=0; rows_found=[]; now_time=now()
            for path in self.files():
                fields,rows=self.load(path)
                changed=False
                for row in rows:
                    if serial not in (norm(row.get('Serial Number')),norm(row.get('Asset ID'))):continue
                    changed=True;matches+=1;rows_found.append({'file':path.name,'item':row.get('Item Number','')})
                    row['Status']='found';row['Found By']=username;row['Found Date']=now_time
                if changed:targets.append((path,fields,rows))
            # Real serialized device identifiers occasionally look numeric like SKUs.
            # Only reject a known product item number if it's not an exact investigation match.
            if matches==0 and serial in self.known_item_numbers():
                raise ValueError('This is a product item number, not a serial. Ignored.')
            for path,fields,rows in targets:self.store(path,fields,rows)
            scanid=uuid4().hex;timestamp=now_time
            previous=c.execute('SELECT * FROM observations WHERE serial=?',(serial,)).fetchone()
            if matches:
                first=(previous['first_seen'] if previous else timestamp)
                c.execute('''INSERT INTO observations(serial,first_seen,last_seen,username,scans)
                  VALUES(?,?,?,?,1) ON CONFLICT(serial) DO UPDATE SET
                  last_seen=excluded.last_seen, username=excluded.username, scans=observations.scans+1''',
                  (serial,first,timestamp,username))
            c.execute('INSERT INTO scans(id,serial,scanned_at,username,investigation,matches,audit) VALUES(?,?,?,?,?,?,?)',
                      (scanid,serial,timestamp,username,'found' if matches else 'not_listed',matches,'queued'))
            return {'ok':True,'id':scanid,'serial':serial,'investigation':'found' if matches else 'not_listed',
                    'matches':rows_found,'repeat':bool(previous),'time':timestamp}
    def pending(self):
        with LOCK,self.db_open() as c:
            # "sending" is NOT retried after an interrupted browser call. It needs
            # read-only reconciliation against the official grid first.
            return {'ok':True,'pending':[dict(r) for r in c.execute('''SELECT * FROM scans
                WHERE audit IN ('queued','sending') ORDER BY scanned_at,rowid LIMIT 1000''')]}
    def result(self,scanid,outcome,detail=''):
        if outcome not in FINAL|{'sending','queued'}:raise ValueError('Unknown audit result')
        with LOCK,self.db_open() as c:
            old=c.execute('SELECT audit FROM scans WHERE id=?',(scanid,)).fetchone()
            if old is None:raise ValueError('Unknown scan receipt')
            if old['audit'] in FINAL and outcome!=old['audit']:
                raise ValueError('Finalized receipt cannot be overwritten')
            c.execute('UPDATE scans SET audit=?,detail=?,finished_at=? WHERE id=?',
                      (outcome,str(detail)[:450],now() if outcome in FINAL else None,scanid))
        return {'ok':True}
    def status(self):
        with LOCK,self.db_open() as c:
            grouped={r['audit']:r['n'] for r in c.execute('SELECT audit,COUNT(*) n FROM scans GROUP BY audit')}
            files=self.files()
            return {'ok':True,'files':[p.name for p in files],
                'scanned':sum(grouped.values()),'audit':grouped,
                'found':c.execute('SELECT COUNT(*) FROM observations').fetchone()[0],
                'recent':[dict(r) for r in c.execute('SELECT * FROM scans ORDER BY scanned_at DESC,rowid DESC LIMIT 35')]}
    def found(self):
        with LOCK,self.db_open() as c:
            results={r['serial']:dict(r) for r in c.execute('SELECT * FROM observations ORDER BY last_seen DESC')}
            for path in self.files():
                _,rows=self.load(path)
                for row in rows:
                    for key in ('Serial Number','Asset ID'):
                        serial=norm(row.get(key))
                        if serial in results and 'location' not in results[serial]:
                            results[serial]['location']=row.get('Found Location','')
                            results[serial]['notes']=row.get('Found Notes','')
            return {'ok':True,'found':list(results.values())}
    def details(self,serial,location,notes):
        serial=norm(serial)
        if not ALLOWED.fullmatch(serial):raise ValueError('Invalid serial')
        if len(str(location))>200 or len(str(notes))>4000:raise ValueError('Details too long')
        updated=0
        with LOCK:
            for path in self.files():
                fields,rows=self.load(path);changed=False
                for row in rows:
                    if serial in (norm(row.get('Serial Number')),norm(row.get('Asset ID'))):
                        row['Found Location']=str(location);row['Found Notes']=str(notes)
                        updated+=1;changed=True
                if changed:self.store(path,fields,rows)
        return {'ok':True,'updated':updated}
    def exceptions(self):
        with LOCK,self.db_open() as c:
            return {'ok':True,'exceptions':[dict(r) for r in c.execute("SELECT * FROM scans WHERE audit IN ('needs_review','sending','offline','queued') ORDER BY scanned_at DESC,rowid DESC LIMIT 2000")]}
    def dispatch(self,request):
        action=request.get('action')
        if action=='status':return self.status()
        if action=='scan':return self.capture(request.get('serial'),request.get('username'))
        if action=='pending':return self.pending()
        if action=='audit_result':return self.result(request.get('id'),request.get('outcome'),request.get('message',''))
        if action=='found_list':return self.found()
        if action=='update_details':return self.details(request.get('serial'),request.get('location',''),request.get('notes',''))
        if action=='exceptions':return self.exceptions()
        return {'ok':False,'error':'Unknown local command'}
