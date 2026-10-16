import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from engine import Ledger
from runtime import publish,health,stop

class RuntimeTests(unittest.TestCase):
    def test_health_never_opens_legacy_heartbeat_file(self):
        with tempfile.TemporaryDirectory() as d:
            ledger=Ledger(d)
            # Even an inaccessible legacy path cannot affect the SQLite status route.
            (ledger.workspace/'companion-health.json').mkdir()
            publish(ledger,{'state':'running','input':'Listening'})
            self.assertTrue(health(ledger)['health']['running'])
            publish(ledger,{'state':'stopped','input':'Stopped'})
            self.assertFalse(health(ledger)['health']['running'])
    def test_stop_exits_actual_process_and_stays_stopped(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);shutil.copytree(Path(__file__).resolve().parents[1]/'app',root/'app',ignore=shutil.ignore_patterns('__pycache__'))
            ledger=Ledger(root);ledger.configure({'companion_enabled':True,'input_mode':'station'})
            p=subprocess.Popen([sys.executable,str(root/'app/companion.py')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                deadline=time.monotonic()+10
                while not health(ledger)['health']['running'] and time.monotonic()<deadline:time.sleep(.1)
                self.assertTrue(health(ledger)['health']['running'])
                self.assertTrue(stop(ledger)['stopped']);p.wait(timeout=10)
                self.assertEqual(p.returncode,0)
                with self.assertRaisesRegex(ValueError,'stopped'):ledger.capture('TEST123','test')
                again=subprocess.run([sys.executable,str(root/'app/companion.py')],capture_output=True,timeout=10)
                self.assertEqual(again.returncode,0);self.assertFalse(health(ledger)['health']['running'])
            finally:
                if p.poll() is None:p.terminate();p.wait(timeout=10)
