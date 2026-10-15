"""Actual subprocess framing and projection; no company files or browser required."""
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import unittest
class NativeTests(unittest.TestCase):
    def test_length_prefixed_stdio_and_restart(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);shutil.copytree(Path(__file__).resolve().parents[1]/'app',root/'app',ignore=shutil.ignore_patterns('__pycache__'))
            def launch():return subprocess.Popen([sys.executable,str(root/'app/native_host.py'),'--no-companion'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            def request(p,body):
                wire=json.dumps(body).encode();p.stdin.write(struct.pack('<I',len(wire))+wire);p.stdin.flush()
                header=p.stdout.read(4);self.assertEqual(len(header),4)
                return json.loads(p.stdout.read(struct.unpack('<I',header)[0]))
            p=launch()
            try:
                r=request(p,{'action':'scan','id':'stable-id','serial':'SYNTHETIC123','username':'test','requestId':'a'})
                self.assertTrue(r['ok']);self.assertEqual(r['requestId'],'a')
                self.assertEqual(request(p,{'action':'status'})['scanned'],1)
            finally:
                p.stdin.close();p.wait(timeout=10);p.stdout.close();p.stderr.close()
            p=launch()
            try:
                self.assertEqual(request(p,{'action':'status'})['scanned'],1)
                request(p,{'action':'scan','id':'stable-id','serial':'SYNTHETIC123','username':'test'})
                self.assertEqual(request(p,{'action':'status'})['scanned'],1)
                self.assertFalse(request(p,{'action':'unknown'})['ok'])
            finally:
                p.stdin.close();p.wait(timeout=10);p.stdout.close();p.stderr.close()
