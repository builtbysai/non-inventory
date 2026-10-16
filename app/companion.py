"""Independent local capture process. SQLite owns status, stop requests and recovery."""
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from engine import Ledger
from runtime import publish,health
from scanners import raw_input,serial_loop
ROOT=Path(__file__).resolve().parent.parent

def start(force=False):
    ledger=Ledger(ROOT)
    if force:ledger.configure({'companion_enabled':True,'capture_enabled':True})
    if ledger.config().get('companion_enabled') is False:return
    if health(ledger)['health']['running']:return
    if os.name!='nt':return  # Tests explicitly launch run() on Linux.
    flags=subprocess.DETACHED_PROCESS|subprocess.CREATE_NEW_PROCESS_GROUP|subprocess.CREATE_NO_WINDOW
    subprocess.Popen([sys.executable,str(Path(__file__).resolve())],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)

def run():
    ledger=Ledger(ROOT)
    lock=(ledger.workspace/'companion.lock').open('a+b')
    try:
        if os.name=='nt':
            import msvcrt
            if lock.tell()==0:lock.write(b'0');lock.flush()
            lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError:lock.close();return
    if ledger.config().get('companion_enabled') is False:lock.close();return
    stop=threading.Event();state={'state':'running','input':'Starting'}
    def report(message):state['input']=message
    def capture(raw,source):
        try:
            cfg=ledger.config()
            if not cfg.get('capture_enabled',True) or not cfg.get('companion_enabled',True) or cfg.get('input_mode')!=source:return
            ledger.capture(raw,cfg.get('username',''),source)
            if os.name=='nt':
                import winsound
                winsound.PlaySound('SystemAsterisk',winsound.SND_ALIAS|winsound.SND_ASYNC)
        except Exception as e:
            report('Capture failed: '+str(e))
            if os.name=='nt':
                import winsound
                winsound.PlaySound('SystemHand',winsound.SND_ALIAS|winsound.SND_ASYNC)
    cached={'at':0,'config':{}}
    def get_config():
        if time.monotonic()-cached['at']>.25:
            cached['config']=ledger.config();cached['at']=time.monotonic()
        return cached['config']
    def identify(path):
        cfg=ledger.config()
        if cfg.get('identify_until',0)>time.time():ledger.configure({'identified_device':path,'identify_until':0})
    def listen():
        try:raw_input(get_config,lambda raw:capture(raw,'hid'),report,identify)
        except Exception as e:report('Scanner listener unavailable: '+str(e))
    threading.Thread(target=listen,daemon=True).start()
    threading.Thread(target=serial_loop,args=(ledger.config,lambda raw:capture(raw,'com'),report,stop),daemon=True).start()
    try:
        while ledger.config().get('companion_enabled',True):
            ledger.process(1)  # Honor Stop between individual durable CSV updates.
            cfg=ledger.config()
            if cfg.get('input_mode','station')=='station':state['input']='Scan field in Firefox'
            elif not cfg.get('capture_enabled',True):state['input']='Capture paused'
            try:publish(ledger,state)
            except OSError:pass  # A status write must never interrupt capture.
            stop.wait(.2)
    finally:
        stop.set()
        try:publish(ledger,{**state,'state':'stopped','input':'Stopped'})
        finally:lock.close()

if __name__=='__main__':
    if '--start' in sys.argv:Ledger(ROOT).configure({'companion_enabled':True,'capture_enabled':True})
    run()
