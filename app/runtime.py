"""Companion status and lifecycle controls share SQLite; no heartbeat-file contention."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
from engine import now

HEARTBEAT_SECONDS=6

def publish(ledger,state):
    payload={'at':now(),'pid':os.getpid(),**state}
    with ledger.db_open() as c:
        c.execute('INSERT OR REPLACE INTO runtime_status VALUES(1,?)',(json.dumps(payload),))
    return payload

def health(ledger):
    with ledger.db_open() as c:
        row=c.execute('SELECT payload FROM runtime_status WHERE id=1').fetchone()
    state=json.loads(row['payload']) if row else {}
    try:age=(datetime.now(timezone.utc)-datetime.fromisoformat(state['at'])).total_seconds()
    except (KeyError,ValueError,TypeError):age=999
    running=0<=age<HEARTBEAT_SECONDS and state.get('state') not in {'stopped','stopping'}
    return {'ok':True,'health':{**state,'running':running,'state':state.get('state','stopped') if running else 'stopped'}}

def stop(ledger,wait=8):
    ledger.configure({'capture_enabled':False,'companion_enabled':False,'identify_until':0})
    deadline=time.monotonic()+wait
    while health(ledger)['health']['running'] and time.monotonic()<deadline:time.sleep(.1)
    running=health(ledger)['health']['running']
    return {'ok':True,'stopped':not running,'message':'Stop requested; finishing current CSV update.' if running else 'Companion stopped. Journal and queue retained.'}

if __name__=='__main__':
    import sys
    from engine import Ledger
    ledger=Ledger(Path(__file__).resolve().parent.parent)
    if sys.argv[1:] == ['stop']:print(stop(ledger)['message'])
