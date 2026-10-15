"""Read-only CSV validation; run before enabling capture."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from engine import Ledger
ledger=Ledger(Path(__file__).resolve().parents[1])
for p in ledger.files():
    fields,rows,_=ledger.load(p)
    print(f'OK: {p.name} ({len(rows)} rows, {len(fields)} columns)')
ledger.reference()
print('PASS: CSV preflight. No files means investigation matches are unavailable.')
