# Algorithms

## Current: GCC-PHAT + weighted least squares

各PS Eyeについて:

1. 512 samples = 32 ms window
2. 256 samples = 16 ms hop
3. Hann window
4. 4ch FFT
5. 6 microphone pairsのGCC-PHAT
6. correlation peakをparabolic interpolation
7. pair qualityで重み付け
8. `sin(theta)` をleast-squares推定
9. confidence依存の時間平滑化

合成信号self-testではおおむね数度以内を確認している。

## SRP-PHAT

Currentとの比較用。

- 500–3500 Hz
- 6 microphone pairs
- PHAT-normalized cross spectrum
- -90°..+90°を1°刻み
- fractional TDOAを周波数位相から直接評価
- 角度ごとのspatial scoreを表示

初版では整数sample相関の補間により±55°付近で約9°内側へ寄るbiasが出たため、frequency-domain continuous-delay evaluationへ変更した。

## 2D triangulation

Array A/Bで得た方位rayの交点を求める。
交差角が小さい場合、角度誤差が位置誤差として大きく増幅される。

## Reverberation

板床・壁などの反射ではGCC-PHATにも複数peakが現れる。
Currentは最大peak選択の影響を受けやすい。
SRP-PHATでは6 pairを同じ角度仮説で合成するため、反射方向への単発peakに対して改善が期待できる。

今後は2D near-field SRP、pair consensus、temporal tracking、band selectionを比較する。
