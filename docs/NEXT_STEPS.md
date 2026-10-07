# Next steps

## 1. Near-field 2D SRP-PHAT — implemented

A内部6 pair + B内部6 pairをXY候補点へ直接融合し、heatmap表示まで実装済み。
2 cm gridを標準、1 cm gridをheavy modeとして比較できる。

次の改善候補:

- Web Worker化してUI threadから分離
- multi-resolution scan（4 cm粗探索 → 5 mm局所探索）
- peak persistence / temporal tracking
- heatmap history / variance表示
- known-point calibrationとの自動連携

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
