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
from scanners import device_choices
from runtime import health,stop
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
                try:
                    if LEDGER.config().get('companion_enabled',True):LEDGER.process(1)
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
            if request.get('action')=='devices':result={'ok':True,**device_choices()}
            elif request.get('action')=='health':result=health(LEDGER)
            elif request.get('action')=='stop_companion':result=stop(LEDGER)
            elif request.get('action')=='start_companion':
                start(force=True);result={'ok':True}
            elif request.get('action')=='identify_scanner':
                LEDGER.configure({'identified_device':'','identify_until':time.time()+20});start(force=True);result={'ok':True}
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
