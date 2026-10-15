"""Read-only installation smoke test."""
from pathlib import Path
import csv,sys
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'app'))
from engine import REQUIRED
files=list((ROOT/'workspace').glob('investigation-items *.csv'))
for path in files:
    with path.open(encoding='utf-8-sig',newline='') as f:
        rd=csv.DictReader(f)
        if not REQUIRED.issubset(rd.fieldnames or []):
            raise SystemExit(f'INVALID investigation CSV headers: {path.name}')
        n=sum(1 for _ in rd)
    print(f'OK: {path.name} ({n} rows, original columns retained)')
ref=ROOT/'workspace'/'audit-export-reference.csv'
if ref.exists():
    with ref.open(encoding='utf-8-sig',newline='') as f:
        rd=csv.DictReader(f)
        if 'Item Number(LOV)' not in (rd.fieldnames or []):raise SystemExit('Invalid audit reference export')
        n=sum(1 for _ in rd)
    print(f'OK: item-number reference ({n} rows; no serial column)')
print('PASS: local installation preflight')
