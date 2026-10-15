import sys
from pathlib import Path
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from scanners import Framer
class ScannerTests(unittest.TestCase):
    def test_crlf_and_tab_frame_once(self):
        got=[];frame=Framer(got.append)
        for ch in 'A12345\r\nB76543\t':frame.feed(ch)
        self.assertEqual(got,['A12345','B76543'])
    def test_partial_timeout_not_combined(self):
        got=[];frame=Framer(got.append)
        with patch('scanners.time.monotonic',side_effect=[1,1.1,4,4.1]):
            for c in 'ABC\r':frame.feed(c)
        self.assertEqual(got,['C'])

class WindowsAPITests(unittest.TestCase):
    @unittest.skipUnless(sys.platform=='win32','Windows API check')
    def test_raw_input_window_registers(self):
        import queue,threading
        from scanners import raw_input,devices
        events=queue.Queue()
        def listen():
            try:raw_input(lambda:{'input_mode':'station'},lambda raw:None,events.put)
            except Exception as e:events.put(e)
        self.assertIsInstance(devices(),list)
        threading.Thread(target=listen,daemon=True).start()
        status=events.get(timeout=10)
        self.assertEqual(status,'HID listening')
