"""Run after setup.ps1 -NoLaunch -NoShortcut on a Windows CI machine."""
import json
import os
from pathlib import Path
import struct
import subprocess
import winreg
root=Path(__file__).resolve().parents[1]
with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Mozilla\NativeMessagingHosts\non_inventory_host') as key:
    path,_=winreg.QueryValueEx(key,'')
manifest=json.loads(Path(path).read_text(encoding='utf-8'))
assert manifest['allowed_extensions']==['non-inventory@builtbysai.com']
launcher=Path(manifest['path']);assert launcher.is_file()
command=f'"{os.environ["COMSPEC"]}" /d /s /c ""{launcher}" --no-companion"'
wire=json.dumps({'action':'status','requestId':'setup-smoke'}).encode()
p=subprocess.run(command,input=struct.pack('<I',len(wire))+wire,capture_output=True,timeout=20,check=True)
assert len(p.stdout)>=4,p.stderr.decode(errors='replace')
size=struct.unpack('<I',p.stdout[:4])[0];assert len(p.stdout)==size+4,p.stdout[:200]
result=json.loads(p.stdout[4:]);assert result['ok'] and result['requestId']=='setup-smoke',result
print('PASS Windows setup, native host registration and actual batch launcher protocol')
