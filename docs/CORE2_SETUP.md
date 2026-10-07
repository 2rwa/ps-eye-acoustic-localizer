# Core2 setup

実験ホストで確認した軽量構成をstandalone化したもの。

## Dependencies

- Linux
- Python 3
- ALSA `arecord`
- PS Eyeを読める `snd-usb-audio`

確認:

```bash
arecord -l
cat /proc/asound/cards
cat /proc/asound/card1/stream0
```

native capture test:

```bash
arecord -D hw:CARD=CameraB409241,DEV=0 \
  -t raw -f S16_LE -c 4 -r 16000 -d 1 /tmp/ps-eye.raw
stat -c%s /tmp/ps-eye.raw
```

1秒なら128000 bytesが期待値。

## Permissions

runner/service userがaudio groupに入っていることを確認する。

```bash
id
ls -l /dev/snd/
```

## Reverse proxy

standalone serverはloopback bindを推奨。

```text
HTTPS/WSS nginx :443
        ↓
127.0.0.1:8000
```

WebSocket用にUpgrade/Connection headersをproxyする。

## Start

```bash
./server/run.sh
```

必要ならsystemd/user serviceやcron @rebootで起動する。
