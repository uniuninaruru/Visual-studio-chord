# セクション自動接続のハイブリッドPareto順位付け

状態：**実装済み設計**。対象は、同じKey / Scaleを結ぶ`Auto`接続で挿入する1コードの
選択だけです。理論上不正な候補を統計で採用したり、強制`Direct` / `Dominant` /
`Pivot`の意味を変更したりはしません。

## 選択の流れ

1. 既存の`transitionsInto`が作る理論上有効な候補から、現在のstyle profileのweightが
   正で、かつoutgoing chordとrootが異なるものだけを残します。
2. 各候補を、コーパス、4声voice-leading、style priorの独立した観点で評価します。
3. 他候補にすべての観点で劣る候補を除き、Pareto frontierを作ります。
4. frontier内だけで、既存のstyle weightを使ったseed付き選択を行います。seedは同等に
   残った案の多様性にだけ使い、支配された候補を復活させません。

候補を1個の恣意的な加重点へ畳まないため、頻度、声部進行、styleのどれか1つだけで
結果を決めません。

## 3つの評価観点

### POP909の局所的な条件付き証拠

outgoing、candidate、incomingを、**接続先のtonicに相対化したroot+quality token**へ
変換します。voicing、tension、inversionはtokenに含めません。既存のローカル
`HarmonyStatisticsProvider`へ次の2回だけ問い合わせます。

- `P(candidate | outgoing)`：2-gram
- `P(incoming | outgoing, candidate)`：3-gram

2遷移の平均サプライズは

`S = (-log2 P(candidate | outgoing) - log2 P(incoming | outgoing, candidate)) / 2`

です。低いほど、このPOP909モデルでは頻出です。加えて、各問い合わせで
`orderUsed >= 2 && exactGramCount > 0`となる遷移数を`0..2`で記録します。Pareto比較では、
観測済み遷移数は多いほど、平均サプライズは低いほど良い、と別々に扱います。

### 既存の4声voice-leading

`outgoing -> candidate -> incoming`の3コードを、同じstyleと接続先Key / Modeで既存の
`revoiceInFourParts(..., optimizeSequence: true)`へ渡します。その結果に既存の
voice-leading scorerを2遷移分適用し、合計costを記録します。新しい音高距離や簡易な
common-tone点は導入しません。costは低いほど良い値です。

### Style prior

候補のtransition techniqueに対する現在のprofile weightを、そのまま使います。
Pareto比較とfrontier内のseed付きweighted choiceの両方で、大きいほど優先されます。

## Pareto dominance

候補Aが候補Bを支配するのは、使用中の全観点でAがB以上であり、少なくとも1観点で
厳密に良い場合だけです。

- corpus：観測済み遷移数が多いか等しく、平均サプライズが低いか等しい
- voice-leading：合計costが低いか等しい
- style：profile weightが高いか等しい

支配されない候補だけがfrontierに残ります。

## Fail-closedなcorpus fallback

providerが利用できない、例外を投げる、有限でない値を返す、確率が`(0, 1]`外、または
count / orderが不正な場合は、**全候補についてcorpus観点を外します**。正常な候補だけ
corpusを使う混在比較はしません。fallback時も、理論上有効な候補、既存4声cost、style
priorによるPareto選択は続き、アプリは例外を外へ出しません。説明文にはcorpus fallback
であることを残します。
providerの生成はboundaryがrankerへ到達するまで遅延します。他のbundle済みfrontend
moduleと同様、module自体のload / syntax失敗はアプリの起動を妨げるため、このruntime
fallbackの対象外です。

通常時の説明文には、自動候補数、frontier数、hybrid / fallback、選ばれた候補の
corpus support、平均サプライズ、4声costを追記します。これにより、選択理由を保存後も
監査できます。

## 変更しない契約

- transition挿入率のhash、threshold、seed導出は既存のままです。
- outgoing chordがすでにincomingへのdominantを準備している場合、`Auto`は`null`を返します。
- 強制`Direct` / `Dominant` / `Pivot`はこのrankerを通りません。
- 既存のhalf-chord挿入、tick coverage、event ID、timelineは変更しません。
- 同じ入力とseedは同じ結果になります。`Math.random()`は使いません。

## 根拠と主張の境界

- Tymoczkoは、コード間の音対応を幾何学的に表し、短いvoice-leadingが多様な様式で
  利用されることを論じています。本実装はそのorbifold modelを実装したものではなく、
  既存の実音域付き4声optimizerだけを使います。
- Rohrmeierは、調性和声の構造が単純なMarkov遷移表を超え、階層的・再帰的に記述される
  ことを論じています。従って、この局所2-step rankerを完全な和声文法とは呼びません。
- Korzeniowski、Sears、Widmerは、chord predictionにおけるn-gramとより長い文脈を扱う
  language modelを比較しています。本実装は生成文法やsong-adaptive RNNではなく、
  追跡済みPOP909 3-gramから局所的な証拠だけを取得します。
- Pauwels、Kaiser、Peetersは、構造境界の位置によってkey-relative chord-pair分布が
  異なること、和声と別種の証拠を組み合わせる意義を示しています。本実装は同論文の
  audio segmentation、HMM、novelty featureを再現しません。
- リポジトリの[McGill Billboard外部評価](mcgill-billboard-external-evaluation.ja.md)では、
  3-gramはoverall NLL / Top-kを改善しましたが、section-boundary rankingは一様には
  改善しませんでした。この結果を受け、corpus単独順位ではなくParetoの1観点に限定します。
  McGill annotationsはruntimeにもtrainingにも入りません。

このrankerだけを根拠に、完全な階層和声文法、聴感や音楽品質の改善、McGillデータの
runtime利用、またはすべてのsection boundaryでの改善を主張しません。聴感品質は今後の
blind listening testが必要です。

## 参考文献

- Dmitri Tymoczko, “The Geometry of Musical Chords,” *Science* 313 (2006), 72–74. [DOI](https://doi.org/10.1126/science.1126287)
- Martin Rohrmeier, “Towards a Generative Syntax of Tonal Harmony,” *Journal of Mathematics and Music* 5 (2011), 35–53. [DOI](https://doi.org/10.1080/17459737.2011.573676)
- Filip Korzeniowski, David R. W. Sears, and Gerhard Widmer, “A Large-Scale Study of Language Models for Chord Prediction” (2018). [arXiv:1804.01849](https://arxiv.org/abs/1804.01849)
- Johan Pauwels, Florian Kaiser, and Geoffroy Peeters, “Combining Harmony-Based and Novelty-Based Approaches for Structural Segmentation,” *ISMIR* (2013). [paper](https://archives.ismir.net/ismir2013/paper/000138.pdf)
