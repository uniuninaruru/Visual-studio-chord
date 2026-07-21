# リリース検証チェックリスト

この文書は「コード上は対応している」状態と「対象実機で検証した」状態を分離します。必須証跡がないリリースを完成扱いにしません。Firefoxは今回のrelease-gating対象外です。

## 自動ゲート

対象コミットで通常の `CI` workflowが成功していることを確認します。

- Frontend typecheck / lint / unit / build
- Backend API integration / OpenAPI差分 / Ruff
- npm・pnpm双方の固定lockfileインストール
- macOS / Linux / Windowsのランチャー構文とdry-run契約
- Chromium / WebKitのブラウザ・アクセシビリティE2E
- 実FastAPI + Vite proxy + 390px Chromiumの認証LAN E2E
- CPU DockerイメージのCompose解決とbuild

認証LAN E2Eは、`#access` のセッション保存とURLからの削除、ローカルサーバー接続、Generate、Play、保護されたrank APIへのトークン送信を確認します。これは実スマートフォンの代替となる自動契約テストであり、端末固有のWi-Fi・省電力・音声出力までは証明しません。

## 必須のGPU実機ゲート

Windows 11 + NVIDIA CUDA対応リリースは、対象コミットに対してGitHub Actionsの `CUDA integration (self-hosted)` をWindows CUDA runnerで成功させるまで完成扱いにしません。GPUの存在検出だけでは合格にせず、固定ランタイムのインストール、`--require-gpu` の小規模実推論、CUDA integration testの成功を必須とします。

Linux CUDAを配布対象に含める場合も、同workflowのLinux CUDA runnerを同様に通します。利用できるself-hosted runnerがない間は「未検証」と記録し、CPU / Browser fallbackだけを保証範囲とします。

## 手動の端末ゲート

- Windows 11 + Chrome + CUDAで生成、部分再生成、Play、CPU fallbackを確認する。
- Windows 11 + Chrome + GPUなしでCPU → Browser fallbackを確認する。
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
| Safari実機結果 | |
| LANスマートフォン機種 / OS / 結果 | |
| 未検証項目と保証するfallback | |

いずれかの必須項目が未検証または失敗の場合は、その組み合わせを「対応済み」と表記せず、利用可能なCPU / Browser / Theory-only fallbackを明記します。
