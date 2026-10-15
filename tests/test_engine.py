import csv
import tempfile
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from engine import Ledger
FIELDS=['Serial Number','Asset ID','Status','Found By','Found Date','Found Location','Found Notes','Investigation Notes','Extra']
class EngineTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        d=self.root/'workspace';d.mkdir()
        self.path=d/'investigation-items Sept SPA1.csv'
        with self.path.open('w',newline='') as f:
            w=csv.DictWriter(f,fieldnames=FIELDS);w.writeheader()
            w.writerow({'Serial Number':'A12345','Asset ID':'TAG100','Status':'missing','Investigation Notes':'keep','Extra':'DO NOT TOUCH'})
            w.writerow({'Serial Number':'87654321','Asset ID':'87654321','Status':'missing'})
        with (d/'audit-export-reference.csv').open('w',newline='') as f:
            f.write('Item Number(LOV),Item Description\n100029804,computer\n')
        self.ledger=Ledger(self.root)
    def tearDown(self):self.tmp.cleanup()
    def rows(self):
        with self.path.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
    def test_found_writes_original_columns_and_backup(self):
        r=self.ledger.capture('tag100','technician');self.assertEqual(r['investigation'],'found')
        x=self.rows()[0];self.assertEqual(x['Found By'],'technician');self.assertEqual(x['Status'],'found')
        self.assertEqual(x['Extra'],'DO NOT TOUCH');self.assertEqual(x['Investigation Notes'],'keep')
        self.assertTrue(x['Found Date']);self.assertEqual(len(list((self.root/'workspace/backups').glob('*.csv'))),1)
    def test_repeat_updates_with_original_first_seen(self):
        first=self.ledger.capture('A12345','one');r=self.ledger.capture('A12345','two')
        self.assertTrue(r['repeat']);self.assertEqual(self.rows()[0]['Found By'],'two')
        self.assertEqual(self.ledger.found()['found'][0]['scans'],2)
    def test_numeric_serial_is_valid(self):
        self.assertEqual(self.ledger.capture('87654321','u')['investigation'],'found')
    def test_item_number_rejected(self):
        with self.assertRaisesRegex(ValueError,'product item number'):self.ledger.capture('100029804','u')
        self.assertEqual(self.ledger.status()['scanned'],0)
    def test_persistence_and_sending_not_auto_retry(self):
        a=self.ledger.capture('A12345','u');pending=Ledger(self.root).pending()['pending']
        self.assertEqual(pending[0]['audit'],'queued')
        self.ledger.result(a['id'],'sending')
        self.assertEqual(Ledger(self.root).pending()['pending'][0]['audit'],'sending')
        self.ledger.result(a['id'],'needs_review','unconfirmed')
        self.assertEqual(Ledger(self.root).pending()['pending'],[])
        with self.assertRaisesRegex(ValueError,'Finalized'):self.ledger.result(a['id'],'audited')
    def test_edit_details_and_unknown(self):
        self.ledger.capture('A12345','u')
        self.assertEqual(self.ledger.details('A12345','Cage 1','Found on shelf')['updated'],1)
        self.assertEqual(self.rows()[0]['Found Location'],'Cage 1')
        self.assertEqual(self.ledger.capture('OTHER678','u')['investigation'],'not_listed')
        self.assertEqual(self.ledger.status()['found'],1)
if __name__=='__main__':unittest.main()
