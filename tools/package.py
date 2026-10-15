"""Allowlisted source-only packaging. Never traverses workspace data or environment files."""
from pathlib import Path
import hashlib
import json
import zipfile
ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'extension/manifest.json').read_text())['version']
OUT=ROOT/'dist';OUT.mkdir(exist_ok=True)
files=[]
for pattern in ['app/*.py','extension/*.js','extension/*.html','extension/*.css','extension/manifest.json','tests/*.py','tests/*.js','tools/*.py','docs/*.md']:
    files.extend(ROOT.glob(pattern))
files.extend(ROOT/name for name in ['README.md','SETUP.cmd','START.cmd','STOP.cmd','UNINSTALL.cmd','setup.ps1','requirements.txt','.gitignore'])
files.append(ROOT/'workspace/.gitkeep')
with zipfile.ZipFile(OUT/f'non-inventory-{VERSION}.zip','w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(set(files)):z.write(p,'non-inventory/'+str(p.relative_to(ROOT)))
with zipfile.ZipFile(OUT/f'non-inventory-{VERSION}-unsigned.xpi','w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted((ROOT/'extension').iterdir()):
        if p.is_file() and p.suffix in {'.json','.js','.css','.html'}:z.write(p,p.name)
(OUT/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(OUT.glob(f'non-inventory-{VERSION}*')) if p.suffix in {'.zip','.xpi'}))
print('Built source-only ZIP, unsigned Firefox XPI, and checksums.')
