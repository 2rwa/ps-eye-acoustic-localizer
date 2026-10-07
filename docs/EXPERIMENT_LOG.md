# Experiment log

## Native format confirmation

PS Eye retail hardware on Linuxでnative audio descriptorを確認:

- S16_LE
- 4ch
- 16000 Hz
- interleaved
- 128000 bytes/s

48 kHzは`plughw`等によるresamplingでは可能だが、確認したnative `hw:` descriptorは16 kHz。

## Channel mapping

実音テストから物理左→右を `ch1,ch3,ch2,ch4` とした。
再接続時にmappingが変化する可能性は残るため、startup calibrationを将来検討する。

## USB audio endpoint stall

一度、PS Eyeはenumeration・driver bindingとも正常なのに、audio captureが約0.6秒でI/O errorになる状態になった。

試したこと:

- process owner確認
- ALSA descriptor確認
- USBRESET
- `uhubctl`

USBRESETでは回復せず、古いcontrollerは`uhubctl`でport power control非対応。
最終的にPS Eyeを物理的に抜き差しすると復旧した。

復旧後:

- WAV 1秒: header込み128044 bytes
- raw 1秒: 128000 bytes
- Python pipe: 128000 bytes
- WebSocket: 128 frames / 1024 bytes / 8 ms block

## Dual PS Eye

2台を同時認識:

- B4.09.24.1
- B3.04.06.1

両方とも4ch / 16k / S16_LE。
別USB clockのためcross-device phase/TDOAは使わない。

## Browser processing

Current/SRPともDSPをbrowserへ寄せ、host側負荷をPCM転送中心にした。
UIにはproc ms / update Hz / packet ms / slow countを表示し、端末側の計算落ちを切り分けられるようにしている。


## Near-field 2D SRP-PHAT synthetic validation

Near-field実装では、各array内部6 pairのPHAT delay responseを `-4..+4 sample` / 1/32 sample刻みで作り、A/B合計12 pairをXY gridへ融合する。

default geometry:

```text
Array A: (0.00 m, 0.00 m), +18°
Array B: (0.50 m, 0.00 m), -18°
grid step: 0.02 m
```

既知XYから2台ぶんの4ch合成PCMを生成して、FFT → PHAT response → near-field 2D scanまで通したCI self-test:

```text
target (0.20, 0.70) -> estimated (0.2046, 0.7015), error 0.0049 m
target (0.55, 1.05) -> estimated (0.5594, 1.0799), error 0.0313 m
target (-0.10, 0.90) -> estimated (-0.0977, 0.8810), error 0.0191 m
```

これは理想的な合成信号に対する実装検証値であり、室内反射・PS Eye実機誤差・array設置誤差を含む実環境精度を意味しない。
