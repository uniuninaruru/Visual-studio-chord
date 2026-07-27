# ニューラル和声生成：先行研究・最先端比較

**日本語** | [English](neural-harmonization-sota.en.md)

最終調査日: 2026-07-27

対象: 記号音楽における旋律からのコード生成、制約付き和声付け、
ローカルCUDAおよびApple Metal/MPS実行

この資料は実装判断の記録である。各研究はタスク、データセット、
tokenization、評価方法が異なるため、すべてを同一条件の順位表として扱わない。

## 1. 直接関連する研究

| 研究 | タスク／構造 | このアプリに有用な成果 | そのまま採用できない理由 | 判断 |
| --- | --- | --- | --- | --- |
| DeepBach（Hadjeres et al., 2017） | 位置制約を与えられる疑似Gibbs生成によるバッハ4声コラール | 固定音を残したまま周囲を補完する操作を実証 | コラール領域、固定4声、可変和声リズムのリードシートではない | 制約付き生成のbaselineとして残し、本番モデルは移植しない |
| AutoHarmonizer（Wu et al., 2021/2024） | 16分音符frame単位のRNN旋律→コード生成、和声密度制御、大規模なflatコード語彙 | 和声変化位置を固定せず、旋律リズムと一緒に生成 | 古いKeras/TensorFlow、flat語彙、長期構造と部分補完が弱い | 主要な歴史的baselineとして再現する |
| DeepChoir（Wu et al., 2022/2023） | 旋律とコード進行を条件に4声コラールを生成するTransformer | コードtokenで多声部和声を制御できる | 必要なコード計画そのものではなく、与えたコードから声部を生成する | 将来のvoicing／arrangement学習に限定して参照 |
| ReaLchords（Wu et al., ICML 2024） | online自己回帰伴奏、未来を見られるoffline teacher、知識蒸留、reward modelとRL | リアルタイム性、未知入力への回復、時間的協調を扱う | editorでは未来旋律が既知なのでpast-onlyは不利。RLは報酬の抜け穴を生む | 後段のlive modeでteacher→causal student蒸留を検討 |
| 非微分規則誘導拡散／SCG（Huang et al., ICML 2024） | forward評価だけで規則を使える記号音楽latent diffusion | 既存の非微分規則を勾配なしでsamplingへ利用 | 対象が広いpiano-roll生成で、反復推論コストも高い | masked baseline完成後の追加sampling方式として比較 |
| MelodyT5（Wu et al., 2024） | ABCによるencoder-decoder型multi-task score-to-score Transformer。261,900旋律、100万超のtask instance | データの少ない記号音楽taskでmulti-task transferが有効 | ABC／task表現がtick・chord schemaと異なり、データ権利と変換も複雑 | phase 1では使わず、後のpretraining候補 |
| EMO-Harmonizer（Huang and Yang, 2024） | key-awareな機能表現とTransformerによる感情条件付き和声付け | 調性を保ったままemotionを制御 | 感情labelと旋律変形は別課題で、最初の正確性bottleneckではない | key-relative表現だけ参照し、emotion headは延期 |
| B*制約decode（Kaliakatsos-Papakostas et al., 2025） | beam、A*、backtrackingを組み合わせ、指定位置へ指定コードを強制 | 将来位置の固定コードを自己回帰モデルに守らせる難しさを明示 | 最悪時は指数計算量のbrute force | lock厳守の比較対象とし、直接mask条件付けを優先 |
| Encoder-Only Transformers for Melodic Harmonization（Kaliakatsos-Papakostas et al., PMLR 2026） | 同期した旋律／和声time grid上の非自己回帰single encoder | 少ないparameterでdual encoderを上回り、任意位置のコード固定に対応 | 公開設定は本アプリのquality、section、style、可変和声リズムより狭い | 第一の構造的出発点として採用 |
| Curriculum Masking / Pay (Cross) Attention to the Melody（Kaliakatsos-Papakostas et al., 2026 preprint） | single encoder向けfull-to-full mask curriculum | 序盤に和声全体を隠すことで旋律利用と領域外性能を強めると報告 | 新しいpreprintであり、同じ効果を仮定できない | full-mask curriculumを事前定義したablationにする |
| HarmonyTok（Kaliakatsos-Papakostas et al., Information 2025） | full symbol、root/quality、pitch-class set、root-aware表現を比較 | 万能表現はなく、spelling系はrhythm/alignment、chunky tokenはstyle再現に強い | 本アプリの豊富なコードschemaを直接評価していない | factorized headとfull-symbolを比較後にschema確定 |
| Function Alignment（Jiang et al., 2025 preprint） | pretrained symbolic LM間を軽量adapterで結びmusic-to-music taskへ転用 | chord認識・旋律・drum生成をparameter効率よく転用 | 互換pretrained LMと表現が必要 | 直接harmonizer baseline完成後の実験 |

## 2. 現在の用途に最も適合する方式

任意の小節をlockし、前後を保ったまま編集するoffline editorには、
2026年のencoder-only・非自己回帰方式が自己回帰モデルより適している。

- 旋律全体を参照できる。
- 任意位置のコードを固定できる。
- 選択範囲だけmaskして再生成できる。
- 全曲生成と部分再生成を同じ操作で扱える。
- 同期time gridが現在のtick基準UIと一致する。

そのためphase 1は、LSTM、GAN、audio model、decoder-only LLMではなく、
**single-encoder masked Transformer**とする。

ただし、これは先行研究から導いた仮説であり、このリポジトリ上での結果ではない。
同じsplitと評価条件でbaselineを上回るまで採用確定とはしない。

## 3. 実装へ取り込む要素

| 要件 | 根拠 | 実装予定 |
| --- | --- | --- |
| 可変コード変化 | AutoHarmonizer | `HOLD`／`CHANGE`を持つ16分音符frame |
| 未来旋律の参照 | encoder-only harmonization | 双方向single encoder |
| 部分再生成 | DeepBach、encoder-only harmonization | 任意harmony maskと変更不能lock token |
| 旋律依存の強化 | full-to-full curriculum | full-maskとrange-maskの学習schedule |
| 検査可能なコード出力 | HarmonyTokと既存schema | event/root/quality/inversion/bass/extensionsを分離 |
| ハード理論規則 | SCGと既存validator | logit mask、完成候補reject、任意のforward rule guidance |
| live mode | ReaLchords | 後にoffline teacherからcausal studentへ蒸留 |
| 少量dataの転用 | MelodyT5、Function Alignment | 後にmulti-task/pretrained adapter比較 |
| user control | AutoHarmonizer、B* | density、固定コード位置、edit mask |

すべてを最初から同時投入しない。RL、diffusion、multi-task pretraining、
live distillationを一度に入れると、何が改善・悪化したか分離できない。

## 4. Tokenizationの判断

本番schemaはmajor/minor triadだけでなく、借用和音、適用属和音、転回形、
slash bass、sus、extensionを扱う。1コード＝1 flat classには問題がある。

1. 語彙が膨張し、rare classが学習できない。
2. 学習dataにないが理論的に正しい組合せを出せない。

初期候補は以下のfactorized predictionとする。

```text
event × root × quality × inversion × bass × extensions
```

ただし、次を同条件で比較するまでは確定しない。

- full chord-symbol token
- root＋quality token
- pitch-class-set token
- factorized multi-head

評価項目:

- exact chord accuracy
- pitch-class-set F1
- calibration
- invalid combination率
- rare-chord recall
- human preference

## 5. 制約統合方式の比較

| 方式 | 長所 | 危険 | 段階 |
| --- | --- | --- | --- |
| lock済みコードtokenを条件入力 | masked modelでは自然で効率的 | 周囲の解決まで正しいとは限らない | 本番baseline |
| 不可能なfactor組合せをmask | sampling前にschema errorを排除 | 長距離の和声法は表現できない | 本番baseline |
| 完成候補を全validatorへ通す | 既存の監査済みengineを再利用 | reject率が高いとsampleを浪費 | 本番baseline |
| 無効候補をrepair | 良い素材を回収できる | 学習分布から外れる可能性 | preview限定実験 |
| B*／backtracking | 位置制約を厳密に満たせる | 最悪指数時間 | benchmark |
| SCG型forward rule guidance | 非微分規則をsampling途中で利用 | 規則の反復評価と複雑性 | 研究ablation |
| differentiable theory loss | inferenceが速い | 不完全なproxyをmodelが攻略する | 独立検証まで不採用 |

最初は「条件付け＋schema mask＋最終validator reject」を使う。
SCG型は、許容latency内でacceptanceとlistening scoreが改善した場合だけ昇格する。

## 6. データ

### POP909

909曲について旋律、伴奏、beat、key、chordが整列しており、現在のaggregate
n-gram modelにも使用している。最初のsupervised harmonization dataとする。

利用法:

- window作成前にsong単位でtrain/validation/test分割
- key-relative転調augmentation
- 16分frameで旋律／和声を整列
- 転調を区間として保持
- raw songをGitへ含めない

危険:

- pop一種類のcorpusでは、jazz、古典対位法、game music、
  非西洋調性への一般化を主張できない。

### ChoCo

20,000超の異種和声annotationを標準化しており、harmony-only pretrainingと
分布分析に向く。ただしsource subsetごとにlicenseが異なるため、
ChoCo全体を一括許諾とみなさずallowlistを作る。

利用法:

- chord-language pretraining
- style／domain held-out評価
- vocabulary coverage分析

限界:

- symbolic melodyと整列しないrecordが多く、primary melody-conditioned
  objectiveを単独では学習できない。

### Wikifonia／AutoHarmonizer

artifactと再配布権を個別確認した上でbaseline再現に限定する。
POP909へ黙って混ぜ、「open model」とは呼ばない。

### User project

local feedbackとprojectは既定でprivate。明示opt-in後にpersonal adapterへ
利用できるが、通常利用でglobal corpusへuploadしない。

## 7. 先行研究から採る評価

ReaLchordsは次を評価している。

- note-in-chord ratio
- chord-to-note onsetの時間整合を分布距離で測定
- chord duration entropy
- listening comparison

これらは部分指標として採用するが、音楽品質の完全な定義とはしない。
note-in-chordだけを最大化すると無難なコードを過大評価し、正当な非和声音を
不当に罰する。

追加評価:

- cadenceとapplied dominantの解決
- rule別hard violation vector
- function transition分布
- voice-leading分布
- noveltyとnearest-training-neighbor
- 統制A/B試聴でmelody fit、自然さ、方向感、rhythm fit、総合preference
- CUDA/MPS間の一致

## 8. CUDAとMetal/MPSの現状

### CUDA

PyTorch CUDAはdevice-agnostic code、mixed precision、複数attention kernel、
DistributedDataParallelを提供する。再現可能modeではdeterministic algorithmと
SDPA backendを明示する必要があり、fused attentionはbackwardや浮動小数の
加算順序が異なる場合がある。

実装への影響:

- canonicalなlarge trainingはCUDAで実施
- PyTorch、CUDA、driver、GPU、dtype、SDPA backend、seed、checkpointを記録
- FP32 referenceを保持
- deterministic research runと高速production runを分離

### Metal/MPS

PyTorchは`mps` deviceをMPS GraphとMetal最適化kernelへ対応付ける。
AppleとPyTorchの双方がruntimeでの実availability確認を要求している。
MPSにはallocator診断とunsupported operationのCPU fallbackがある。

実装への影響:

- まず標準Transformer／SDPA operationだけで構成
- FP32 parity確認後にFP16を検証
- operation fallbackをすべて報告し、黙って「Metal実行」と表示しない
- 容量を製品制約にしない場合でもallocatorの安全limitは無効化しない
- CUDAと同じcheckpoint／tokenizerを使用

## 9. 推奨実装順

1. POP909 data compiler、split／deduplication report、tokenization比較。
2. AutoHarmonizer再現と、parameter数を合わせたcausal Transformer baseline。
3. 同期旋律／和声gridのsingle-encoder masked Transformer。
4. full-mask curriculumとrandom-maskのablation。
5. factorized tokenとfull-symbol tokenのablation。
6. immutable lock条件と既存validator reject。
7. CUDA mixed-precision trainingとdeterministic reference。
8. MPS FP32／FP16 inference、operation coverage、cross-device比較。
9. 任意のSCG型stepwise rule guidance。
10. 任意のReaLchords型causal studentによるlive accompaniment。

1〜8のbaselineを確立する前に、larger model、RL、diffusionから始めない。

## 10. 一次資料

- DeepBach:
  <https://proceedings.mlr.press/v70/hadjeres17a.html>
- AutoHarmonizer:
  <https://arxiv.org/abs/2112.11122>
- DeepChoir:
  <https://arxiv.org/abs/2202.08423>
- ReaLchords:
  <https://proceedings.mlr.press/v235/wu24c.html>
- Symbolic Music Generation with Non-Differentiable Rule Guided Diffusion:
  <https://proceedings.mlr.press/v235/huang24g.html>
- MelodyT5:
  <https://arxiv.org/abs/2407.02277>
- Emotion-Driven Melody Harmonization:
  <https://arxiv.org/abs/2407.20176>
- Incorporating Structure and Chord Constraints:
  <https://arxiv.org/abs/2512.07627>
- Encoder-Only Transformers for Melodic Harmonization:
  <https://proceedings.mlr.press/v303/kaliakatsos-papakostas26a.html>
- Pay (Cross) Attention to the Melody:
  <https://arxiv.org/abs/2601.16150>
- HarmonyTok:
  <https://doi.org/10.3390/info16090759>
- Function Alignment:
  <https://arxiv.org/abs/2506.15548>
- POP909:
  <https://archives.ismir.net/ismir2020/paper/000089.pdf>
- ChoCo:
  <https://doi.org/10.1038/s41597-023-02410-w>
- PyTorch CUDA semantics:
  <https://docs.pytorch.org/docs/stable/notes/cuda.html>
- PyTorch reproducibility:
  <https://docs.pytorch.org/docs/stable/notes/randomness.html>
- PyTorch MPS backend:
  <https://docs.pytorch.org/docs/stable/notes/mps.html>
- Apple accelerated PyTorch training on Mac:
  <https://developer.apple.com/metal/pytorch/>
