# CUDA機（RTX 5070）への学習環境移行手順

状態: 未実施の手順書。macOS側の測定値は実測、CUDA側の数値は推定であり、実機で確認するまで確定しません。

## なぜ移行するか

Apple Metal には決定的な embedding backward がありません（`index_put_with_accumulate_mps`）。
そのため MPS では `torch.use_deterministic_algorithms(True)` の下で学習できず、
`--allow-nondeterministic` を付けた run は `harmony_only_pretraining` artifact しか
作れません。**再現性を要求する推論用モデルを作るには CPU か CUDA が必要**です。

実測（macOS、batch 4、982 steps/epoch）:

| device | s/step | 1 epoch | 決定性 |
| --- | --- | --- | --- |
| CPU | 2.40 | 39分 | あり |
| MPS | 1.15 | 19分 | **なし** |
| CUDA (5070) | 0.09〜0.20（推定） | 2.5〜3.5分（推定） | あり（要実機確認） |

## 手順0: 移行を決める前の2分

**移行作業を始める前に、5070機で20 stepだけ通してください。** これが失敗するなら
移行の前提が崩れます。データセットのコピーもチャット履歴も後回しで構いません。

```bash
python training/train.py \
  --config configs/models/harmonyforge-bimask-base-v1.yaml \
  --data-manifest <compiled>/data-manifest.json \
  --model-directory local-models/probe \
  --source-commit $(git rev-parse HEAD) \
  --task harmony_only_pretraining \
  --device cuda --batch-size 4 --max-steps 20
```

出力の `"device": "cuda"` と `"fallbackReason": null` を確認します。
`"device": "cpu"` なら黙って降格しています（後述の罠）。

## 手順1: 環境

**WSL2 (Ubuntu) を推奨します。** ネイティブWindowsではなく。

理由は再現性です。`backend/requirements-acceleration-cuda.lock` は WSL2/Linux 上で
そのまま解決します。ネイティブWindowsでは lock 外の手動インストールが必要になり、
このプロジェクトが依存している「lockで固定された環境」という前提が崩れます。

```bash
./scripts/setup.sh cuda      # auto ではなく cuda を明示すること
```

### 罠: `auto` は黙ってCPUへ降格します

`-Acceleration auto`（既定）は 5070 を検出して cuda を選び、**プローブに失敗すると
CPU lock を再インストールしたうえで「成功」と報告します**。エラーになりません。
必ず `cuda` を明示してください。

### RTX 5070 は sm_120 です

Blackwell の sm_120 は CUDA 12.8 以降でのみサポートされます。PyTorch のリリース
wheel は SASS のみで PTX フォールバックを持たないため、**cu126 のビルドでは
`no kernel image is available` で即座に落ちます**。

torch 2.13.0 では CUDA 13.0 / 13.2 のビルドに `120` が含まれます。ネイティブWindowsで
入れる場合（非推奨）:

```bash
pip install torch==2.13.0 --index-url https://download.pytorch.org/whl/cu130
```

PyPI の `win_amd64` wheel（約122MB）は**CPU専用**です。cu130 版は約1.78GBあります。

### 検証

`torch.cuda.is_available()` が True でも意味がありません。arch を確認してください。

```bash
python -c "import torch; print(torch.version.cuda); print('sm_120' in torch.cuda.get_arch_list())"
```

`13.0` と `True` が出れば正しく入っています。

## 手順2: 移すもの

| 対象 | 方法 | 注意 |
| --- | --- | --- |
| リポジトリ | `git clone` | 追加作業なし |
| コンパイル済みデータ | バイナリコピー、または再生成 | **下記の CRLF 注意** |
| checkpoint | 任意（約399MB） | warm-start を引き継ぐ場合のみ |
| チャット履歴 | 任意 | `~/.claude/projects/<パス由来の名前>/<セッションID>.jsonl` |

### データセットは再生成のほうが安全です

`datasets/` と `local-models/` は `.gitignore` 対象で、git では運べません。
そしてコンパイル済みデータは**内容アドレス指定**なので、コピー時に CRLF 変換が
入ると SHA-256 が壊れ、`load_data_manifest` が拒否します。

再生成のほうが確実です。POP909 の取得から compile まで数分で終わります。

```bash
python scripts/fetch-pop909.py
python scripts/prepare-pop909-harmony-only.py \
  --pop909 datasets/raw/POP909-Dataset \
  --output-records datasets/processed/<version>/records.jsonl \
  --output-ledger  datasets/processed/<version>/ledger.json \
  --source-version d83e6edba6872a704f5d3b8b32f5cb540088dae6 \
  --retrieved-at-utc <取得日> \
  --review-basis license --license-id MIT \
  --reviewed-at-utc <確認日> --confirm-source-approved
python training/datasets/compiler.py \
  --input <version>/records.jsonl --ledger <version>/ledger.json \
  --prepare-run <version>/prepare-run.json --output <version>/compiled \
  --dataset-id pop909-harmony-only \
  --dataset-version d83e6edba6872a704f5d3b8b32f5cb540088dae6 \
  --content-profile harmonyOnlyV1
```

`split_seed` は固定なので split の割り当ては一致するはずですが、**これは未検証です**。
比較を跨いで使うなら、macOS側と Windows側で `data-manifest.json` の
`splits.*.sha256` が一致することを確認してください。一致しなければ、そのデータで
測った数値は macOS 側の結果と比較できません。

## 手順3: 移行後の確認

1. `--device cuda --max-steps 20` が `"device": "cuda"`, `"fallbackReason": null` を返す
2. `--allow-nondeterministic` を**付けずに**完走する（CUDAなら通るはず。通らなければ
   決定性の前提が崩れているので、どの演算が原因か報告すること）
3. 結果の `"deterministic": true` を確認する
4. 1 epoch の実測時間を記録し、推定 2.5〜3.5分と比較する

3が `false` になった場合、CUDA でも決定的でない演算を踏んでいます。その run で
作った重みは推論用にはなれません。

## 既知の未検証事項

- 5070 での実測スループット（推定は第一原理計算であり、実測ではない）
- WSL2 での GPU パススルー
- Windows の cu130 wheel が Linux と同じ arch でビルドされているか
- このリポジトリで CUDA 学習が成功した実績はまだありません。CI の
  `cuda-integration.yml` が検証しているのは ONNX ランナーであって HarmonyForge
  ではありません
