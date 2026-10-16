"""Ensure station controls/labels remain connected as the operational UI evolves."""
from html.parser import HTMLParser
from pathlib import Path
import re
import unittest
ROOT=Path(__file__).resolve().parents[1]
class Markup(HTMLParser):
    def __init__(self):super().__init__();self.ids=[];self.labels=[];self.scripts=[]
    def handle_starttag(self,tag,attrs):
        values=dict(attrs)
        if 'id' in values:self.ids.append(values['id'])
        if tag=='label' and 'for' in values:self.labels.append(values['for'])
        if tag=='script' and 'src' in values:self.scripts.append(values['src'])
class StationMarkupTests(unittest.TestCase):
    def test_controls_labels_and_script_order(self):
        parsed=Markup();parsed.feed((ROOT/'extension/station.html').read_text(encoding='utf-8'))
        self.assertEqual(len(parsed.ids),len(set(parsed.ids)))
        script=(ROOT/'extension/station.js').read_text(encoding='utf-8')
        refs=set(re.findall(r"\$\('([^']+)'\)",script))
        self.assertFalse(refs-set(parsed.ids),refs-set(parsed.ids))
        self.assertFalse(set(parsed.labels)-set(parsed.ids))
        self.assertEqual(parsed.scripts,['station-core.js','station.js'])
