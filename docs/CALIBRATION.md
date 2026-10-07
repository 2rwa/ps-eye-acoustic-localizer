# Calibration

## Smartphone sound source

`/ps-eye/calibrator/` はWeb Audio APIで校正音を生成する。

モード:

- Chirp: default 500 → 3500 Hz
- Noise Burst: broadband反射確認
- Sine: default 1 kHz、level/channel確認向け

単一sineは周期的な相関peakを作るため、TDOA/位置校正にはChirpまたはNoise Burstを推奨する。

## Recommended procedure

1. Array A/Bの中心間距離を実測する
2. 既知位置にスマホを置く
3. Chirpを一定周期で鳴らす
4. A/Bそれぞれの角度と2D位置を確認
5. Array B X/YとA/B headingを調整
6. 1点だけでなく複数点で検証する

例:

```text
(-50 cm, 100 cm)
(  0 cm, 100 cm)
(+50 cm, 100 cm)
(  0 cm, 150 cm)
```

複数点を使うことで、array heading、baseline、systematic angle biasを分離しやすい。

## Room reflections

板床では床反射が強くなることがある。
スマホは床へ直接置くより、実際の発話高さに近い位置に置く方が測位条件を再現しやすい。
