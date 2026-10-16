import csv
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from engine import Ledger
class InvestigationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.ledger=Ledger(self.tmp.name)
        self.path=self.ledger.workspace/'monthly.csv'
        with self.path.open('w',newline='') as f:
            w=csv.DictWriter(f,fieldnames=['Serial Number','Asset ID','Status','Found By','Found Date','Found Location','Found Notes','Investigation Notes','Item Number'])
            w.writeheader();w.writerow({'Serial Number':'TEST123','Asset ID':'TAG123','Status':'missing','Found Notes':'original','Item Number':'KEEP'})
    def tearDown(self):self.tmp.cleanup()
    def record(self):return self.ledger.investigation('TEST123')['records'][0]
    def save(self,record,changes,**extra):
        return self.ledger.save_investigation('TEST123',record['file'],record['row'],record['version'],changes,'test',**extra)
    def test_optional_form_preserves_identity_and_logs_changes(self):
        record=self.record();self.save(record,{'Found Location':'Shelf 2','Investigation Notes':'Checked label'})
        updated=self.record()['values'];self.assertEqual(updated['Found Location'],'Shelf 2');self.assertEqual(updated['Item Number'],'KEEP')
        with self.ledger.db_open() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM detail_edits').fetchone()[0],1)
        with self.assertRaisesRegex(ValueError,'read-only'):self.save(self.record(),{'Serial Number':'OTHER'})
    def test_repeat_scan_refreshes_seen_without_disrupting_form(self):
        self.ledger.capture('TEST123','one');self.ledger.process();record=self.record()
        self.ledger.capture('TAG123','two');self.ledger.process()
        self.save(record,{'Found Notes':'Entered while scanning'},expected=record['values'])
        after=self.record()['values'];self.assertEqual(after['Found By'],'two');self.assertEqual(after['Found Notes'],'Entered while scanning')
        self.assertEqual(self.ledger.status()['found'],1);self.assertEqual(self.ledger.status()['missing_repeats'],1)
    def test_conflicting_edits_keep_latest_value(self):
        original=self.record();self.save(original,{'Found Notes':'Saved elsewhere'})
        with self.assertRaisesRegex(ValueError,'changed'):self.save(original,{'Found Notes':'Stale draft'},expected=original['values'])
        self.assertEqual(self.record()['values']['Found Notes'],'Saved elsewhere')
    def test_bound_site_cannot_silently_change(self):
        self.ledger.dispatch({'action':'bind_site','site':{'value':'42','label':'SPA1'}})
        with self.assertRaisesRegex(ValueError,'different site'):self.ledger.dispatch({'action':'bind_site','site':{'value':'43','label':'SPA2'}})
