# 統計コードアドバイザー設計調査

> 旧corpus経路の研究記録です。Jazz-first更新ではPOP909の暗黙読み込みを廃止し、
> 標準UIは理論候補を提示します。以下の頻度計算は明示的にproviderへスナップショットを
> 渡す実験用で、新ジャズエンジンの学習・評価結果ではありません。
> [現在の設計](jazz-first-engine.ja.md)。

更新日: 2026-08-24

## 結論

Hooktheoryのページから取り入れるのは、個々の進行や数値ではなく「現在の文脈から次のコードを直接観測頻度と補間推定確率で順位付けし、定番度と意外性を分けて見せる」というUXと分析の考え方です。本実装はオフラインで完結し、Hooktheoryへの接続、スクレイピング、統計値のコピー、同サイトのデータによる学習は行いません。

McGill Billboard注釈を使った外部評価は、アプリのruntimeやtrainingとは別のローカル
評価です。[McGill Billboard外部評価レポート](mcgill-billboard-external-evaluation.ja.md)
では、3-gramが外部コーパス全体のdistributional fitとoverall Top-kを改善した一方、
section-boundary rankingは一様に改善しなかったことを記録しています。この結果から
音楽品質、聴感、UI候補器全体の改善は主張しません。

## 参照した考え方

- [Hooktheory Popular chord progressions](https://www.hooktheory.com/theorytab/popular-chord-progressions): 進行を局所的な遷移として見せ、頻出性を発見の入口にする考え方。
- [Hooktheory API Trends documentation](https://www.hooktheory.com/api/trends/docs): 文脈に続くイベントの傾向を条件付きで返すAPIの考え方。APIは認証、レート制限、提供範囲があり、アプリからは呼び出していません。
- [Hooktheory Terms of Service](https://www.hooktheory.com/terms) / [TheoryTab contributor documentation](https://www.hooktheory.com/support/tabs): 明示的許可のないスクレイピング、一括取得、再配布、モデルへの利用に制約があるため、実装のデータ境界をローカルPOP909に限定しました。
- POP909 Dataset（`models/harmony-corpus-v1.json`に記録された出典）: 既存アプリが追跡しているキー相対コードの経験則モデル。

URLは参照日現在のものです。Hooktheoryの文章・曲データ・分析値を長く引用せず、一般的な設計概念だけを採用しています。

## ローカル統計の出典と再現性

ブラウザ artifact は `scripts/build-browser-harmony-statistics.mjs` で生成します。

- source: POP909、909 songs / 1,131 tonal sequences / 93,904 tokens
- model: `harmony-corpus-ngram-v1`, source model version `local-corpus-v1`
- source SHA-256: `dfa28603b2aa0247abe5265a6975ae8267042a91e72e8c1ddd2221e2624209ae`
- browser orders: 1, 2, 3（元モデルの4、5-gramはブラウザへ持ち込まない）
- raw song data: bundled false

生成スクリプトはリポジトリ相対パスを解決し、モデルのschema、modelId、source、order連続性、countを検証します。出力はcanonical JSONを含むTypeScriptで、`pnpm stats:check` が生成物の鮮度を検証します。ファイルは一時兄弟ファイルからrenameして更新します。

## 確率モデル

Tokenはキーからの相対半音と品質（例: `0:major`、`9:minor`）です。候補は既存 `PROGRESSION_TEMPLATES` のactive mode対応stepだけに限定し、`createStepChordEvent`でmaterializeします。つまり統計が既存の楽典検証を上書きすることはありません。

1-gramはbackendと同じ加算平滑化です。

```text
P1(x) = (count(x) + 1) / (totalTokens + vocabularySize)
```

2、3-gramは文脈の観測数に応じて最大尤度と短いsuffix modelを再帰的に補間します。

```text
lambda = contextCount / (contextCount + vocabularySize)
P_n(x|c) = lambda * count(c,x)/contextCount
         + (1-lambda) * P_(n-1)(x|suffix(c))
```

未観測文脈は短いmodelへbackoffします。UIにはraw conditional probability（選択orderで実際に観測された直接観測頻度）と、直接観測に短い文脈・全体傾向を組み合わせたinterpolated probability（補間推定確率）を分けて、exact gram count、context count、order、`-log2(P)`のsurprisal bitsと併記します。countは曲数ではなく、同じ曲内の反復も含む出現回数です。909は曲の収録数であり、各確率の分母ではありません。確率は品質や正解率ではありません。

Profileは固定した安定sortを使います。

- familiar: probability降順
- balanced: 候補surprisalの中央値に近い順、同値ならprobability降順
- adventurous: 未観測gramを除外し、surprisal降順。候補自体はテンプレート由来で、ゼロ支持の任意和音は作らない

## 曲全体の指標

- geometric mean conditional probability: 対象chord列の**最初のコードを除く、同一key/mode内の各transition**の補間推定確率の幾何平均。1コード以下、または境界だけの範囲では未算出です。
- mean surprisal: 同じtransition集合に対する `-mean(log2(P))`。低いほどコーパス内で頻出だが、良いとは限りません。
- supported-transition rate: 同じtransition集合で、選択orderのexact gram countが正の割合。key/mode境界の組は統計遷移に含めません。
- complex-chord rate: `(extensions + non-diatonic + advanced qualities) / (3 × chord count)`。三つの軸を別々にも表示します。
- duration-weighted melody non-chord tension: 解析範囲でclipした旋律ノートを、重なっている各sounding chordの境界ごとに分割し、そのchordのpitch classに属さない区間のduration / active chordが存在する区間の総duration。解析範囲の前から開始して範囲内まで持続するchordもactiveとして含みます。
- actual-bass stepwise-motion rate: 連続chordの実際の最低音の差が2半音以内である割合。
- syncopation rate: **旋律**の範囲内 onsetだけを分母にし、拍頭（`ticksPerBeat`）以外にある割合。コードやベースのリズムはこの値に含めません。

zero chord、one chord、empty melodyは0または安全な既定値を返し、NaN/Infinityを返しません。

## Provider境界

`HarmonyStatisticsProvider` は `probability(tokens)` と `provenance` の小さな契約です。現在の実装は `LocalCorpusHarmonyProvider` のみです。将来、利用許諾を得たデータ源を追加する場合でも、providerを差し替えるだけでUIと分析契約を共有できます。Hooktheory providerは実装・表示していません。

## UXと安全な適用

統計タブは現在の解析範囲を表示し、定番／バランス／意外をキーボード操作可能なpressed buttonで選びます。試聴はpreviewのみです。適用対象は明示的に選択した**1コード**だけで、選択コードの開始tick・長さを維持します。selectionがない場合は曲末尾の継続候補を試聴できますが、適用はChord Laneでコードを選ぶまで無効です。locked tick範囲、Storeのno-op、失敗には通知を返します。候補は自動的に正式データへ上書きしません。

## バイアスと限界

POP909は特定の公開コーパスであり、J-pop寄りの収録傾向、転記・キー推定・コード品質ラベルの偏りを持ちます。頻度の低さは悪さではなく、頻度の高さは普遍性や創造性ではありません。統計はroot+qualityの発生だけを順位付けし、voicing、tension、inversion、セクション間の滑らかさは学習済みとはみなしません。key/mode境界で統計contextをリセットし、境界の滑らかさは既存の理論validator、voice-leading、melody tension、bass metricsに任せます。

## テスト計画

`frontend/tests/music.statisticalHarmony.test.ts` はartifact provenance、backend補間fixture、invalid snapshotのfail-closed、空入力のfinite性、profileの決定性、mode-safe materialization、unigram根拠、adventurousのsupport条件、key/mode境界、指標を確認します。UIでは統計タブの表示、profile pressed state、試聴、選択なしの適用無効化、locked tick範囲の理由、1コードへの明示的適用とtoastを回帰対象にします。生成artifactは `pnpm stats:check` または `npm run stats:check`、通常の型検査・lint・build・全testは `pnpm check` または `npm run check` から実行します。
