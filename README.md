# ps-eye-acoustic-localizer

Sony PlayStation Eye の4chマイクアレイを使い、ブラウザ側で音源方向・2D音源位置を推定する実験プロジェクトです。

低性能なLinux PC側は **4ch PCMをWebSocketで配信するだけ** にし、GCC-PHAT / SRP-PHAT / 2D測位などのDSPはブラウザ側で実行します。

## 現在の構成

- PS Eye × 2
- 各PS Eye: native S16_LE / 4ch / 16000 Hz
- 物理マイク順（実機確認）: Mic1 / Mic3 / Mic2 / Mic4
- USB論理ch: ch1 / ch2 / ch3 / ch4
- 2台は別USBクロックとして扱う
- クロスデバイスのsample-level TDOAは使わない
- 既定配置: Array A=(0,0), +18° / Array B=(50 cm,0), -18°

## Web apps

- `/ps-eye/` — 4ch monitor + Current GCC-PHAT DOA
- `/ps-eye/dual/` — 2台の方位線を交差させる2D localizer
- `/ps-eye/compare/` — Current / SRP-PHAT 比較
- `/ps-eye/nearfield/` — Near-field 2D SRP-PHAT + heatmap
- `/ps-eye/calibrator/` — スマホ用 chirp / noise burst / sine 校正音源

## 起動

Linux + ALSA + `arecord` 前提です。

```bash
./server/run.sh
```

既定では `127.0.0.1:8000`。HTTPS/WSS公開時はnginx等でreverse proxyしてください。

PS EyeのALSA card名が異なる場合:

```bash
PS_EYE_A='hw:CARD=CameraB409241,DEV=0' \
PS_EYE_B='hw:CARD=CameraB304061,DEV=0' \
./server/run.sh
```

## テスト

実機がある状態で:

```bash
python3 tests/test_ps_eye_websocket.py ws://127.0.0.1:8000/ps-eye/a/ws --origin http://127.0.0.1:8000
python3 tests/test_ps_eye_websocket.py ws://127.0.0.1:8000/ps-eye/b/ws --origin http://127.0.0.1:8000
```

## ドキュメント

- [Architecture](docs/ARCHITECTURE.md)
- [Hardware / channel mapping](docs/HARDWARE.md)
- [Algorithms](docs/ALGORITHMS.md)
- [Calibration](docs/CALIBRATION.md)
- [Core2 setup](docs/CORE2_SETUP.md)
- [Experiment log](docs/EXPERIMENT_LOG.md)
- [Next steps](docs/NEXT_STEPS.md)

## License

0BSD. コード・ドキュメントとも `LICENSE` の条件で利用できます。
