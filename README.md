# XAS Workbench

ブラウザ内で完結する、教育・予備解析向けの XAFS データ解析アプリです。

## 機能

- DAT / XMU / CSV / TXT の読み込みと列割り当て
- μ(E) 列または透過法 `ln(I0 / I1)` の計算
- 微分最大による E0 検出
- pre-edge 除去、post-edge 多項式規格化、フラット化
- 平滑化背景による χ(k) 抽出
- Hanning / Kaiser–Bessel 窓と k 重み付きフーリエ変換
- 複数データの重ね描画、ズーム、CSV 出力

## 起動

```bash
npm start
```

ブラウザで `http://localhost:8080` を開きます。ビルドや外部APIは不要です。

## テスト

```bash
npm test
```

> 本アプリの背景除去は Autobk の完全な移植ではなく、ブラウザ向けの平滑化近似です。精密解析では Athena / Larch 等との結果照合を推奨します。
