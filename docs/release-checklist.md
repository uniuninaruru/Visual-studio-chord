# リリース検証チェックリスト

この文書は「コード上は対応している」状態と「対象実機で検証した」状態を分離します。必須証跡がないリリースを完成扱いにしません。Firefoxは今回のrelease-gating対象外です。

## 自動ゲート

対象コミットで通常の `CI` workflowが成功していることを確認します。

- Frontend typecheck / lint / unit / build
- Backend API integration / OpenAPI差分 / Ruff
- torch-freeのBackend base lane
- 固定済みPyTorch / SafeTensorsを使う任意のBackend neural CPU lane
- npm・pnpm双方の固定lockfileインストール
- macOS / Linux / Windowsのランチャー構文とdry-run契約
- Chromium / WebKitのブラウザ・アクセシビリティE2E
- 実FastAPI + Vite proxy + 390px Chromiumの認証LAN E2E
- CPU DockerイメージのCompose解決とbuild

認証LAN E2Eは、`#access` のセッション保存とURLからの削除、ローカルサーバー接続、Generate、Play、保護されたrank APIへのトークン送信を確認します。これは実スマートフォンの代替となる自動契約テストであり、端末固有のWi-Fi・省電力・音声出力までは証明しません。

neural CPU laneは、104,567,874 parameterの実装、tokenizer、checkpoint manifest
とchecksum拒否、API v2 job / cancel、mock表示、candidateが
`hardRuleValidation: pendingClient`かつ`adoptable: false`で返ることを検査します。
学習済みcheckpointをCIへ持ち込まず、聴感品質や「学習済み」を証明するものでは
ありません。base laneに`torch`または`safetensors`が混入した場合は失敗扱いです。

## ニューラルプレビューの出荷ゲート

- 配布するcheckpointのmanifestにarchitecture、config/checkpoint実file、
  tokenizer、学習data manifestのSHA-256とtraining/evaluation statusが
  記録されている。
- runtimeでallowlist済み`data-manifest.json`を含む実file hash、tokenizer、
  schema、architecture、app/API version、対応precisionを検証する。
  compilerがexport前にmanifest ledgerとsplit / vocabulary / statistics
  artifact hashを検証した証跡を残す。dataset権利・leakageもtraining release
  processで別途照合する。
- `researchOnly` artifactを通常モデルとして表示しない。
- mockはUI/APIの両方で「MOCK」「未学習」「未評価」と分かる。
- candidateは既存の理論・voicing・全track validatorを通るまでApply不可である。
- Cancel、timeout、OOM、process restartでpartial candidateや正式データを残さない。
- checkpointなしの標準インストールでCorpus / Browser / Theory fallbackが使える。
- CPU Dockerはvalid checkpointをread-only mountした場合だけHarmonyForgeを公開する。

## 必須のGPU実機ゲート

Windows 11 + NVIDIA CUDA対応リリースは、対象コミットに対してGitHub Actionsの `CUDA integration (self-hosted)` をWindows CUDA runnerで成功させるまで完成扱いにしません。GPUの存在検出だけでは合格にせず、固定ランタイムのインストール、`--require-torch-device cuda` のPyTorch CUDA実tensor演算、HarmonyForge CUDA integration testの成功を必須とします。

Linux CUDAを配布対象に含める場合も、同workflowのLinux CUDA runnerを同様に通します。利用できるself-hosted runnerがない間は「未検証」と記録し、CPU / Browser fallbackだけを保証範囲とします。

Apple Metal / MPS対応を表記する場合も、Apple Silicon実機で実tensor probe、
固定checkpointからの候補生成、CPU fallback理由、CUDA/CPUとの許容差を記録します。
DirectMLはv0.4のHarmonyForge deviceではありません。WindowsではCUDAまたはCPUを
検証し、DirectMLはONNX rankerの証跡として分離します。

## 手動の端末ゲート

- Windows 11 + Chrome + CUDAで生成、部分再生成、Play、CPU fallbackを確認する。
- Windows 11 + Chrome + GPUなしでCPU → Browser fallbackを確認する。
- Apple Silicon + MPSで生成、部分再生成、Cancel、CPU fallbackを確認する。
- macOS Safariで初回生成、Play、部分再生成、JSON保存を確認する。
- macOSまたはWindowsのデスクトップと同じ信頼済みLANにあるスマートフォンで、起動ログの認証URLを開き、GenerateとPlayを確認する。
- 低性能CPU設定で候補生成中もPlay、Cancel、手動編集が応答することを確認する。

## 証跡

リリースPRまたはリリースノートへ次を記録します。

| 項目 | 記録値 |
|---|---|
| Commit SHA | |
| 通常CI URL / 結果 | |
| Windows CUDA workflow URL / 結果 | |
| OS / ブラウザ | |
| GPU名 / ドライバー | |
| Python / 推論backend / runtime | |
| Model ID / manifest SHA-256 / checkpoint SHA-256 | |
| Training / evaluation status | |
| CUDA / MPS / CPU同等性結果 | |
| Safari実機結果 | |
| LANスマートフォン機種 / OS / 結果 | |
| 未検証項目と保証するfallback | |

いずれかの必須項目が未検証または失敗の場合は、その組み合わせを「対応済み」と表記せず、利用可能なCPU / Browser / Theory-only fallbackを明記します。
