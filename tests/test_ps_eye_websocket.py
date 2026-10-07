#!/usr/bin/env python3
"""Smoke test for Core2 PS Eye PCM WebSocket."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import socket
import ssl
import struct
from urllib.parse import urlsplit

GUID="258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

def recv_exact(sock,n):
    out=b""
    while len(out)<n:
        chunk=sock.recv(n-len(out))
        if not chunk:
            raise RuntimeError("socket closed")
        out+=chunk
    return out

def recv_frame(sock):
    h=recv_exact(sock,2)
    opcode=h[0]&0x0f
    length=h[1]&0x7f
    if length==126:
        length=struct.unpack("!H",recv_exact(sock,2))[0]
    elif length==127:
        length=struct.unpack("!Q",recv_exact(sock,8))[0]
    return opcode, recv_exact(sock,length) if length else b""

ap=argparse.ArgumentParser()
ap.add_argument("url", nargs="?", default="ws://127.0.0.1:8000/ps-eye/ws")
ap.add_argument("--origin", default=None)
args=ap.parse_args()

u=urlsplit(args.url)
host=u.hostname or "127.0.0.1"
port=u.port or (443 if u.scheme=="wss" else 80)
raw=socket.create_connection((host,port),timeout=8)
if u.scheme=="wss":
    ctx=ssl.create_default_context()
    s=ctx.wrap_socket(raw,server_hostname=host)
else:
    s=raw
s.settimeout(8)

key=base64.b64encode(os.urandom(16)).decode()
expected=base64.b64encode(hashlib.sha1((key+GUID).encode()).digest()).decode()
host_header=u.netloc
origin=args.origin or (("https" if u.scheme=="wss" else "http")+"://"+host_header)
req=(
    f"GET {u.path or '/'} HTTP/1.1\r\n"
    f"Host: {host_header}\r\n"
    f"Origin: {origin}\r\n"
    "Upgrade: websocket\r\n"
    "Connection: Upgrade\r\n"
    f"Sec-WebSocket-Key: {key}\r\n"
    "Sec-WebSocket-Version: 13\r\n\r\n"
)
s.sendall(req.encode())
buf=b""
while b"\r\n\r\n" not in buf:
    buf+=s.recv(4096)
head,rest=buf.split(b"\r\n\r\n",1)
text=head.decode("iso-8859-1")
assert " 101 " in text,text
assert f"Sec-WebSocket-Accept: {expected}".lower() in text.lower(),text

opcode,payload=recv_frame(s)
assert opcode==1,(opcode,len(payload))
hello=json.loads(payload)
assert hello["type"]=="hello",hello
assert hello["channels"]==4,hello
assert hello["rate"]==16000,hello
assert hello["format"]=="S16_LE",hello

for _ in range(6):
    opcode,payload=recv_frame(s)
    if opcode==1:
        msg=json.loads(payload)
        raise RuntimeError("server message before PCM: "+json.dumps(msg,ensure_ascii=False))
    if opcode==2:
        assert len(payload)>0
        assert len(payload)%8==0,len(payload)
        samples=struct.unpack("<"+"h"*(len(payload)//2),payload)
        peak=max(abs(v) for v in samples)
        frames=len(payload)//8
        print(f"PS_EYE_PCM_WS_OK bytes={len(payload)} frames={frames} peak={peak} block_ms={frames*1000/16000:.2f}")
        s.close()
        raise SystemExit(0)

raise RuntimeError("no binary PCM frame received")
