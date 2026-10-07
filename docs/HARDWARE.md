# Hardware

## Verified devices

実機で確認した2台:

- Array A: `USB Camera-B4.09.24.1`
- Array B: `USB Camera-B3.04.06.1`
- USB VID:PID: `1415:2000`

両方ともLinux ALSA descriptor上は:

```text
Format: S16_LE
Channels: 4
Rates: 16000
Endpoint: 0x84 IN (ASYNC)
Bits: 16
Channel map: FL FR FC LFE
```

## Physical channel order

PS Eye正面から見た物理左→右:

```text
Mic1      Mic3      Mic2      Mic4
ch1       ch3       ch2       ch4
```

WebSocket PCM自体は論理順 `ch1,ch2,ch3,ch4` のまま。

## Internal microphone geometry

現在のDSPでは作業値として:

```text
-30 mm  -10 mm  +10 mm  +30 mm
 Mic1    Mic3    Mic2    Mic4
```

を使っている。これは測位モデル用の近似値なので、精密測定値として扱わない。

## Dual-array default geometry

```text
Array A center: (0 cm, 0 cm), heading +18°
Array B center: (50 cm, 0 cm), heading -18°
```

50–100 cm程度先を主な測位領域として想定した初期値。
