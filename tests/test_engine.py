import csv
import io
import os
import sqlite3
import tempfile
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from engine import Ledger
FIELDS=['Serial Number','Asset ID','Status','Found By','Found Date','Found Location','Found Notes','Investigation Notes','Extra']
class EngineTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.ws=self.root/'workspace';self.ws.mkdir()
        self.path=self.ws/'September.csv';self.write(self.path,[{'Serial Number':'A-12345','Asset ID':'TAG100','Status':'missing','Extra':'untouched'},{'Serial Number':'87654321','Asset ID':'87654321'}])
        self.ledger=Ledger(self.root)
    def tearDown(self):self.tmp.cleanup()
    def write(self,p,rows):
        with p.open('w',encoding='utf-8',newline='') as f:
            w=csv.DictWriter(f,fieldnames=FIELDS,lineterminator='\n');w.writeheader();w.writerows(rows)
    def rows(self,p=None):
        with (p or self.path).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
    def capture(self,code,user='tech'):
        r=self.ledger.capture(code,user);self.ledger.process();return r
    def test_journal_before_csv_and_recovery(self):
        r=self.ledger.capture('tag100','tech')
        self.assertEqual(self.rows()[0]['Status'],'missing')
        self.assertEqual(self.ledger.pending()['pending'],[])
        with patch.object(self.ledger,'store',side_effect=PermissionError('Excel lock')):self.ledger.process()
        self.assertEqual(self.ledger.status()['csv_pending'],1)
        Ledger(self.root).process()
        self.assertEqual(self.rows()[0]['Status'],'found');self.assertEqual(self.rows()[0]['Extra'],'untouched')
        self.assertEqual(self.ledger.pending()['pending'][0]['id'],r['id'])
    def test_repeat_alias_and_receipt_idempotency(self):
        a=self.capture('S/N: A12345');self.capture('TAG100','second')
        self.ledger.capture('S/N: A12345','tech',receipt_id=a['id']);self.ledger.process()
        self.assertEqual(self.ledger.status()['scanned'],2)
        self.assertEqual(self.ledger.found()['found'][0]['scans'],2)
        self.assertEqual(self.rows()[0]['Found By'],'second')
    def test_ambiguous_never_changes_files(self):
        self.write(self.ws/'July.csv',[{'Serial Number':'A12345','Asset ID':'TAG200'}])
        before=self.path.read_bytes();self.capture('A 12345')
        self.assertEqual(self.path.read_bytes(),before)
        self.assertEqual(self.ledger.exceptions()['exceptions'][0]['investigation'],'ambiguous')
    def test_all_months_and_partial_failure_replay(self):
        second=self.ws/'August.csv';self.write(second,[{'Serial Number':'A-12345','Asset ID':'TAG100'}])
        real=self.ledger.store;n=[0]
        def fail_once(*args):
            n[0]+=1
            if n[0]==2:raise OSError('Simulated crash after first CSV replace')
            return real(*args)
        self.ledger.capture('TAG100','u')
        with patch.object(self.ledger,'store',side_effect=fail_once):self.ledger.process()
        self.assertEqual(self.ledger.status()['csv_pending'],1)
        self.ledger=Ledger(self.root);self.ledger.process()
        self.assertEqual(self.rows()[0]['Found Date'],self.rows(second)[0]['Found Date'])
        self.assertEqual(self.ledger.found()['found'][0]['scans'],1)
    def test_numeric_and_product_rejection_are_journaled(self):
        (self.ws/'audit-export-reference.csv').write_text('Item Number(LOV)\n100029804\n')
        self.capture('100029804');self.capture('87654321')
        self.assertEqual(self.ledger.status()['scanned'],2)
        self.assertEqual(self.ledger.status()['audit']['invalid'],1)
        self.assertEqual(self.rows()[1]['Status'],'found')
    def test_completion_requires_reconciliation_and_notes(self):
        r=self.capture('A-12345');self.ledger.result(r['id'],'sending')
        self.assertEqual(Ledger(self.root).pending()['pending'][0]['audit'],'sending')
        with self.assertRaises(ValueError):self.ledger.complete()
        self.ledger.result(r['id'],'needs_review','timeout')
        with self.assertRaises(ValueError):self.ledger.result(r['id'],'audited')
        self.ledger.resolve(r['id'],'Verified staged manually in official grid')
        self.assertTrue(self.ledger.complete()['completed_at'])
    def test_encoding_delimiter_order_and_backup(self):
        text=';'.join(FIELDS)+'\r\n'+';'.join(['A-12345','TAG100','missing','','','','','café','preserve'])+'\r\n'
        self.path.write_bytes(text.encode('cp1252'));self.capture('A-12345')
        data=self.path.read_bytes();self.assertIn(b'caf\xe9',data);self.assertTrue(data.startswith(';'.join(FIELDS).encode()))
        self.assertEqual(next((self.ws/'backups').glob('*.csv')).read_bytes(),text.encode('cp1252'))
    def test_external_edit_detected(self):
        fields,rows,fmt=self.ledger.load(self.path);self.path.write_text(self.path.read_text()+'\n')
        with self.assertRaises(RuntimeError):self.ledger.store(self.path,fields,rows,fmt)
    def test_backup_flush_uses_windows_compatible_descriptor(self):
        real_fsync=os.fsync
        def writable_fsync(fd):
            os.write(fd,b'')  # Read-only descriptors fail here, as with Windows _commit.
            real_fsync(fd)
        with patch('engine.os.fsync',side_effect=writable_fsync):self.capture('TAG100')
        self.assertEqual(self.ledger.status()['csv_pending'],0)
        self.assertEqual(self.rows()[0]['Status'],'found')
    def test_many_scans_do_not_drop(self):
        for _ in range(120):self.ledger.capture('TAG100','u')
        self.ledger.process(200)
        self.assertEqual(self.ledger.status()['scanned'],120);self.assertEqual(self.ledger.status()['csv_pending'],0)
        self.assertEqual(len(self.ledger.pending()['pending']),120)
if __name__=='__main__':unittest.main()
