"""Windows device-specific Raw Input; serial scanners use optional pyserial."""
import ctypes as C
from ctypes import wintypes as W
import os
import threading
import time

class Framer:
    def __init__(self,callback):self.callback=callback;self.buffer='';self.last=0
    def feed(self,char):
        stamp=time.monotonic()
        if stamp-self.last>2:self.buffer=''
        self.last=stamp
        if char in '\r\n\t':
            if self.buffer:self.callback(self.buffer)
            self.buffer=''
        elif char.isprintable():
            self.buffer+=char
            if len(self.buffer)>512:self.buffer=''

if os.name=='nt':
    U=C.WinDLL('user32',use_last_error=True);K=C.WinDLL('kernel32',use_last_error=True)
    LRESULT=C.c_ssize_t;WPARAM=C.c_size_t;LPARAM=C.c_ssize_t
    PROC=C.WINFUNCTYPE(LRESULT,W.HWND,W.UINT,WPARAM,LPARAM)
    class DEV(C.Structure):_fields_=[('handle',W.HANDLE),('kind',W.DWORD)]
    class RID(C.Structure):_fields_=[('page',W.USHORT),('usage',W.USHORT),('flags',W.DWORD),('target',W.HWND)]
    class HEADER(C.Structure):_fields_=[('kind',W.DWORD),('size',W.DWORD),('device',W.HANDLE),('wparam',WPARAM)]
    class KEY(C.Structure):_fields_=[('make',W.USHORT),('flags',W.USHORT),('reserved',W.USHORT),('vk',W.USHORT),('message',W.UINT),('extra',W.ULONG)]
    class WC(C.Structure):_fields_=[('style',W.UINT),('proc',PROC),('clsExtra',C.c_int),('wndExtra',C.c_int),('instance',W.HINSTANCE),('icon',W.HICON),('cursor',W.HANDLE),('background',W.HBRUSH),('menu',W.LPCWSTR),('name',W.LPCWSTR)]
    U.GetRawInputDeviceList.argtypes=[C.POINTER(DEV),C.POINTER(W.UINT),W.UINT]
    U.GetRawInputDeviceInfoW.argtypes=[W.HANDLE,W.UINT,C.c_void_p,C.POINTER(W.UINT)]
    U.GetRawInputData.argtypes=[W.HANDLE,W.UINT,C.c_void_p,C.POINTER(W.UINT),W.UINT]
    U.RegisterRawInputDevices.argtypes=[C.POINTER(RID),W.UINT,W.UINT]
    U.DefWindowProcW.argtypes=[W.HWND,W.UINT,WPARAM,LPARAM];U.DefWindowProcW.restype=LRESULT
    U.CreateWindowExW.argtypes=[W.DWORD,W.LPCWSTR,W.LPCWSTR,W.DWORD,C.c_int,C.c_int,C.c_int,C.c_int,W.HWND,W.HMENU,W.HINSTANCE,C.c_void_p];U.CreateWindowExW.restype=W.HWND
    U.GetMessageW.argtypes=[C.POINTER(W.MSG),W.HWND,W.UINT,W.UINT]
    U.TranslateMessage.argtypes=[C.POINTER(W.MSG)]
    U.DispatchMessageW.argtypes=[C.POINTER(W.MSG)];U.DispatchMessageW.restype=LRESULT
    U.RegisterClassW.argtypes=[C.POINTER(WC)]
    K.GetModuleHandleW.argtypes=[W.LPCWSTR];K.GetModuleHandleW.restype=W.HMODULE
    U.GetKeyboardLayout.argtypes=[W.DWORD];U.GetKeyboardLayout.restype=W.HANDLE
    U.ToUnicodeEx.argtypes=[W.UINT,W.UINT,C.POINTER(C.c_ubyte),W.LPWSTR,C.c_int,W.UINT,W.HANDLE]

def device_name(handle):
    n=W.UINT();U.GetRawInputDeviceInfoW(handle,0x20000007,None,C.byref(n))
    if not n.value:return ''
    buf=C.create_unicode_buffer(n.value+1);U.GetRawInputDeviceInfoW(handle,0x20000007,buf,C.byref(n));return buf.value

def devices():
    if os.name!='nt':return []
    n=W.UINT()
    if U.GetRawInputDeviceList(None,C.byref(n),C.sizeof(DEV))==0xffffffff:raise C.WinError(C.get_last_error())
    arr=(DEV*n.value)();U.GetRawInputDeviceList(arr,C.byref(n),C.sizeof(DEV))
    return sorted({device_name(d.handle) for d in arr if d.kind==1})

def raw_input(get_config,capture,health):
    if os.name!='nt':health('HID requires Windows');return
    state={};keys=(C.c_ubyte*256)();framers={}
    @PROC
    def proc(hwnd,msg,wp,lp):
        if msg==0xfe:state.clear();framers.clear()
        if msg==0xff:
            try:
                cfg=get_config()
                if cfg.get('input_mode')=='hid' and cfg.get('capture_enabled',True) and cfg.get('device'):
                    n=W.UINT();U.GetRawInputData(W.HANDLE(lp),0x10000003,None,C.byref(n),C.sizeof(HEADER))
                    buf=C.create_string_buffer(n.value)
                    if U.GetRawInputData(W.HANDLE(lp),0x10000003,buf,C.byref(n),C.sizeof(HEADER))!=0xffffffff:
                        h=HEADER.from_buffer_copy(buf)
                        if h.kind==1:
                            name=state.get(h.device)
                            if name is None:name=device_name(h.device);state[h.device]=name
                            if name==cfg['device']:
                                k=KEY.from_buffer_copy(buf,C.sizeof(HEADER));up=bool(k.flags&1)
                                keys[k.vk]=0 if up else 128
                                if k.vk in (160,161):keys[16]=keys[k.vk]
                                if not up:
                                    frame=framers.setdefault(name,Framer(capture))
                                    if k.vk in (13,9):frame.feed('\r')
                                    else:
                                        out=C.create_unicode_buffer(8)
                                        size=U.ToUnicodeEx(k.vk,k.make,keys,out,8,4,U.GetKeyboardLayout(0))
                                        if size>0:
                                            for char in out.value[:size]:frame.feed(char)
                if cfg.get('input_mode')=='hid':health('HID listening')
            except Exception as e:health('HID error: '+str(e))
        return U.DefWindowProcW(hwnd,msg,wp,lp)
    instance=K.GetModuleHandleW(None);name='NonInventoryScanner'+str(os.getpid())
    wc=WC();wc.proc=proc;wc.instance=instance;wc.name=name
    if not U.RegisterClassW(C.byref(wc)):raise C.WinError(C.get_last_error())
    hwnd=U.CreateWindowExW(0,name,name,0,0,0,0,0,W.HWND(-3),None,instance,None)
    if not hwnd:raise C.WinError(C.get_last_error())
    rid=RID(1,6,0x2100,hwnd)
    if not U.RegisterRawInputDevices(C.byref(rid),1,C.sizeof(RID)):raise C.WinError(C.get_last_error())
    health('HID listening');msg=W.MSG()
    while U.GetMessageW(C.byref(msg),None,0,0)>0:U.TranslateMessage(C.byref(msg));U.DispatchMessageW(C.byref(msg))

def serial_loop(get_config,capture,health,stop):
    while not stop.is_set():
        cfg=get_config()
        if cfg.get('input_mode')!='com' or not cfg.get('capture_enabled',True):stop.wait(.5);continue
        try:
            import serial
            with serial.Serial(cfg.get('port','COM3'),int(cfg.get('baud',9600)),timeout=.3) as port:
                health('COM connected');frame=Framer(capture)
                while not stop.is_set() and get_config()==cfg:
                    data=port.read(256)
                    if data:
                        for char in data.decode('ascii',errors='strict'):frame.feed(char)
        except Exception as e:health('COM reconnecting: '+str(e));stop.wait(2)
