# Next steps

## 1. Near-field 2D SRP-PHAT

A/Bで先にDOAを1本へ潰さず、XY候補点を直接評価する。

各候補点 `P` について、各array内部pairの理論TDOA:

```text
tau_ij(P) = (|P-M_i| - |P-M_j|) / c
```

を計算し、A内部6 pair + B内部6 pairのscoreを融合する。

2 m × 2 mを1 cm gridなら約4万候補点。
ブラウザ側に余裕がある場合はheatmap表示まで行う。

## 2. Oversampled GCC / SRP

16 kHzでは1 sample = 62.5 µs。
時間差量子化を減らすため4x/8x相当のfractional-delay evaluationを比較する。

## 3. Reverberation robustness

- frequency band selection
- pair consensus / RANSAC
- multi-peak tracking
- temporal continuity
- Kalman / particle filter
- direct-path preference

## 4. More expensive methods

- MVDR / Capon beamforming
- broadband MUSIC
- dereverberation + SRP
- probabilistic spatial likelihood fusion

## 5. Calibration solver

複数既知点から以下を同時最適化する:

- Array A/B center
- heading
- effective microphone spacing
- per-channel delay bias
- systematic DOA bias
