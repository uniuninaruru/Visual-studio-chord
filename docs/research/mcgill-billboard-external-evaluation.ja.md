# McGill Billboard外部評価レポート

更新日: 2026-08-25

## 目的と範囲

このレポートは、追跡済みの統計コード言語モデルを、アプリが通常使わない
外部コーパスでローカル評価した結果を記録します。McGill Billboard annotationsは
runtimeやtrainingへ投入せず、評価を実行するPCにだけ取得します。評価の結果は、
コーパス上の次トークン予測の挙動を測るものであり、アプリの音楽品質を測るものでは
ありません。

公式の入口は [The McGill Billboard Project (Chord Analysis Dataset)](https://ddmal.ca/research/The_McGill_Billboard_Project_%28Chord_Analysis_Dataset%29/) です。
公式ページの説明では、注釈はCC0として提供され、890 slots / 740 distinct songsを
含みます。raw audioは配布されず、注釈はSALAMI形式です。ここでは公式ページの
説明を参照するだけで、権利状態について追加の法的判断は行いません。

## 取得と再現

取得URLは `scripts/fetch-mcgill-billboard.py` に固定しています。raw datasetは
Gitで追跡しません。次のコマンドはrepo rootから実行します。fetchは初回取得時だけ
実行し、すでに取得済みならfetchを飛ばしてevaluateだけを再実行します。既存の
nonempty targetを上書きしないため、同じfetchを2回実行すると意図的に失敗します。
POSIX環境では次の順に実行します。

```bash
python3 scripts/fetch-mcgill-billboard.py
python3 scripts/evaluate-mcgill-billboard.py \
  --output docs/research/evaluations/mcgill-billboard-v2-harmony-language-model-v1.json
```

Windows PowerShellでは次のように実行します。

```powershell
python .\scripts\fetch-mcgill-billboard.py
python .\scripts\evaluate-mcgill-billboard.py `
  --output .\docs\research\evaluations\mcgill-billboard-v2-harmony-language-model-v1.json
```

評価JSONは集計値だけを保存するtracked aggregate evaluation report（集計評価JSON）です。
[追跡済みmachine-readable評価JSON](evaluations/mcgill-billboard-v2-harmony-language-model-v1.json)へ到達できます。
raw dataset、曲名、アーティスト、絶対パス、個別sequenceを文書や追跡JSONへ書き出しません。取得物を
残す場合も、ローカルの外部評価用ディレクトリに限定してください。

## 入力の同一性

評価に使った入力と中間結果は、`parserVersion: mcgill-salami-v2-normalizer-1` と
次の5つのSHA-256で固定します。

| 対象 | SHA-256 |
| --- | --- |
| source archive | `a22e32bf24c8a18859ce18427c6501a7a72520185cddd6d882ceb3c61d02ec75` |
| portable tree | `312a0e6478ca018aef44291e799434cc2096c0ea4a0e2568ef0ac90020ebb503` |
| tracked aggregate model | `dfa28603b2aa0247abe5265a6975ae8267042a91e72e8c1ddd2221e2624209ae` |
| normalized evaluation input | `f0ceb26872322f3e867d0d6ba9c4523c0bd057efed9799769a6208993cc21fdb` |
| canonical tokenizer script (strict UTF-8 + LF) | `b524df19323c5fbc28c30e90960a8dec3d17e0d7b2e22c774647693fd947a28d` |

## 正規化プロトコル

`parserVersion: mcgill-salami-v2-normalizer-1` は、既存の
`scripts/train-harmony-corpus.py` をstrict UTF-8として読み、CRLFと単独CRをLFへ
canonicalizeしたsnapshot tokenizerを、hashとcompile/execの両方に使います。正規化は次の
境界を固定します。

- rootはtonicからの相対半音にし、slash bassはtoken化に使いません。extensionsは既存のquality classへ正規化します。
- 隣接する同一tokenをcollapseし、`.`はphrase-localに直前tokenを展開し、公式の`xN` repeatを展開します。elision markerは件数を数えた後に除去します。
- `N`、`*`、`&pause`、`Z`、`silence`、`end`、unknown quality、missing tonic、key changeではcontextをresetします。meter changeではcontextを切りません。
- timestamp、rhythm、durationはこの評価の指標に使いません。

したがって、ここで測るのはcontext-contiguousな正規化token列のdistributional fitです。
SALAMIの時間位置や音楽的なリズム・持続時間、slash-bass inversion / bass-note identity
（転回形・ベース音同一性）は評価対象ではありません。

## コーパスと正規化の集計

この評価で保存するのは次の集計値だけです。

| 集計項目 | 件数 |
| --- | ---: |
| annotations | 890 |
| musical phrases | 23,392 |
| expanded bars | 91,343 |
| normalized raw lexemes | 122,314 |
| unsupported lexemes | 5,668 |
| collapsed tokens | 82,294 |
| sequences | 2,487 |
| transitions | 79,807 |
| section-boundary transitions | 5,160 |

OOVは `191 / 79,807 = 0.2393%` です。OOVの分母は全transitionであり、曲数や
annotation数ではありません。候補集合はmodel unigramの全106語で、UIのtemplate
advisor subsetではありません。従ってこの結果を、そのまま画面上の候補順位の評価と
読み替えません。

## Overallの結果

次表のNLLはbits、PPLはperplexity、Top-kは正解tokenが上位k候補に入った割合です。
同じ外部評価入力に対するorder 1〜3の比較であり、学習済みモデルの品質評価や
聴感評価ではありません。

| order | NLL (bits) | PPL | Top-1 | Top-3 | Top-5 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 4.7870988083 | 27.6096 | 0.2006967 | 0.3369003 | 0.5536231 |
| 2 | 4.2734057583 | 19.3385 | 0.2289774 | 0.5168344 | 0.6025787 |
| 3 | 4.1642300235 | 17.9291 | 0.2593131 | 0.5211824 | 0.6496924 |

order 3はorder 2に対して、NLLが0.1091757 bits低く、Top-1が0.0303357、
Top-3が0.0043480、Top-5が0.0471137高くなりました。order 1との比較では、
NLLが0.6228688 bits低く、Top-1が0.0586164、Top-3が0.1842821、Top-5が
0.0960693高くなりました。これは、McGill Billboardのこの集計入力に対する
distributional fitとoverall Top-kがorder 3で改善した、という限定的な結果です。

## SectionBoundaryの厳密な定義

McGill公式仕様に従い、ここでいうsectionBoundaryは一般的な「セクションらしい
境目」の推測ではありません。大文字と、任意のprimeを続けたmarker（`A`、`B'`など）が
高水準構造segmentの開始を示します。評価のsectionBoundaryは、そのmarkerを持つ
phraseの最初の有効tokenと、その直前contextとのtransitionです。`Z`は非音楽として
扱い、contextをresetします。plain-textのfunction labelだけではformal boundary
sliceに含めません。

## Section boundaryの結果

section boundary transitionだけを分けると、Top-1は次の通りです。

| order | boundary Top-1 |
| ---: | ---: |
| 1 | 0.4040698 |
| 2 | 0.3288760 |
| 3 | 0.3381783 |

order 3のboundary Top-1はorder 1より0.0658915低く、order 2より0.0093020高い
ものの、order 1を上回りません。追加の比較では、order 3のboundary NLLはorder 1
より0.523604 bits、order 2より0.0221492 bits低く、boundary Top-3はorder 2より
0.0102713低くなりました。従って、3-gramがsection boundary rankingを一様に
改善したとは言えません。セクション接続はこの評価で残った弱点です。

## 結論と未評価事項

この外部評価から言えるのは、3-gramが外部コーパス全体のdistributional fitと
overall Top-kを改善したこと、そしてsection-boundary rankingの改善は一様でない
ことだけです。これを根拠に、音楽品質、聴感、UI候補器全体、voicing、melody、
rhythm、audioの改善を主張しません。

- McGill Billboardは1958–1991年の米国Billboardを中心とするコーパスであり、全商用音楽の代表ではありません。
- 評価はmodel unigram全106語を候補にしており、UI template advisor subset、melody、voicing、rhythm、audio、listeningを評価していません。
- tracked aggregate modelにはsong IDがないため、POP909との曲同一性を完全に排除できたとは証明しません。
- raw dataset、曲名、アーティスト、絶対パス、個別sequenceは、文書と追跡JSONに含めません。

この結果は、外部コーパスに対する限定的な言語モデル評価です。アプリのruntimeと
trainingのデータ境界、または将来の音楽的評価を置き換えるものではありません。

## 参考文献

- [The McGill Billboard Project (Chord Analysis Dataset)](https://ddmal.ca/research/The_McGill_Billboard_Project_%28Chord_Analysis_Dataset%29/): 公式データセット説明とannotation仕様。
- Burgoyne, J. A., Wild, J., & Fujinaga, I. (2011), ISMIR 2011 paper: 1958–1991 samplingとコーパス説明。[paper](https://ismir2011.ismir.net/papers/OS8-1.pdf)
- de Haas, W. B., & Burgoyne, J. A. (2012), parser report: SALAMI annotationのparser説明。[report](https://ics-archive.science.uu.nl/research/techreps/repo/CS-2012/2012-018.pdf)
- Harte, C. et al. (2005), chord syntax paper: chord symbol syntaxの根拠。[paper](https://ismir2005.ismir.net/proceedings/1080.pdf)
