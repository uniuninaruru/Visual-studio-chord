# Harmony Lab

音楽理論に基づくコード進行とメロディを生成し、再生を止めずに編集・部分再生成できる、ローカル優先の作曲支援Webアプリです。CPUだけで基本機能が動き、利用可能な場合だけCUDA、MPS、Core ML、DirectMLを高速化に使います。

## 最短で起動する

Docker DesktopまたはDocker Engine + Compose v2がある場合、ホスト側のNode.jsやPythonは不要です。

Docker Desktopをインストールした後、先にDocker Engineが起動していることを確認します。

```bash
docker version
docker compose version
```

`docker version`に`Server`欄が表示されない場合は、Docker Desktopを起動してから再実行してください。

macOS / Linux:

```bash
./scripts/start-local.sh
```

Windows 11 PowerShell:

```powershell
.\scripts\start-local.ps1
```

この起動スクリプトは、推測されにくい一時アクセストークンを起動ごとに生成し、固定digestのCPU版backend/frontendをビルドしてComposeで起動します。トークンを`.env`へ永続保存する必要はありません。`docker compose up`を直接実行して`MTC_SHARED_TOKEN is missing`と表示された場合も、上記スクリプトから起動してください。初回だけベースイメージと固定依存関係の取得に時間がかかり、2回目以降はDockerのキャッシュを再利用します。

起動ログに次の2種類のURLが表示されます。

- `Desktop URL`: 同じPCで開くURL
- `Phone URL`: 同じ信頼できるLAN内のスマートフォンやタブレットで開くURL

必ず、ログに表示された `#access=...` 付きURLをそのまま開いてください。認証情報はURLフラグメントからブラウザのセッション領域へ移され、アドレス欄から直ちに削除されます。終了は `Control + C`、コンテナの停止は `docker compose down` です。

> 公共Wi-Fiやインターネットへポート5173を直接公開しないでください。この構成は自宅・制作室などの信頼できるローカルネットワーク向けです。

ポート5173が他のアプリで使用中の場合は、起動前に別ポートを指定できます。

```bash
# macOS / Linux
MTC_FRONTEND_PORT=5174 ./scripts/start-local.sh
```

```powershell
# Windows 11 PowerShell
$env:MTC_FRONTEND_PORT = "5174"
.\scripts\start-local.ps1
```

### Docker実機検証

2026-07-22にmacOS arm64のDocker Desktop 4.83.0（Engine 29.6.2、Compose 5.3.1）で次を確認済みです。

- 固定digestからCPU版backend/frontendをクリーンビルドできる
- 両コンテナがhealthyになり、UIとsame-origin APIがHTTP 200を返す
- Docker内のPython 3.12.10 / Linux aarch64 / CPU runtimeで決定的rankが成功する
- 認証なしは401、誤トークンは403、正しいセッショントークンは200になる
- 390×844のChromiumで認証フラグメントが消去され、Local server / Local CPUとして主要操作が表示される
- `docker compose down`でコンテナとネットワークを正常終了できる

Linux Docker buildはGitHub Actionsでも検証しています。Windows NVIDIA CUDA、物理スマートフォン、物理Safariは別の実機リリースゲートです。Firefoxは今回の対象外です。

## Dockerを使わない起動

固定している標準環境はNode.js `24.14.0`、npmまたはpnpm `11.9.0`、Python `3.12.10`です。対応範囲はNode.js 24系、Python 3.11〜3.14です。Python 3.12.10はWindows・macOS・Linuxの公式バイナリが揃う3.12系の基準版です。

macOS / Linux:

```bash
./scripts/setup.sh
./scripts/dev.sh
```

Windows 11 PowerShell:

```powershell
.\scripts\setup.ps1
.\scripts\dev.ps1
```

セットアップは依存関係、Python仮想環境、`.env`、モデル、利用可能な実行環境を確認します。既存の `.env` やプロジェクトデータを削除・上書きしません。バックエンドを起動できない場合もフロントエンドは終了せず、Browser / Theory-only modeで起動します。

同じLANの端末から使う場合:

```bash
# macOS / Linux
./scripts/serve-lan.sh
```

```powershell
# Windows
.\scripts\serve-lan.ps1
```

通常のローカルURLは `http://127.0.0.1:5173`、FastAPIは `http://127.0.0.1:8765` です。ポートは `.env` の `MTC_FRONTEND_PORT` と `APP_PORT` で変更できます。

## GPU高速化（任意）

基本セットアップにはGPUランタイムを含めません。先に通常起動ができることを確認し、その後だけ追加してください。

macOS / Linux:

```bash
./scripts/setup-acceleration.sh auto
```

Windows 11:

```powershell
.\scripts\setup-acceleration.ps1 auto
```

スクリプトは固定済み依存関係をインストールし、GPUが「存在する」だけでなく、小さな実推論が成功することを確認します。失敗してもCPU / Browser機能は残ります。Windowsでは `cuda`、`directml`、`cpu` を明示でき、macOSではMPS / Core ML、LinuxではCUDAまたはCPUを選択できます。

推論の基本フォールバックは次のとおりです。

```text
利用可能なローカルGPU
  → ローカルCPU
    → ブラウザ軽量ランキング
      → 音楽理論だけの決定的生成
```

CUDAや外部モデルは必須ではありません。Docker標準構成は移植性を優先したCPU版です。GPU版Dockerは任意構成で、CUDA利用にはホスト側ドライバーとNVIDIA Container Toolkitが必要です。

## 主な機能

- Major / Natural Minor / Harmonic Minor / Dorian / Mixolydian
- 7th、セカンダリードミナント、借用和音、トライトーン代理、sus / add9
- 固定シードによる再現可能なコード・メロディ生成（`Math.random()`不使用）
- A/B/C候補をプレビューし、採用時だけ正式データへ反映
- Like / Dislike / Favorite / A/B選択によるカテゴリ別好み学習
- 再生を継続したまま、次の拍・小節・ループ境界で編集を安全に反映
- ノート追加、複数選択、ドラッグ、コピー、ペースト、複製、クオンタイズ、削除
- 小節ロック、コード直接編集、部分再生成、候補試聴
- Undo / Redo、履歴名変更、履歴比較、任意履歴の復元
- JSONプロジェクト入出力、コード＋メロディの2トラックMIDI出力
- プロジェクトはlocalStorage → セッション内メモリ、好み学習はIndexedDB → localStorage → メモリへ段階的にフォールバック
- 環境診断、初回チュートリアル、Basic / Advanced / Developer設定
- キーボード操作、狭い画面のドロワー、固定Transport、横スクロール可能なピアノロール

## 基本操作

1. 初回チュートリアルまたはサンプル曲から開始します。
2. Basic設定でKey、Scale、Style、BPM、Barsを選び、「この設定で生成」を押します。
3. 上部のPlayを押します。状態バーに再生中の小節、ループ、保存、接続、推論モードが表示されます。
4. コードレーンで小節を選び、部分再生成を実行します。
5. 候補を試聴し、内容を確認してから採用します。AI結果が自動で曲を上書きすることはありません。
6. 再生中の編集は状態バーの `Edited · Apply at next ...` で反映時刻を確認できます。
7. JSONまたはMIDIを書き出します。保存に失敗した場合も、JSON書き出しによる退避を案内します。

主要ショートカット:

- `Space`: 再生 / 一時停止（入力欄では発動しません）
- `Cmd/Ctrl + Z`: Undo
- `Cmd/Ctrl + Shift + Z` または `Ctrl + Y`: Redo
- `Delete` / `Backspace`: 選択ノートを削除（Undo可能）
- `Esc`: モーダルを閉じる

## 状態表示とエラー時の動作

上部の状態バーにはPlayback、現在小節、Loop、編集反映時刻、AI進捗・経過時間・Cancel、Engine、保存状態、オンライン状態、ローカルサーバー接続を表示します。状態は色だけでなくテキストとアイコンでも示します。

ローカル推論が失敗しても、現在の曲は変更されません。ブラウザ軽量ランキングへ切り替わり、生成・再生・手動編集・保存を継続できます。音声開始失敗はAI失敗と分離して表示します。技術ログはDeveloperのDiagnosticsへ分離し、一般画面では「失敗した処理」「データが安全か」「次の対処」を表示します。

## 設定と診断

設定は段階的に分かれています。

- Basic: Key、Scale、BPM、Bars、Style、Generate
- Advanced: 高度な和声、メロディ密度、シンコペーション、跳躍、コードトーン、モチーフ
- Developer: Backend、Device、Model、Batch、Server、Diagnostics

Diagnosticsでは、build時のNode.js、接続中サーバーのPython / OS / CPU、ネットワーク、API互換性、推論バックエンド、GPU名、モデル、ストレージ、Web Audio、AudioWorklet、IndexedDB、File System Access、Web MIDI、WebSocket、WebAssembly、WebGPUを実環境または実APIから確認します。ブラウザ名だけで判定しません。

## 再現性と設定ファイル

- `.node-version`: Node.jsの固定版
- `.python-version`: Pythonの固定版
- `package-lock.json` / `pnpm-lock.yaml`: フロントエンド依存関係
- `backend/uv.lock` / `backend/requirements*.lock`: Pythonと任意推論環境
- `pyproject.toml`: Python対応範囲と固定した直接依存関係
- `.env.example`: 設定例（実際の `.env` はGit対象外）

主要な環境変数:

```dotenv
APP_HOST=127.0.0.1
APP_PORT=8765
MTC_FRONTEND_HOST=127.0.0.1
MTC_FRONTEND_PORT=5173
MTC_INFERENCE_MODEL=auto
MODEL_DIRECTORY=./models
LOG_LEVEL=INFO
```

コードにユーザー名を含む絶対パスは持たせません。曲内位置はPPQ 480を基準とする整数tickで保存し、保存時刻はUTCのISO 8601文字列です。内部のモード・和声機能は表示言語に依存しない識別子を使用します。

## APIとデータ契約

FastAPIのOpenAPIは `/openapi.json` で確認できます。APIはバージョン `1` とrequest IDを返し、モデルIDは許可リストからのみ選択できます。フロントエンド型はOpenAPIから生成し、CIで差分を検査します。

プロジェクトJSONには `schemaVersion` と `appVersion` が含まれます。旧v1形式は安全に移行し、未知の将来バージョンは現在の曲を変更せず拒否します。読込時はサイズ、MIME / 拡張子の手掛かり、JSON構造、数値範囲、tick、MIDI値を検証します。モデル本体はGitへ含めません。

## 品質チェック

macOS / Linux:

```bash
./scripts/test.sh
```

Windows:

```powershell
.\scripts\test.ps1
```

個別には次を実行できます。

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
(cd backend && ../.venv/bin/python -m pytest)
(cd backend && ../.venv/bin/python -m ruff check app tests)
python3 scripts/check-environment.py
python3 scripts/verify_acceleration.py --json
pnpm test:e2e
pnpm test:e2e:lan
```

単体、API統合、任意GPU、ブラウザE2Eを分離し、GPUがない環境ではGPUテストを明示的にSkipします。E2EはChromiumとWebKitで、初回導線、サーバー停止、オフライン、API不一致、狭い画面、モーダルのキーボード操作、重大な自動WCAG違反を検査します。LAN E2Eは実FastAPIとVite proxyを起動し、390px幅で認証、生成、再生、保護APIを検査します。NVIDIA GPU実機はGitHub Actionsの `CUDA integration (self-hosted)` をWindowsまたはLinuxのCUDAランナーで手動実行できます。対応状況は [互換性マトリクス](docs/compatibility.md)、完成判定に必要な証跡は [リリース検証チェックリスト](docs/release-checklist.md) を参照してください。

## アーキテクチャ

```text
React / TypeScript
  ├─ 決定的な音楽理論・生成エンジン
  ├─ ZustandのDraft / Committed / History
  ├─ Tone.jsのtick基準スケジューラー
  ├─ Versioned JSON / MIDI / 保存フォールバック
  └─ Versioned local inference client
                 │ same-origin HTTP + session token
                 ▼
FastAPI local server
  ├─ health / device / models / rank / preferences
  ├─ Mock / Linear / PyTorch / ONNX backend interface
  ├─ OOM時のbatch縮小とCPUフォールバック
  └─ CUDA / MPS / Core ML / DirectML / CPU
```

曲データが唯一の正しい状態で、音声ノードと推論候補は派生データです。AI処理と再生処理は独立しており、推論中も再生と手動編集を続けられます。

## セキュリティ

- バックエンド既定待受はloopbackのみです。
- DockerではFastAPIをホストへ直接公開せず、フロントエンドのsame-origin proxyだけを公開します。
- LAN起動時は毎回暗号学的に生成した一時トークンで変更系APIを保護します。
- CORSは明示したloopback originだけを許可し、ワイルドカードを拒否します。
- APIから任意パス、任意モデル、シェルコマンドを指定できません。
- 読込失敗や推論失敗後の中間データを正式プロジェクトとして保存しません。
- `.env`、モデルファイル、個人パスはGitへ含めません。

## ディレクトリ

```text
frontend/src/music/       音楽理論・生成・検証
frontend/src/audio/       再生スケジューラー
frontend/src/state/       Draft / Committed / History
frontend/src/storage/     project localStorage / preference IndexedDB / memory fallback
frontend/src/features/    UI、診断、JSON / MIDI
frontend/src/api/         OpenAPI由来のローカル推論クライアント
backend/app/              FastAPIと推論バックエンド
backend/tests/            Unit / integration / optional GPU tests
scripts/                  全OSのsetup / dev / test / diagnostics
```
