"""Independent local capture process; no network listeners, survives Firefox exit."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from engine import Ledger,now
from scanners import raw_input,serial_loop
ROOT=Path(__file__).resolve().parent.parent

def start():
    if os.name!='nt':return  # Development uses explicit process() in tests.
    flags=subprocess.DETACHED_PROCESS|subprocess.CREATE_NEW_PROCESS_GROUP|subprocess.CREATE_NO_WINDOW
    subprocess.Popen([sys.executable,str(Path(__file__).resolve())],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)

def run():
    ledger=Ledger(ROOT)
    lock=(ledger.workspace/'companion.lock').open('a+b')
    try:
        if os.name=='nt':
            import msvcrt
            lock.write(b'0');lock.flush();lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError:return
    stop=threading.Event();health_state={'input':'Starting'}
    def health(message):health_state['input']=message
    def capture(raw):
        try:
            cfg=ledger.config()
            if not cfg.get('capture_enabled',True):return
            ledger.capture(raw,cfg.get('username',''),cfg.get('input_mode','device'))
            if os.name=='nt':
                import winsound
                winsound.PlaySound('SystemAsterisk',winsound.SND_ALIAS|winsound.SND_ASYNC)
        except Exception as e:
            health('CAPTURE FAILED: '+str(e))
            if os.name=='nt':
                import winsound
                winsound.PlaySound('SystemHand',winsound.SND_ALIAS|winsound.SND_ASYNC)
    cached={'at':0,'config':{}}
    def get_config():
        if time.monotonic()-cached['at']>.5:
            cached['config']=ledger.config();cached['at']=time.monotonic()
        return cached['config']
    threading.Thread(target=raw_input,args=(get_config,capture,health),daemon=True).start()
    threading.Thread(target=serial_loop,args=(ledger.config,capture,health,stop),daemon=True).start()
    try:
        while True:
            try:ledger.process(40)
            except Exception as e:health_state['worker']=str(e)
            status={'at':now(),**health_state,'pid':os.getpid()}
            temp=ledger.workspace/'companion-health.tmp';temp.write_text(json.dumps(status),encoding='utf-8');os.replace(temp,ledger.workspace/'companion-health.json')
            time.sleep(.2)
    except KeyboardInterrupt:stop.set()
if __name__=='__main__':run()
