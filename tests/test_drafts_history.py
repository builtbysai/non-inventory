import csv
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from engine import Ledger
class DraftHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.ledger=Ledger(self.tmp.name)
        self.path=self.ledger.workspace/'month.csv'
        with self.path.open('w',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=['Serial Number','Asset ID','Status','Found By','Found Date','Found Notes'])
            writer.writeheader();writer.writerow({'Serial Number':'TEST123','Asset ID':'ASSET123','Status':'missing','Found Notes':'Original'})
    def tearDown(self):self.tmp.cleanup()
    def record(self):return self.ledger.investigation('TEST123')['records'][0]
    def test_draft_recovers_after_restart_without_editing_csv(self):
        r=self.record();before=self.path.read_bytes()
        self.ledger.draft_save('TEST123',r['file'],r['row'],{'version':r['version'],'original':r['values'],'values':{'Found Notes':'Unsaved text'}})
        recovered=Ledger(self.tmp.name).drafts('TEST123')['drafts'][0]
        self.assertEqual(recovered['payload']['values']['Found Notes'],'Unsaved text')
        self.assertEqual(self.path.read_bytes(),before)
        self.assertNotIn('payload',self.ledger.drafts()['drafts'][0])
        self.ledger.draft_delete(recovered['key']);self.assertEqual(self.ledger.drafts()['drafts'],[])
    def test_draft_does_not_accept_read_only_identity(self):
        r=self.record()
        with self.assertRaises(ValueError):self.ledger.draft_save('TEST123',r['file'],r['row'],{'values':{'Serial Number':'OTHER'}})
    def test_acknowledgement_loss_retry_does_not_overwrite_or_duplicate_edit(self):
        r=self.record();args=('TEST123',r['file'],r['row'],r['version'],{'Found Notes':'New'},'test',r['values'])
        self.assertEqual(self.ledger.save_investigation(*args)['updated'],1)
        self.assertEqual(self.ledger.save_investigation(*args)['updated'],0)
        with self.ledger.db_open() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM detail_edits').fetchone()[0],1)
    def test_history_search_pages_and_asset_alias(self):
        for index in range(65):self.ledger.capture('CODE'+str(index),'test')
        self.ledger.capture('ASSET123','test');self.ledger.process(100)
        first=self.ledger.history(limit=50);second=self.ledger.history(offset=50,limit=50)
        self.assertEqual(first['total'],66);self.assertEqual(len(first['items']),50);self.assertEqual(len(second['items']),16)
        self.assertFalse({r['id'] for r in first['items']}&{r['id'] for r in second['items']})
        self.assertEqual(self.ledger.history(view='found',query='ASSET123')['items'][0]['serial'],'TEST123')
        self.assertEqual(self.ledger.history(query='%')['total'],0)
    def test_review_search_excludes_resolved_receipts(self):
        scan=self.ledger.capture('TEST123','test');self.ledger.process();self.ledger.result(scan['id'],'needs_review')
        self.assertEqual(self.ledger.history(view='review',query='TEST123')['total'],1)
        self.ledger.resolve(scan['id'],'Checked official page')
        self.assertEqual(self.ledger.history(view='review',query='TEST123')['total'],0)
