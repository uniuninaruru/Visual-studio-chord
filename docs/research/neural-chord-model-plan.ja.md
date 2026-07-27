# HarmonyForge ニューラルコード生成モデル実装計画

**日本語** | [English](neural-chord-model-plan.en.md)

状態: 実装に進むための設計を確定。測定・学習は未実施

対象リリース: 0.4.xで研究プレビュー、聴取実験合格後のみ1.0

実行対象: NVIDIA CUDA、Apple Metal（PyTorch MPS）、CPUフォールバック

解釈上の注記: ここでは「Meta環境」をApple Metal/MPSとして扱う。Meta AIの
ハードウェアやAudioCraftを意味する場合は別の設計対象である。

## 1. 採用する方針

デバイスに依存しないPyTorchモデルを1つ作り、重み形式も1つにする。
「CUDA用モデル」と「Metal用モデル」を別々に学習しない。アダプターが
カーネル、精度、バッチ、メモリ方針だけを選ぶ。

```text
同一tokenizer + 同一architecture + 同一checkpoint
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
       CUDA adapter   MPS adapter   CPU adapter
       BF16 / FP16    FP16 / FP32   FP32 / BF16
```

モデルは旋律と曲構造を条件に、可変ハーモニックリズムのコード列を提案する。
既存の決定論的理論エンジンは、終止、適用和音の解決、プロジェクト保護、
ボイシング、最終検証の権限を維持する。

採用順位は必ず次の順序にする。

1. ユーザーがロックした内容とプロジェクトschema
2. ハード理論制約
3. ニューラル条件付き尤度
4. 経験コーパス尤度
5. 明示的なユーザー選好
6. seedによる最終同率判定

学習済みスコアによってハード制約違反を合法化してはならない。

## 2. 研究課題

単一の双方向ニューラルハーモナイザーで、次を同時に満たせるかを検証する。

- 過去だけでなく表示中の旋律全体を利用する
- コード内容とコード変化位置の両方を生成する
- 曲全体を作り直さず、選択した小節だけをinpaintする
- ロック済みコードとセクション境界を保存する
- 決定論的エンジンと既存POP909 n-gram rankerより適合度と多様性を改善する
- CUDAとMPSで、宣言済み許容範囲内の同等な音楽判断を得る
- どちらのアクセラレーターがなくても利用を継続できる

## 3. モデル系統の選定

### 3.1 採用

- **16分音符単位のハーモニックフレーム**: AutoHarmonizerに倣い、
  1小節1コードへ固定せずコード変化位置自体をモデル化する。
- **双方向masked harmonization**: 曲全体の生成と部分再生成の両方で右側文脈を使う。
  5〜8小節だけを変更し、1〜4・9〜16小節を固定する用途には、
  decoder-onlyの次token予測より適合する。
- **full-to-full masking curriculum**: 学習バッチの一部では和声を全て隠し、
  過去コードだけで解いて旋律を無視する近道を防ぐ。
- **factorized chord heads**: 1,462クラスの平坦な語彙へまとめず、
  root、quality、inversion、bass、extensionsを分離する。
- **forward-only rule evaluation**: stochastic control guidanceを参考に、
  非微分可能validatorを微分可能に書き換えず候補誘導・拒否へ使う。
- **offline teacher distillation**: ReaLchordsを参考に将来の低遅延モードへ使う。
  最初は前後文脈を参照できるoffline/bidirectional型とする。

### 3.2 主経路に採用しない

- MusicGenのようなaudio-tokenモデル: symbolic note、tick、chord、trackの
  編集可能性が失われる。
- DeepBachの直接流用: 制約付き生成は重要だが、コラール領域と4声出力は
  可変リズムのlead-sheet和声と一致しない。
- 未学習MLPを「AI」と表示: runtime試験であり経験的音楽モデルではない。
- phase 1での強化学習: rewardの設計ミスを避け、masked supervised learningと
  人間評価を先に行う。
- CUDA/MPS別checkpoint: モデル品質とデバイス固有学習が混ざり検証量も倍になる。

## 4. タスク定義

### 4.1 入力

| Stream | Fields |
| --- | --- |
| Melody | onset tick、duration tick、key-relative pitch class、octave、velocity bin、role、tie |
| Meter | PPQ、time signature、bar、beat、sixteenth slot、metrical strength |
| Tonality | active key、mode、section modulation、任意のmelody mode |
| Form | section kind、phrase boundary、cadence target、loop boundary |
| Controls | style、mood、harmonic density、complexity、exploration、contour |
| Existing harmony | ロック済みchord factors。その他はmask |
| Edit mask | 各slotをgenerate、preserve、condition-onlyに指定 |

すべての音楽位置はinteger tickで扱う。学習データは量子化前にアプリと同じ
PPQ契約へ変換する。

### 4.2 出力

| Head | Vocabulary |
| --- | --- |
| Event | `NO_CHORD`、`HOLD`、`CHANGE` |
| Root | key-relativeな12半音クラス |
| Quality | 現在の`ChordQuality`語彙と`OTHER` |
| Inversion | root、1st、2nd、3rd、other |
| Bass | root-relativeな12 pitch classesと`ROOT` |
| Extensions | multi-labelの6、7、9、11、13と対応alterations |
| Function補助 | tonic、predominant、dominant、other |
| Cadence補助 | none、authentic、plagal、half、deceptive、loop |

`HOLD`により16分音符ごとに完全なコードラベルを反復しない。コード因子は
`CHANGE`でだけ学習し、長いコードがlossを過剰に支配するのを防ぐ。

### 4.3 正式データへの変換

ニューラル出力は`GeneratedComposition`へ直接書き込まない。

```text
model factors
  → 型付きNeuralHarmonyCandidate
  → token/schema検証
  → chord構築
  → 既存progression検証
  → voicing + melody/全track検証
  → preview candidate
  → ユーザーが明示的にApply
```

不正または中断された候補は、候補全体を単位として破棄する。

## 5. アーキテクチャ

仮称: **HarmonyForge-BiMask**

### 5.1 基本モデル

- single-encoder Transformer
- 旋律と和声を時間整列し、別stream typeのtokenとして表す
- stream、bar、beat、section、edit-mask embedding
- PyTorch SDPA対応範囲でrotaryまたはrelative positional attention
- 12 layers、hidden 768、12 attention heads、FFN 3072
- pre-norm、GELUまたはSiLU、dropout 0.1
- v1は最大128小節。超える曲はsection単位windowで処理
- 最終hidden stateを共有するfactorized output heads
- 目標約100〜130M parameters。実装moduleから実測する

24 layers・hidden 1024の大型variantはbaseがbaselineに勝った後だけ試す。
大きさ自体は和声品質の証拠ではない。

### 5.2 階層的文脈

各小節にsummary tokenを置く。局所フレームは次へattentionする。

1. 同じ小節と隣接小節の全melody tokens
2. 選択section内の全bar summary tokens
3. generation window内の全locked harmony tokens

dense global attentionを正しさの基準とし、sparse attentionは等価性試験後の
最適化に限定する。

### 5.3 Masking curriculum

学習バッチをseed付きで、全和声mask、連続区間mask、複数非連続区間mask、
個別フレームmask、将来のcausal distillation用suffix maskへ割り当てる。
全maskの割合とscheduleは耳で決めず、uniform random maskingおよび
causal predictionとの比較実験で決める。

### 5.4 目的関数

有効なoutput headsについて、正規化cross-entropyの重みなし平均を使う。
function/cadence補助headは別に報告し、ablation後にだけ含める。
根拠のない「音楽的loss」の小数重みを導入しない。

```text
Lprimary = mean(
  Levent,
  Lroot on CHANGE,
  Lquality on CHANGE,
  Linversion on CHANGE,
  Lbass on CHANGE,
  Lextensions on CHANGE
)
```

class imbalanceは学習splitから決めるdocumented data samplingまたは
effective-number class weightingで扱い、test setを聴いて選ばない。

### 5.5 推論

1. 指定和声フレームをmask tokenで埋める。
2. 双方向モデルを実行する。
3. schema maskとimmutable user locksを適用する。
4. seed付きの完全候補集合をsamplingする。
5. 既存の非微分可能理論ruleを評価する。
6. hard failureを拒否する。
7. neural mean log probability、empirical corpus likelihood、
   explicit preferenceで生存候補を辞書式にrankする。
8. model/device/seed/checkpoint provenance付きpreviewを返す。

初期実装は既定32候補とし件数を設定可能にする。製品側からモデル容量の固定上限は
設けず、利用可能メモリに合わせてbatchを調整し、OOM時は縮小する。

## 6. 制約統合

sampling前にlocked event、不正enum、`HOLD` grammar、tick範囲、必須終止位置を
hard maskする。完全候補に対し、secondary dominant、tritone substitute、cadence、
chromatic run、modulation seam、voice-leading、88鍵・左右手voicing、
melody/chordおよび全track衝突を既存engineで検証する。

研究variantではiterative sampling中に複数proposalへ有界なrule集合を実行し、
constraint vectorを改善するproposalから再samplingする。vectorを根拠のない
単一scalarへ潰さない。final-only rejectionより品質が改善するまで本番採用しない。

## 7. データ計画

| Source | Role | Policy |
| --- | --- | --- |
| POP909 | 主supervised set | source commitを固定し曲自体は同梱しない |
| AutoHarmonizer/Wikifonia artifacts | 再現baselineのみ | 全file・weightのlicenseを利用前に検証 |
| ChoCo | harmony-only pretrainingとstyle分析 | subsetごとのlicenseで選別 |
| user projects | private personalization | opt-inのみ。無断でglobal trainingへ混ぜない |
| generated theory corpus | constraint pretraining/negative examples | syntheticと表示しhuman ground truthにしない |

機械可読ledgerにsource、version、license、allowed purpose、checksum、split、
removal procedureを記録する。

Leakage防止ではwork/song単位split、重複arrangement・transposeのgroup化、
正規化n-gram fingerprint、曲内sectionのsplit禁止、key/style/modulationの
holdoutを行い、dedup thresholdとcollision countを公開する。

chord spellingは元labelをaudit用に残してcanonical factorsへ変換する。
major/minor/modeとmodulation boundaryを保存し、モデル用16分frameと
alignment error報告用の元tickを両方保持する。

```text
datasets/
  manifests/*.json
  processed/<dataset-version>/
    train.index.jsonl
    validation.index.jsonl
    test.index.jsonl
    vocabulary.json
    statistics.json
    data-card.md
```

著作権または別licenseのraw source fileはGitへ入れない。

## 8. CUDAとMetal/MPS

### 8.1 共通adapter契約

```python
class NeuralHarmonyBackend(InferenceBackend):
    def load(self) -> None: ...
    def generate(self, request: HarmonyRequest) -> list[HarmonyCandidate]: ...
    def infer(self, inputs: dict) -> dict: ...
    def unload(self) -> None: ...
    def health(self) -> dict: ...
```

checkpoint manifestはarchitecture、vocabulary/data manifest checksum、
PyTorch version、minimum app/API version、supported precisionを持つ。
呼び出し側はallowlistされたmodel IDだけを選べ、file pathは渡せない。

### 8.2 CUDA

- 対応時はBF16、非対応時はFP16と`torch.amp.GradScaler`
- 数値検証用FP32 reference run
- multi-GPUはDistributedDataParallel
- deterministic modeでは`torch.use_deterministic_algorithms(True)`と
  使用SDPA backendを宣言
- fast modeがbitwise reproduction非保証なら明示
- allocation failure時はbatch縮小、cache解放、retry後にCPU fallback

### 8.3 Metal/MPS

- `torch.backends.mps.is_available()`だけでなく実tensor演算で利用可否を検証
- まずFP32 parityを確認し、その後FP16を検証
- 標準PyTorch Transformer/SDPA primitivesを使用
- CPU fallbackをDiagnosticsで全件表示し、silent fallbackを禁止
- allocated memoryとallocator diagnosticsを表示
- MPS high-watermark safety limitを無効化しない
- MPS OOMではCPUへ移る前にbatchを縮小

### 8.4 Cross-device合格条件

bit-identical logitsは要求しないが、tokenizer/checkpoint hash、hard constraint結果、
事前登録threshold以上のtop-1一致、confidence interval付きtop-k overlapと
rank correlation、不正schema出力ゼロ、human preferenceのnon-inferiorityを必須とする。
thresholdはtest結果を見る前に固定する。

## 9. APIとプロジェクト契約

schema確定後にAPI v2を追加する。

```text
POST /api/v2/harmony/generate
POST /api/v2/harmony/cancel/{requestId}
GET  /api/v2/models/{modelId}/manifest
GET  /api/v2/jobs/{requestId}
```

requestは`apiVersion`、`requestId`、allowlist済み`modelId`、user-visible `seed`、
`generationMask`、`lockedHarmony`、`melody`、`controls`を持つ。
response候補は型付きchord events、分離された各score、hard-rule vector、
device/dtype/backend、checkpoint SHA-256、各stage時間、warning/fallback reasonを持つ。

## 10. UX統合

- Generateはcancel可能なbackground job。再生と手動編集を継続可能
- encoding、neural proposal、theory validation、voicing、rankingを表示
- 結果は常にpreviewで、明示的Applyまで本編へ反映しない
- `Neural CUDA`、`Neural Metal`、`Neural CPU`、checkpoint version、
  CPU fallbackの有無を表示
- 失敗時は曲を変更せず、retry、smaller batch、CPU、corpus ranker、
  theory-onlyを提示
- smartphoneはdesktop serverのmodelを使い、必要性を測定するまで
  mobile専用checkpointは作らない

## 11. 評価プロトコル

Baselineは、deterministic engine、同engine+n-gram、再現可能なAutoHarmonizer、
同parameter予算のcausal Transformer、hard constraintなしHarmonyForge、
full systemの6系統とする。

客観指標は各headのaccuracy/NLL、note-in-chord、onset EMD、duration entropy、
終止・適用和音解決、rule別違反、機能遷移分布、voice-leading分布、
harmonic-rhythm diversity、memorization、p50/p95 latency、peak memory、
OOM recovery、CUDA/MPSのtop-k一致を含む。単一指標を音楽品質と同一視しない。

人間評価は同じsoundfont、音量、tempo、melody、octave、velocity、開始位置で
pairwise比較する。musician/non-musicianを分け、no-preferenceを用意し、
model identityをblind化する。収集前にpower analysisを行い、listenerとmelodyを
random effectsとしたmixed-effects analysis、confidence interval、多重比較補正を使う。

Ablationはmelody stream、full-mask、bidirectional、factor heads、hierarchy、
empirical ranker、hard validator、stepwise guidance、multi-corpus、各precisionを
1つずつ外して比較する。

## 12. 実装milestoneとgate

- **M0 Protocol freeze**: 評価、data ledger、tokenizer、metrics、seedsを固定。
  leakageとlicense check前に学習しない。
- **M1 Data compiler**: POP909再現、split/dedup、tick/chord round-trip、data card。
- **M2 Baseline reproduction**: n-gram、matched causal Transformer、
  可能ならAutoHarmonizer。
- **M3 HarmonyForge-BiMask**: CPU reference training、full/range mask、
  deterministic checkpoint/manifest。
- **M4 Engine integration**: typed adapter、hard validation、preview-only UI、
  cancel/retry/fallback。
- **M5 CUDA/MPS**: CUDA mixed precision/DDP、MPS operation/memory、
  cross-device study。
- **M6 Evaluation**: locked test、3つ以上のtraining seeds、ablation、listening study。
- **M7 Validated release**: 測定済み結果だけを公開し、code/config/checksum、
  model card、failure casesを出す。MPS non-inferiorityと既存2 baselineへの
  有意なpreference改善を1.0条件とする。

## 13. 必要なリポジトリ構造

```text
backend/app/ml/
  contracts.py
  tokenizer.py
  model.py
  decoding.py
  checkpoint.py
  backends/cuda.py
  backends/mps.py
  backends/cpu.py
training/
  datasets/
  train.py
  evaluate.py
configs/models/
  harmonyforge-bimask-base-v1.yaml
models/manifests/
tests/{unit,integration,cuda,mps,cross_device}/
```

## 14. 中止条件

次が1つでも残る場合、ニューラルモデルをreleaseしない。

- test leakageまたは学習データ権利が不明
- 既存deterministic+n-gram systemよりhuman preferenceが低い
- hard-theory failureが増える
- MPSでsilent CPU fallbackがある
- デバイスごとにschemaが異なる
- model outputがprojectを直接上書きする
- cancel時にpartial candidateを保存できる
- 事前登録した全seedでなくbest seedだけを報告する
- 大きいという理由だけで大型modelを選ぶ

## 15. 一次資料

- Wu et al., AutoHarmonizer: <https://arxiv.org/abs/2112.11122>
- Wu et al., ReaLchords: <https://proceedings.mlr.press/v235/wu24c.html>
- Huang et al., rule-guided diffusion:
  <https://proceedings.mlr.press/v235/huang24g.html>
- Kaliakatsos-Papakostas et al., curriculum masking:
  <https://arxiv.org/abs/2601.16150>
- Kaliakatsos-Papakostas et al., harmony tokenization:
  <https://doi.org/10.3390/info16090759>
- Hadjeres et al., DeepBach:
  <https://proceedings.mlr.press/v70/hadjeres17a.html>
- Wang et al., POP909:
  <https://archives.ismir.net/ismir2020/paper/000089.pdf>
- de Berardinis et al., ChoCo:
  <https://doi.org/10.1038/s41597-023-02410-w>
- PyTorch CUDA semantics:
  <https://docs.pytorch.org/docs/stable/notes/cuda.html>
- PyTorch MPS backend:
  <https://docs.pytorch.org/docs/stable/notes/mps.html>
- Apple, Accelerated PyTorch training on Mac:
  <https://developer.apple.com/metal/pytorch/>
- PyTorch reproducibility:
  <https://docs.pytorch.org/docs/stable/notes/randomness.html>
