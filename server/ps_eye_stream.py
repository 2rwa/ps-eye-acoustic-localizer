#!/usr/bin/env python3
"""PS Eye 4-channel PCM -> WebSocket bridge for Linux/ALSA.

Capture is demand-driven: arecord is started when the first /ps-eye/ws client
connects and stopped after the last client disconnects.

Wire format for binary WebSocket frames:
  little-endian signed 16-bit PCM, interleaved logical channels 1,2,3,4
  16000 frames/sec, 8 bytes/frame.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import struct
import subprocess
import threading
import time
from urllib.parse import urlsplit

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
DEVICE_A = os.environ.get("PS_EYE_A", "hw:CARD=CameraB409241,DEV=0")
DEVICE_B = os.environ.get("PS_EYE_B", "hw:CARD=CameraB304061,DEV=0")
RATE = 16000
CHANNELS = 4
SAMPLE_BYTES = 2
FRAME_BYTES = CHANNELS * SAMPLE_BYTES
BLOCK_FRAMES = 128
BLOCK_BYTES = BLOCK_FRAMES * FRAME_BYTES


def recv_exact(sock: socket.socket, size: int) -> bytes:
    out = []
    remaining = size
    while remaining:
        chunk = sock.recv(remaining)
        if not chunk:
            raise ConnectionError("websocket closed")
        out.append(chunk)
        remaining -= len(chunk)
    return b"".join(out)


def read_frame(sock: socket.socket) -> tuple[int, bytes]:
    first = recv_exact(sock, 2)
    opcode = first[0] & 0x0F
    masked = bool(first[1] & 0x80)
    length = first[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", recv_exact(sock, 8))[0]
    mask = recv_exact(sock, 4) if masked else b""
    payload = recv_exact(sock, length) if length else b""
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return opcode, payload


def make_frame(payload: bytes, opcode: int) -> bytes:
    first = 0x80 | (opcode & 0x0F)
    length = len(payload)
    if length < 126:
        header = bytes((first, length))
    elif length < 65536:
        header = bytes((first, 126)) + struct.pack("!H", length)
    else:
        header = bytes((first, 127)) + struct.pack("!Q", length)
    return header + payload


def send_frame(sock: socket.socket, payload: bytes, opcode: int) -> None:
    sock.sendall(make_frame(payload, opcode))


def send_json(sock: socket.socket, value: dict) -> None:
    send_frame(
        sock,
        json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        0x1,
    )


class PsEyeHub:
    def __init__(self, name: str, device: str) -> None:
        self.name = name
        self.device = device
        self._lock = threading.Lock()
        self._send_lock = threading.Lock()
        self._clients: set[socket.socket] = set()
        self._thread: threading.Thread | None = None
        self._proc: subprocess.Popen | None = None
        self._capture_running = False
        self._started_at: float | None = None
        self._packets = 0
        self._bytes = 0
        self._last_error: str | None = None
        self._restart_requested = False

    def status(self) -> dict:
        with self._lock:
            return {
                "clients": len(self._clients),
                "capture_running": self._capture_running,
                "name": self.name,
                "device": self.device,
                "rate": RATE,
                "channels": CHANNELS,
                "format": "S16_LE",
                "block_frames": BLOCK_FRAMES,
                "block_ms": BLOCK_FRAMES * 1000.0 / RATE,
                "packets": self._packets,
                "bytes": self._bytes,
                "started_at": self._started_at,
                "last_error": self._last_error,
            }

    def _ensure_capture(self) -> None:
        thread = None
        with self._lock:
            if self._clients and (self._thread is None or not self._thread.is_alive()):
                thread = threading.Thread(
                    target=self._capture_loop,
                    name=f"ps-eye-capture-{self.name}",
                    daemon=True,
                )
                self._thread = thread
        if thread is not None:
            thread.start()

    def add(self, sock: socket.socket) -> None:
        with self._lock:
            self._clients.add(sock)
        self._ensure_capture()

    def remove(self, sock: socket.socket) -> None:
        with self._lock:
            self._clients.discard(sock)

    def restart(self) -> dict:
        """Force the current arecord process down and allow a clean restart."""
        with self._lock:
            self._restart_requested = True
            proc = self._proc
            thread_alive = self._thread is not None and self._thread.is_alive()
            clients = len(self._clients)
            self._last_error = None

        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=0.8)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:
                    proc.wait(timeout=0.8)
                except subprocess.TimeoutExpired:
                    pass

        if not thread_alive:
            with self._lock:
                self._restart_requested = False
            self._ensure_capture()

        return {
            "ok": True,
            "array": self.name,
            "device": self.device,
            "clients": clients,
            "capture_was_running": proc is not None,
        }

    def _client_snapshot(self) -> list[socket.socket]:
        with self._lock:
            return list(self._clients)

    def _client_count(self) -> int:
        with self._lock:
            return len(self._clients)

    def _broadcast(self, payload: bytes, opcode: int) -> None:
        dead = []
        for sock in self._client_snapshot():
            try:
                with self._send_lock:
                    send_frame(sock, payload, opcode)
            except OSError:
                dead.append(sock)
        if dead:
            with self._lock:
                for sock in dead:
                    self._clients.discard(sock)

    def _broadcast_json(self, value: dict) -> None:
        payload = json.dumps(
            value, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        self._broadcast(payload, 0x1)

    def _capture_loop(self) -> None:
        cmd = [
            "arecord", "-q",
            "-D", self.device,
            "-t", "raw",
            "-f", "S16_LE",
            "-c", str(CHANNELS),
            "-r", str(RATE),
        ]
        proc = None
        carry = b""
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
            )
            with self._lock:
                self._proc = proc
                self._capture_running = True
                self._started_at = time.time()
                self._packets = 0
                self._bytes = 0
                self._last_error = None

            assert proc.stdout is not None
            while self._client_count() > 0:
                chunk = proc.stdout.read(BLOCK_BYTES)
                if not chunk:
                    break
                data = carry + chunk
                aligned = len(data) - (len(data) % FRAME_BYTES)
                if aligned:
                    payload = data[:aligned]
                    carry = data[aligned:]
                    self._broadcast(payload, 0x2)
                    with self._lock:
                        self._packets += 1
                        self._bytes += len(payload)
                else:
                    carry = data

            with self._lock:
                restarting = self._restart_requested
            if proc.poll() not in (None, 0) and self._client_count() > 0 and not restarting:
                err = ""
                if proc.stderr is not None:
                    err = proc.stderr.read().decode("utf-8", "replace").strip()
                raise RuntimeError(err or f"arecord exited {proc.returncode}")
        except (OSError, RuntimeError) as exc:
            message = str(exc)
            with self._lock:
                self._last_error = message
            self._broadcast_json({"type": "error", "error": message})
        finally:
            if proc is not None and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=1)
            restart = False
            with self._lock:
                self._proc = None
                self._capture_running = False
                if self._thread is threading.current_thread():
                    self._thread = None
                restart = self._restart_requested and bool(self._clients)
                self._restart_requested = False
            if restart:
                self._ensure_capture()


HUB_A = PsEyeHub("A", DEVICE_A)
HUB_B = PsEyeHub("B", DEVICE_B)


def status() -> dict:
    return {"a": HUB_A.status(), "b": HUB_B.status()}


def restart(array: str = "both") -> dict:
    key = array.lower()
    if key == "a":
        return {"ok": True, "results": [HUB_A.restart()], "status": status()}
    if key == "b":
        return {"ok": True, "results": [HUB_B.restart()], "status": status()}
    if key == "both":
        return {"ok": True, "results": [HUB_A.restart(), HUB_B.restart()], "status": status()}
    raise ValueError("array must be a, b, or both")


def handle_websocket(handler, array: str = "a") -> None:
    hub = HUB_A if array.lower() == "a" else HUB_B
    if not handler.local_network_request():
        handler.send_error(403)
        return

    origin = handler.headers.get("Origin", "").strip()
    host = handler.headers.get("Host", "").strip().lower()
    try:
        origin_host = urlsplit(origin).netloc.lower()
    except ValueError:
        origin_host = ""
    if not origin or not host or origin_host != host:
        handler.send_error(403, "same-origin websocket required")
        return

    key = handler.headers.get("Sec-WebSocket-Key")
    version = handler.headers.get("Sec-WebSocket-Version")
    if not key or version != "13":
        handler.send_error(400, "invalid websocket handshake")
        return

    accept = base64.b64encode(
        hashlib.sha1((key + GUID).encode("ascii")).digest()
    ).decode("ascii")
    handler.send_response(101, "Switching Protocols")
    handler.send_header("Upgrade", "websocket")
    handler.send_header("Connection", "Upgrade")
    handler.send_header("Sec-WebSocket-Accept", accept)
    handler.end_headers()
    handler.wfile.flush()

    sock = handler.connection
    try:
        send_json(sock, {
            "type": "hello",
            "service": "ps-eye-pcm",
            "array": hub.name,
            "device": hub.device,
            "format": "S16_LE",
            "rate": RATE,
            "channels": CHANNELS,
            "channel_order": [1, 2, 3, 4],
            "physical_left_to_right": [1, 3, 2, 4],
            "frame_bytes": FRAME_BYTES,
            "block_frames": BLOCK_FRAMES,
            "block_ms": BLOCK_FRAMES * 1000.0 / RATE,
            "time": time.time(),
        })
        hub.add(sock)
        while True:
            opcode, payload = read_frame(sock)
            if opcode == 0x8:
                try:
                    with hub._send_lock:
                        send_frame(sock, payload, 0x8)
                except OSError:
                    pass
                break
            if opcode == 0x9:
                with hub._send_lock:
                    send_frame(sock, payload, 0xA)
    except (ConnectionError, OSError):
        pass
    finally:
        hub.remove(sock)
        handler.close_connection = True
