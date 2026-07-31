# POP909 和声専用ローカル data card

状態：**v1.0 recipe／contract確定（2026-07-30）**。このリポジトリはPOP909 corpus、normalized／
processed row、split assignment、学習済みweightを配布しません。実行する利用者が
POP909を本家から自分で取得し、prepare、compile、学習をローカルで行います。
固定済み本家checkoutに対する全corpusのprepare／compileは実行済みで、以下に
dataset集計とhashを記録します。full neural trainingの時間、コスト、収束、品質は
**未計測**です。

Source review状態：**利用者が取得するrunごとにpending**です。このcard自体は
repository全体に対する`approved`判断を付与しません。

このcardは文書であり、法律意見でも特定利用の適法性判断でもありません。
[和声専用・非公開ローカル学習ポリシー](harmony-only-private-training-policy.ja.md)
に従います。

## 想定用途

このdataset recipeは、非公開・ローカル限定の和声専用pretrainingと、決定論的
compiler経路の検証に使います。reviewして読み取るsource inputは
`harmony`、`key`、`meter`、`beatTiming`です。学習rowへ出すcontentは
`harmony`、`key`、`meter`だけです。beat時刻は整数の音楽gridを導出するためだけに
使い、秒単位のraw timestampはローカルに残します。

メロディ条件付きharmonization、伴奏、arrangement、voicing、演奏生成、model品質、
商用利用の権利、production inferenceへの適合を示すものではありません。
research／release flagにかかわらず、和声専用checkpointはメロディ条件付きruntimeへ
入れません。

## 本家sourceとreview

- 正規source：[music-x-lab/POP909-Dataset](https://github.com/music-x-lab/POP909-Dataset)
- 引用：Ziyu Wang、Ke Chen、Junyan Jiang、Yiyi Zhang、Maoran Xu、Shuqi Dai、
  Xianbin Gu、Gus Xia, “POP909: A Pop-song Dataset for Music Arrangement
  Generation,” ISMIR 2020
  （[論文](https://archives.ismir.net/ismir2020/paper/000089.pdf)）
- version：本家の完全な40文字のGit commitをlocal ledgerとsanitized receiptへ
  記録します。省略SHA、branch名、tagだけの指定は受理しません。

本家repositoryにはMIT Licenseが表示され、論文はCC BY 4.0で公開されています。
どちらも、個々の原曲、arrangement、annotation、学習、output、weightに必要な権利を
自動的にすべて処理するものとは、このcardでは扱いません。compile前に現在の本家条件、
取得方法、目的、適用法を確認します。preparerの`--license-id`とledgerの`approved`は
実行者が入力するreview記録であり、compilerによる法的判断ではありません。

## 抽出境界

`scripts/prepare-pop909-harmony-only.py`は、ローカルのPOP909 song directoryから
次の3 fileがすべてあるものだけを検出します。

- `beat_audio.txt`：beat時刻とbeat order。beat gridとmeterの導出に使用
- `chord_audio.txt`：chordの開始、終了、label
- `key_audio.txt`：key区間の開始、終了、label

MIDI、audio、歌詞、melody、伴奏、voicing、楽器編成、演奏control、曲名、
artist名、style metadata、別arrangement trackは読み込まず、出力もしません。
directory由来のitem identifierはprovenance、grouping、validationのためprivate
normalized recordに存在できますが、public receiptへは一切出しません。

## 正規化と量子化

`prepare-run.json`は、実行した
`scripts/prepare-pop909-harmony-only.py`のrepository相対pathと実bytesのSHA-256、
source commit、全gap／量子化option、件数、source／normalized hashを保存します。
ledgerはその`prepare-run.json`をSHA-256で固定し、compiler 1.2.0は
`--prepare-run`で実bytesを照合してからdata manifestへ同じbindingを引き継ぎます。
reference runのpreparer SHA-256は
`bf66a7a8d999b730938a8437046aad45533521224c7175f896c460e360151fc3`です。
固定したpreparerが正本で、以下は人が読める要約です。

現在のpreparerは次の処理をします。

- beat anchor間を区分線形補間し、秒をquarter-note tickへ変換
- 完全な3/4または4/4のbeat-order cycleを受理し、PPQ 480、120 tickの16分音符
  frameへ量子化
- chordとkeyのcoverageの共通区間をrecord範囲とし、開始点からの相対tickに変換して、
  最近傍frameへ丸める。ちょうど半分はゼロから遠ざかる方向
- 量子化前の隣接境界差が1 frame未満の場合だけ境界を揃え、その後も残るcollapse、
  gap、overlap、coverage不足をreject
- key境界でchordを分割し、chord rootをkey相対、bassをchord root相対に変換。
  隣接する同一chord eventを統合
- 128小節を超えるworkは、小節境界で決定論的に128小節以下のpartへ分割。
  chord／key spanをpart境界でclipして相対tickへshiftし、全partに共通のwork／
  source grouping identityを保持
- `N`区間は既定でreject。明示的なno-chord gapを残す場合は、preparerとcompilerの
  gap policyを一致させる。preparerの`allow-no-chord`は`N` labelのspanをeventから
  除いて明示的なgapとして残し、compilerの`allowNoChord`がそのgapを受理する

raw beat時刻、source label、normalized record、詳細なerror locationはすべてlocalに
残します。public receiptへ出せる除外情報は、大分類のreason別集計だけです。

## ローカル再現レシピ

これは一般ユーザーのアプリ起動手順ではなく、weightを自分のPCだけで作る人向けです。
CPUでも実行できますが、104,567,874 parameterのfull training時間と必要memoryは
まだ実測していません。Apple GPUは`mps`、NVIDIA GPUは`cuda`であり、別のdeviceです。

まず依存関係を導入し、固定したannotation subsetを本家から取得します。

```bash
# macOS / Linux
./scripts/setup.sh cpu
./.venv/bin/python scripts/fetch-pop909.py
```

```powershell
# Windows 11 PowerShell
.\scripts\setup.ps1 -Acceleration cpu
.\.venv\Scripts\python.exe .\scripts\fetch-pop909.py
```

次の3値は意図的に無効なplaceholderです。現在の条件を自分でreviewし、実際のUTC時刻と
判断したidentifierへ置き換えない限りpreparerは停止します。

```bash
# macOS / Linux
RETRIEVED_AT_UTC="REPLACE_WITH_YYYY-MM-DDTHH:MM:SSZ"
REVIEWED_AT_UTC="REPLACE_WITH_YYYY-MM-DDTHH:MM:SSZ"
LICENSE_ID="REPLACE_WITH_IDENTIFIER_FROM_YOUR_REVIEW"
OUTPUT="datasets/processed/pop909-harmony-only-v1"
mkdir -p "$OUTPUT"

./.venv/bin/python scripts/prepare-pop909-harmony-only.py \
  --pop909 datasets/raw/POP909-Dataset \
  --output-records "$OUTPUT/records.jsonl" \
  --output-ledger "$OUTPUT/ledger.json" \
  --output-prepare-run "$OUTPUT/prepare-run.json" \
  --source-version d83e6edba6872a704f5d3b8b32f5cb540088dae6 \
  --retrieved-at-utc "$RETRIEVED_AT_UTC" \
  --review-basis license \
  --reviewed-at-utc "$REVIEWED_AT_UTC" \
  --license-id "$LICENSE_ID" \
  --confirm-source-approved \
  --gap-policy allow-no-chord

./.venv/bin/harmonyforge-compile \
  --input "$OUTPUT/records.jsonl" \
  --ledger "$OUTPUT/ledger.json" \
  --prepare-run "$OUTPUT/prepare-run.json" \
  --output "$OUTPUT/compiled" \
  --dataset-id pop909-harmony-only \
  --dataset-version d83e6edba6872a704f5d3b8b32f5cb540088dae6 \
  --content-profile harmonyOnlyV1 \
  --harmony-gap-policy allowNoChord
```

```powershell
# Windows 11 PowerShell
$RetrievedAtUtc = "REPLACE_WITH_YYYY-MM-DDTHH:MM:SSZ"
$ReviewedAtUtc = "REPLACE_WITH_YYYY-MM-DDTHH:MM:SSZ"
$LicenseId = "REPLACE_WITH_IDENTIFIER_FROM_YOUR_REVIEW"
$Output = "datasets\processed\pop909-harmony-only-v1"
New-Item -ItemType Directory -Force $Output | Out-Null

.\.venv\Scripts\python.exe .\scripts\prepare-pop909-harmony-only.py `
  --pop909 .\datasets\raw\POP909-Dataset `
  --output-records "$Output\records.jsonl" `
  --output-ledger "$Output\ledger.json" `
  --output-prepare-run "$Output\prepare-run.json" `
  --source-version d83e6edba6872a704f5d3b8b32f5cb540088dae6 `
  --retrieved-at-utc $RetrievedAtUtc `
  --review-basis license `
  --reviewed-at-utc $ReviewedAtUtc `
  --license-id $LicenseId `
  --confirm-source-approved `
  --gap-policy allow-no-chord

.\.venv\Scripts\harmonyforge-compile.exe `
  --input "$Output\records.jsonl" `
  --ledger "$Output\ledger.json" `
  --prepare-run "$Output\prepare-run.json" `
  --output "$Output\compiled" `
  --dataset-id pop909-harmony-only `
  --dataset-version d83e6edba6872a704f5d3b8b32f5cb540088dae6 `
  --content-profile harmonyOnlyV1 `
  --harmony-gap-policy allowNoChord
```

full reference trainingは次の形です。`--max-steps 1`を付けた結果を品質modelや
学習コスト測定として扱ってはいけません。中断resume、適切なmodel規模、seed間比較、
収束条件はまだ研究gateです。

```bash
./.venv/bin/harmonyforge-train \
  --config configs/models/harmonyforge-bimask-base-v1.yaml \
  --data-manifest "$OUTPUT/compiled/data-manifest.json" \
  --model-directory local-models/pop909-pretraining-v1 \
  --source-commit "$(git rev-parse HEAD)" \
  --task harmony_only_pretraining \
  --epochs 1 \
  --device auto

./.venv/bin/harmonyforge-evaluate \
  --config configs/models/harmonyforge-bimask-base-v1.yaml \
  --data-manifest "$OUTPUT/compiled/data-manifest.json" \
  --model-directory local-models/pop909-pretraining-v1 \
  --split validation \
  --device auto \
  --output training/runs/pop909-harmony-only-validation.json
```

Windowsでは同じ引数を
`.\.venv\Scripts\harmonyforge-train.exe`／`harmonyforge-evaluate.exe`へ渡し、
`--source-commit (git rev-parse HEAD)`を使います。console entrypointに問題がある場合の
診断用source wrapperは`training/train.py`、`training/evaluate.py`、
`training/datasets/compiler.py`です。

学習後のartifactは
`local-models/pop909-pretraining-v1/harmonyforge-bimask-base-v1/versions/`へ
content-addressedに保存されます。これは推論modelの設置場所ではありません。
アプリに参照させてもDiagnosticsは「配置済み（推論対象外）」と表示し、どの環境変数でも
メロディ条件付き生成へ流しません。利用するには、将来メロディ条件付きdataで明示的に
fine-tuningし、別のinference-task artifactを書き出す必要があります。評価CLIだけでは
taskを昇格させません。

weightを公開せずsanitized receiptだけを出す場合は、active pointerが示すimmutable
versionを指定します。`docs/model-reports/pop909-local-run-v1`は新規directoryでなければ
ならず、既存の非空directoryは上書きされません。

```bash
ARTIFACT_ROOT="local-models/pop909-pretraining-v1/harmonyforge-bimask-base-v1"
ARTIFACT_VERSION="$(./.venv/bin/python -c \
  'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["artifactVersion"])' \
  "$ARTIFACT_ROOT/current.json")"
ARTIFACT="$ARTIFACT_ROOT/versions/$ARTIFACT_VERSION"

./.venv/bin/python scripts/export-public-training-receipts.py \
  --manifest "$ARTIFACT/manifest.json" \
  --training-run "$ARTIFACT/training-run.json" \
  --data-manifest "$ARTIFACT/data-manifest.json" \
  --prepare-run "$OUTPUT/prepare-run.json" \
  --output-dir docs/model-reports/pop909-local-run-v1
```

PowerShellでは先に
`$ArtifactRoot = "local-models\pop909-pretraining-v1\harmonyforge-bimask-base-v1"`
を設定し、
`$ArtifactVersion = (Get-Content "$ArtifactRoot\current.json" | ConvertFrom-Json).artifactVersion`
で同じversion directoryを取得できます。生成された3 JSONは自動的な公開許可ではなく、
local path、identifier、claim範囲を人が再確認してからGitへ追加します。

## Splitと重複管理

preparerはeligibleな本家song directoryごとに、128小節以下なら1 normalized
record、超える場合は小節境界で決定論的に複数recordを作り、すべてを決定論的に
sortします。同一workから生じたpartは同じwork／source grouping identityを共有する
ため、compilerで必ず同じsplitに入ります。近似的な音楽重複除去は行ったと主張しません。

dataset compilerは、work identity、hash化したsource-item identity、任意の明示済み
duplicate group、完全一致するnormalized harmony fingerprintを推移的にまとめます。
window化の**前**に、seed付きSHA-256規則でgroup全体を1つのsplitへ割り当てます。
現在の既定値はhash bucketでtrain 80%、validation 10%、test 10%、split seed
`1729`です。receiptには実際に使った値を記録します。fingerprint collisionは件数を
数えますが、削除しません。この方法では、近似盗用、関連arrangement、許可された
和声表現が異なるduplicateを検出できません。

row単位assignment、group identifier、fingerprint、曲単位件数はlocal限定です。
public summaryへ出せるのは、識別につながらないことを確認したsplit別record／window数と
collision group数の集計だけです。

## 検証済みfull-corpus prepare／compile

固定した本家commit
`d83e6edba6872a704f5d3b8b32f5cb540088dae6`から、宣言済みの3 annotation fileだけを
sparse checkoutした検証runでは、909 source item中900 workがeligibleで、
9 workを`beatCoverage`で除外しました。900 workから1,022 normalized recordを作成し、
内訳は778 unsplit recordと、122 workを分割した244 partです。
このreceiptはpreparerの`--gap-policy allow-no-chord`とcompilerの
`--harmony-gap-policy allowNoChord`を組み合わせたrunです。既定の`reject` runの
集計ではありません。

reference runのhash：

- source material SHA-256：
  `b8024b91b1229f7d26dd6b2b85aea1c4064cd39909d5b03f858fda4e5f66df5c`
- normalized JSONL SHA-256：
  `a1427c405b8b9fa646f68d207c9fb2bcdbfb2c00a2f3a15dbb598206d6e935ec`
- deterministic prepare-run SHA-256：
  `de8f19490ee24f0bf8e27fa3e3282363ee24ab60a825af86112d5654212638a2`
- reference review ledger SHA-256：
  `3468da96c988f3265c14aa34cf3f2d40aaff681a86185a15ea124cddbb2dbeb1`

source material、normalized JSONL、prepare-runは同じ固定bytes、script、optionから
再現する対象です。ledgerは`retrievedAt`、`reviewedAt`、review basisなど実行者の
正直な記録を含むため、上の値は**2026-07-30 reference review run固有**です。
別runで同じledger hashになることを要求しません。ledgerはbyte一致ではなく、
schema、full source commit、review completeness、prepare-run bindingを検証します。

compiler結果：

| Split | Record | Group | Window |
| --- | ---: | ---: | ---: |
| Train | 807 | 708 | 4,566 |
| Validation | 106 | 95 | 606 |
| Test | 109 | 97 | 608 |
| Total | 1,022 | 900 | 5,780 |

全split合計は1,366,635 frameです。完全一致fingerprint collision groupは0、
最大長は128小節、split leakageは0でした。tonality coverage failure、
harmony range／overlap failure、duplicate IDもすべて0でした。

同じ再現対象hashを別の一時出力でも確認したreference machine（Mac17,3、arm64、macOS 27.0 build
26A5388g、Python 3.14.5）でのローカル実測は次の通りです。

| Stage | Wall time | Max RSS | Peak footprint |
| --- | ---: | ---: | ---: |
| Prepare | 1.28 s | 109,920,256 bytes（104.8 MiB） | 98,419,216 bytes |
| Compile | 5.13 s | 736,411,648 bytes（702.3 MiB） | 723,321,840 bytes |

これは1台のmachineでのfull-corpus data preparation／compiler実測であり、最低要件、
他OS／hardwareでの所要時間、または普遍的な性能保証ではありません。energyは
未計測です。full neural trainingの所要時間、コスト、throughput、収束、音楽品質も
まだ測定していません。

fetch／prepare／compiler／receiptのunit testsとportable setupはWindows、macOS、
LinuxのCI対象です。canonical network fetch testは既定でskipされ、実POP909
full-corpusのfetch／prepare／compileを最後まで実測した環境は上記Macだけです。
「cross-platform unit tested」と「全corpusを各OSで実測済み」は同じ意味ではありません。

## 既知の制約

- POP909は909曲のpopular songであり、すべての文化、時代、genre、meter、和声言語を
  代表しません。
- 論文ではbeat、key、chord labelを機械抽出と説明しており、label／alignment errorが
  normalized dataへ入る可能性があります。
- 16分音符量子化は細かなtimingを失い、key相対正規化は一部の綴りとtonal contextを
  失います。
- 対応meter、長さ、chord label、gap policyによる除外が、系統的biasを生む可能性が
  あります。
- 完全一致fingerprintと本家folder identityだけでは、work単位またはnear-duplicateの
  独立性を証明できません。
- 和声専用dataではmelody conditioning、演奏可能なvoicing、arrangement、
  orchestration、表情、知覚品質を検証できません。
- 現行104,567,874 parameter構成がこのcorpus規模に適切だという根拠はまだありません。
  full training前に小型causal Transformer baselineと、validation／memorization／
  training costを同条件で比較します。「大きいから」を採用理由にしません。
- source licenseと下流modelの扱いは、法域と目的で異なる可能性があります。
- POP909全体のprepare／compile件数、hash、split integrity、reference machineでの
  wall time／memoryは計測済みですが、他環境へ一般化できません。消費energyは
  計測していません。
- full neural trainingの時間、学習コスト、throughput、収束、model品質はまだ
  計測していません。

## 再現性level

| Level | 主張できる内容 |
| --- | --- |
| Compiler receipt | 同じ固定済み本家bytes、preparer／compiler code、option、runtimeなら、source／normalized／prepare-run hashを再現する対象です。review ledgerはrun固有で、schemaとbindingを比較します。 |
| `deterministicConfigured` | seedと決定論設定を記録した単独runです。独立した2 runのcheckpoint byte一致をまだ証明していません。public receipt schema v2が自動付与できる最も強いlabelです。 |
| `bitwiseSameRuntime` | 同じ固定済みruntime、device class、library、code、input、config、seedによる**独立した2 run**のcheckpoint hash一致とruntime fingerprintを保存した場合だけ、将来のreceipt schemaで主張できます。現行exporterは発行しません。 |
| `statisticalMetricsOnly` | 後の検証で決定論的経路が証明されない限りMPSはこのlevelです。checkpoint byteではなく、事前登録した集計metricと許容差を比較します。cross-device比較も統計的に行います。 |

hash不一致は「未再現」です。別の統計評価なしに、同等runとして扱いません。

## M5 MPS smoke receipt

計測済みのApple Silicon M5上の**MPS smoke**では、104,567,874 parameterの実装を
MPS経路で正確に1 optimizer stepだけ動かし、418,289,648 bytesのcheckpointを書いて
reloadと構造検査を行いました。出力は明示的に`trained: false`、
`publishable: false`、`runtimeCompatible: false`です。
この測定でCUDAは使用していません。CUDAはNVIDIA環境用の別gateです。

これは1 optimizer step、export、reloadという配線とserializationだけを確認する
smokeです。full trainingの所要時間、学習コストbenchmark、throughput、収束、
model品質を証明するものでは**ありません**。
この未学習checkpointを利用または配布しません。MPS backwardでは実行したoperationの
strict deterministic実装がないと報告されたため、この観測は
`bitwiseSameRuntime`ではなく`statisticalMetricsOnly`です。

## Privacyと配布

raw checkout、normalized JSONL、詳細ledger、processed split、local
`data-manifest.json`、optimizer state、log、評価row、run directory、checkpointは
localかつGit未追跡にします。特にlocal data manifestにはrow assignmentが含まれるため、
そのまま公開しません。

repositoryへ公開できるのは、recipe、config、compiler／CLI source、このcard、
およびreview済みsanitized receiptだけです。A方針ではraw／processed dataもweightも
再配布しません。receiptに含められるのはdataset単位の
provenance、不変versionとhash、集計件数／分布、config／runtime hash、正確に限定した
再現性labelだけです。曲単位sequence／ID、row assignment、fingerprint、復元性の高い
希少n-gram、local path、credential、model bytesは含めません。checkpoint hashは
再現性のため記録できますが、対応するweightの配布を許可するものではありません。

public receipt schema v2のhash chainは、入力されたmanifest、training run、
data manifest、prepare run、checkpoint bytesの**署名されていない内部整合性**だけを
示します。作者、取得元、実際の学習実行、法的判断、音楽品質の真正性は証明しません。
全fileを同時に作り直してhashを再計算する攻撃には耐えません。そのためreceiptは
`integrityScope: unsignedInternalConsistency`、`authenticityClaimed: false`、
`weightsIncludedInThisReceipt: false`を明示します。warm-start元artifact自体を
exporterへ渡していない場合は`initialCheckpointBindingVerified: false`です。
公開3 JSONはsibling staging directoryで再読込検証後、directory単位でinstallし、
既存の非空run directoryを上書きしません。

個人情報は意図的に抽出しません。ただし、本家checkoutやlocal metadataに一切含まれない
ことまでは保証しません。local storage、backup、log、uploadを保護します。

## 撤回と再build

source、条件、provenance判断、checksumが撤回または変更された場合は次を行います。

1. 新しいcompileと学習を停止
2. source-itemの詳細を加えず、dataset-level public receiptを`revoked`または
   `superseded`に変更
3. dataset-level hashから該当local datasetとrunを特定
4. local checkout、normalized／processed data、詳細ledger、checkpoint、
   optimizer state、log、派生run artifactを削除
5. reviewをやり直し、引き続きapprovedなsourceだけで再build

公開weightの削除は救済策になりません。このpolicyでは最初から公開を許可しないためです。

## Validation checklist

- [ ] 利用者が正規の本家からPOP909を直接取得し、完全な40文字commitを固定した
- [ ] 人が現在の条件、reviewed source input（harmony/key/meter/beatTiming）、
  emitted training content（harmony/key/meter）、purpose、判断根拠、
  timestamp、removal procedureを記録し、default license値を未確認で採用していない
- [ ] preparerが宣言した3 annotation file以外を開いていない
- [ ] prepare-run、script SHA-256、option、source-material hash、normalized hash、
  compiler version、tokenizer hash、config hashを記録した
- [ ] ledger → prepare-run → data manifestのSHA-256 bindingをcompiler 1.2.0で検証した
- [ ] prepareとcompileのquantization／gap policyが一致している
- [ ] この検証receiptの再現では`allow-no-chord`／`allowNoChord`の組を明示し、
  既定の`reject` runと取り違えていない
- [ ] 除外、coverage、meter、最大長、chord vocabulary、dataset-level集計を確認した
- [ ] duplicate／work groupが1 split内にあり、window化前にsplitした
- [ ] 学習前にすべてのlocal artifact hashを検証した
- [ ] public receiptを別途sanitizeし、曲単位sequence／ID、split assignment、
  fingerprint、希少n-gram、local path、credential、model binaryが残っていない
- [ ] 拡張子だけに頼らずtracked fileを対象にrepository private-artifact検査が通る
- [ ] 単独runを`deterministicConfigured`より強く表示せず、独立した2 runの証拠なしに
  `bitwiseSameRuntime`を使っていない
- [ ] unsigned hash chainを真正性証明と呼ばず、未検証bindingとweight非同梱を明示した
- [ ] M5の1-step smokeを未学習・配布不可と表示し、学習コストや品質の根拠にしていない
- [ ] full-corpus prepare／compile集計、hash、reference machine実測を検証済み値として
  扱い、普遍的な性能要件やfull neural trainingの時間／コスト／品質と混同していない
