import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from companion import publish_health
class HealthTests(unittest.TestCase):
    def test_windows_sharing_conflict_does_not_stop_companion(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            with patch('companion.os.replace',side_effect=PermissionError('Sharing violation')):
                self.assertFalse(publish_health(root,{'input':'listening'}))
            self.assertTrue(publish_health(root,{'input':'listening'}))
            self.assertIn('listening',(root/'companion-health.json').read_text())
