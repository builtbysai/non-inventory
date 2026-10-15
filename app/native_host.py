"""Firefox native messaging host. All transport is via stdin/stdout only."""
import json
from pathlib import Path
import struct
import sys
import traceback
import os
import threading
import time
from companion import start
from scanners import devices
from engine import Ledger

MAX_IN = 1024 * 1024
LEDGER = Ledger(Path(__file__).resolve().parent.parent)

def read_exact(count):
    buf=bytearray()
    while len(buf)<count:
        part=sys.stdin.buffer.read(count-len(buf))
        if not part:return None
        buf.extend(part)
    return bytes(buf)

def run():
    if os.name=='nt':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(),os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(),os.O_BINARY)
        if '--no-companion' not in sys.argv:start()
    else:
        def worker():
            while True:
                try: LEDGER.process(40)
                except Exception: pass
                time.sleep(.2)
        threading.Thread(target=worker,daemon=True).start()
    while True:
        size=read_exact(4)
        if size is None:break
        n=struct.unpack('<I',size)[0]
        if n < 1 or n > MAX_IN:break
        packet=read_exact(n)
        if packet is None:break
        request={}
        try:
            request=json.loads(packet)
            if request.get('action')=='devices':result={'ok':True,'devices':devices()}
            elif request.get('action')=='health':
                path=LEDGER.workspace/'companion-health.json'
                result={'ok':True,'health':json.loads(path.read_text()) if path.exists() else {'input':'Not running'}}
            else:result=LEDGER.dispatch(request)
        except Exception as exc:
            result={'ok':False,'error':str(exc)[:250]}
        result['requestId']=request.get('requestId') if isinstance(request,dict) else None
        wire=json.dumps(result, ensure_ascii=False).encode('utf-8')
        if len(wire)>MAX_IN:
            wire=json.dumps({'ok':False,'error':'Response exceeds Firefox native-message limit; review a smaller journal batch','requestId':result['requestId']}).encode('utf-8')
        sys.stdout.buffer.write(struct.pack('<I',len(wire)))
        sys.stdout.buffer.write(wire)
        sys.stdout.buffer.flush()

if __name__=='__main__':run()
