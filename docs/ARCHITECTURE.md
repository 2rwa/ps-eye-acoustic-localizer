# Architecture

## 方針

LinuxホストはPS Eyeから4ch PCMを取得し、WebSocketでブラウザへ転送するだけにする。
DSPはブラウザ側で行う。

```text
PS Eye A 4ch ─ arecord ─┐
                        ├─ Python WebSocket server ─ Browser DSP
PS Eye B 4ch ─ arecord ─┘
```

## PCM wire format

- S16_LE
- 16000 frames/s
- 4 channels
- interleaved logical ch1,ch2,ch3,ch4
- 8 bytes/frame
- nominal block: 128 frames = 8 ms = 1024 bytes

## WebSocket endpoints

- `/ps-eye/ws` — Array A compatibility endpoint
- `/ps-eye/a/ws` — Array A
- `/ps-eye/b/ws` — Array B

Capture is demand-driven. 最初のclient接続時に `arecord` を開始し、最後のclientが切断すると停止する。

## Clock domains

2台のPS Eyeは独立したUSB asynchronous audio deviceであり、sample clockは同期していない。
そのためA/Bを同期8ch arrayとして扱わず、各PS Eye内部の4chだけでDOAを計算する。
2D位置は各arrayのDOAまたはspatial likelihoodを幾何的に融合する。
