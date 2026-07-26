# Visual studio chord

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**コード進行とメロディを自動で作ってくれる、作曲の練習・アイデア出し用のアプリです。**

キーと雰囲気を選んで「生成」を押すと、音楽理論に沿った曲が1曲できます。気に入らない部分だけを選んで作り直したり、音を直接動かしたりできます。**曲を再生したまま編集できる**のが特徴です。

楽譜が読めなくても、音楽理論を知らなくても使えます。作った曲はMIDIファイルとして書き出せるので、GarageBandやCubaseなどのDAWに読み込んで続きを作れます。

### こんなことができます

- コード進行が思いつかないとき、**王道進行**や**小室進行**など定番の進行から選んで曲の骨組みを作る
- できた曲の「サビだけ作り直す」「メロディだけ変える」といった部分的なやり直し
- 気に入った候補に **Like** を付けると、次からあなたの好みに寄せて候補を並べ替え
- 作った曲をMIDIで書き出してDAWで仕上げる

### 安心して使える設計

- **勝手に曲が書き換わりません。** AIが出した候補は「採用」を押すまで反映されません
- **同じ設定なら必ず同じ曲になります。** 気に入った曲は設定を控えておけば再現できます
- **曲データはあなたのPCの中だけ**にあります。インターネットに送信されません
- 保存状態は画面上部に常に表示されます（保存済み／このセッションのみ など）

---

## まず試してみる

### いちばん簡単な方法

Docker という仕組みを使うと、面倒な準備なしで動かせます。

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) をインストールして起動する
2. このリポジトリをダウンロードする（緑の「Code」ボタン →「Download ZIP」）
3. ダウンロードしたフォルダを開いて、ターミナル（Windowsは PowerShell）で次を実行する

**macOS の場合**

```bash
./scripts/start-local.sh
```

**Windows の場合**

```powershell
.\scripts\start-local.ps1
```

4. 表示された `Desktop URL:` の後ろにあるURLを、そのままブラウザにコピーして開く

> **Windowsで赤いエラーが出たら** → [コマンドを実行できないとき（Windows版）](#コマンドを実行できないときwindows版) を先に実行してください。

これで画面が開きます。最初はチュートリアルが出るので、案内に沿って進めてください。

### 動かしてみたあとに

画面左の **Basic** 設定でキーやテンポを変えて「この設定で生成」を押すと、別の曲ができます。気に入ったら **Export** から MIDI を書き出せます。

うまく動かないときは [困ったとき](#困ったとき) を見てください。

---

技術的な詳細（決定的生成、ローカル優先設計、GPU高速化など）は、この先の各節で説明しています。

## スクリーンショット

*<img width="1710" height="993" alt="スクリーンショット 2026-07-23 21 51 06" src="https://github.com/user-attachments/assets/25408cdc-9e18-473b-bc3f-40ebe987208c" />
*

<!-- 画像を docs/images/ に置いたら、以下のコメントを外してください
![全体画面](docs/images/overview.png)
![ピアノロールと候補比較](docs/images/piano-roll.png)
![スマートフォン表示](docs/images/mobile.png)
-->

## 主な機能

**生成（画面から使えます）**

- Major / Natural Minor / Harmonic Minor / Dorian / Mixolydian
- 7th、セカンダリードミナント、借用和音、トライトーン代理、sus / add9
- 王道進行・小室進行・丸サ進行・カノン進行・循環コードなど、実務者の合意がある**名前付きコード進行**をID指定で選択可能（33種）
- 9th / 11th / 13th 等のテンション、分数コード（スラッシュベース）に対応
- Verse-Chorus / AABA / 通作形式の**曲構造（セクション）**生成 — セクションごとに固有のコード進行
- 最終セクションの**転調**（半音・全音・短3度上などのキー変化）
- メロディが和声と異なるモードを取る**複調**、ヨナ抜き/ニロ抜き**ペンタトニック旋律**
- 固定シードによる再現可能なコード・メロディ生成
- A/B/C候補をプレビューし、採用時だけ正式データへ反映

**生成（`GeneratorSettings` から使えます／画面のUIは未対応）**

以下はすべて**任意指定**です。指定しなければ、これらが存在しなかった頃と同一の曲が生成されます（キー×モード×小節数×スタイル×シードの360曲でバイト単位の一致を検証しています）。

| 設定 | 内容 |
| --- | --- |
| `harmonicRhythm` | 1小節1コードの制約を外し、コードを tick 単位のスロットに配置。終止に向けた和声リズムの加速も指定可 |
| `phraseGrammar` | 「提示 → 応答 → 断片化 → カデンツ」という古典的な楽節構造でフレーズを区分 |
| `functionalHarmony` | 進行を度数テンプレートの展開ではなく、和声機能の状態遷移の最短経路探索として生成 |
| `voiceLeading` | 和音を SATB 4声体として配置。連続5度・連続8度・声部交差・限定進行音の未解決を、スタイル別の重みで回避 |
| `melodicSkeleton` | フレーズの開始音・頂点・終止を先に決め、その間を補間した音域に旋律を寄せる（`phraseGrammar` が必要） |
| `nonChordTones` | 経過音・刺繍音・アポジャトゥーラ・先取音・掛留・逆行掛留・逸音・囲い込みを「準備→不協和→解決」の3音一組で生成 |
| `pivotModulation` | キーが変わる継ぎ目の直前を、両キーにダイアトニックな和音に書き換えて転調を準備 |
| `euclideanRhythm` | 指定数の音を等間隔に配置。トレシージョ E(3,8)、シンキージョ E(5,8)、ボサノヴァ E(5,16) などが得られます |
| `groove` | グリッド上の正確な配置をやめ、スウィング・シャッフル・ボサ・バックビートなど8種のグルーヴで演奏 |

**音楽理論エンジン（解析API・生成には未接続）**

生成された曲や手入力の進行を「読む」ための関数群です。曲の出力には影響しません。

- **緊張カーブ／エネルギー曲線** — 和声・旋律・リズムから小節ごとの緊張度を測定し、セクション別の目標エネルギーを計画
- **ガイドトーンライン** — 各和音の3rdと7thを、担う構成音を交替しながら最小移動でつなぐ2声を算出
- **モーダルインターチェンジ** — 平行スケール群から借用和音の語彙を体系的に生成（Cメジャーで46和音）、スタイル別の重み付き
- **コードスケール理論** — 各和音に合うスケールを15種から照合し、利用可能音・アヴォイドノート・到達できるテンションを報告
- **リハーモナイゼーション** — 既存メロディに対し、ダイアトニック代理・セカンダリードミナント・裏コード・モーダルインターチェンジ・経過減和音・バックドアドミナント・ペダルポイント・分数コード・クロマティックメディアントの9技法から候補を生成し、旋律適合・機能的進行・スタイル適合で採点
- **クロマティックメディアント／対称和声** — 三度関係の和音を共通音数で分類し、全音音階・オクタトニックとその和音を算出

**多声部の生成（`NoteEvent[]` を返すAPI・現時点では再生されません）**

- **対旋律** — 平行5度・平行8度・声部交差を避け、反行の度合いを指定できる第2声部
- **カノン／模倣** — 旋律を遅延・移調・反行して再現
- **ポリリズム／ポリメーター** — 小節に対して異なる周期を持つ層と、両者が揃うまでの小節数の算出

これらは音符を返しますが、**再生・MIDI書き出し・ピアノロールはまだ1声部しか扱えません**。可聴化には多声部対応（再生／書き出し／表示／プロジェクトスキーマ）が別途必要です。

**編集**

- 再生を継続したまま、次の拍・小節・ループ境界で編集を安全に反映
- ノート追加、複数選択、ドラッグ、コピー、ペースト、複製、クオンタイズ、削除
- 小節ロック、コード直接編集、部分再生成、候補試聴
- Undo / Redo、履歴名変更、履歴比較、任意履歴の復元

**学習と入出力**

- Like / Dislike / Favorite / A-B選択によるカテゴリ別の好み学習
- JSONプロジェクト入出力、コード＋メロディの2トラックMIDI出力
- プロジェクトは localStorage → セッション内メモリ、好み学習は IndexedDB → localStorage → メモリへ段階的にフォールバック

**UIと環境**

- 環境診断、初回チュートリアル、Basic / Advanced / Developer 設定
- キーボード操作、狭い画面のドロワー、固定Transport、横スクロール可能なピアノロール
- 同一LAN内のスマートフォン・タブレットから利用可能

## 技術スタック

| 領域 | 使用技術 |
| --- | --- |
| フロントエンド | React 19 / TypeScript / Vite / Python3|
| 状態管理 | Zustand（Draft / Committed / History） |
| 音声 | Tone.js、`@tonejs/midi`、`@tonaljs/tonal` |
| バックエンド | FastAPI / Uvicorn（Python 3.12.10） |
| テスト | Vitest、Playwright（Chromium / WebKit）、pytest、ruff、ESLint |
| 実行環境 | Docker Compose、GitHub Actions、Node.js 24.14.0 |

## クイックスタート（Docker）

Docker Desktop または Docker Engine + Compose v2 があれば、ホスト側の Node.js や Python は不要です。

先に Docker Engine が起動していることを確認します。

```bash
docker version
docker compose version
```

`docker version` に `Server` 欄が表示されない場合は、Docker Desktop を起動してから再実行してください。

macOS / Linux:

```bash
./scripts/start-local.sh
```

Windows 11 PowerShell:

```powershell
.\scripts\start-local.ps1
```

起動スクリプトは、推測されにくい一時アクセストークンを起動ごとに生成し、固定digestのCPU版backend/frontendをビルドしてComposeで起動します。トークンを `.env` へ永続保存する必要はありません。`docker compose up` を直接実行して `MTC_SHARED_TOKEN is missing` と表示された場合も、上記スクリプトから起動してください。初回だけベースイメージと固定依存関係の取得に時間がかかり、2回目以降はDockerのキャッシュを再利用します。

起動ログには2種類のURLが表示されます。

- `Desktop URL`: 同じPCで開くURL
- `Phone URL`: 同じ信頼できるLAN内のスマートフォンやタブレットで開くURL

必ず、ログに表示された `#access=...` 付きURLをそのまま開いてください。認証情報はURLフラグメントからブラウザのセッション領域へ移され、アドレス欄から直ちに削除されます。終了は `Control + C`、コンテナの停止は `docker compose down` です。

> **注意:** 公共Wi-Fiやインターネットへポート5173を直接公開しないでください。この構成は自宅・制作室などの信頼できるローカルネットワーク向けです。

ポート5173が使用中の場合は、起動前に別ポートを指定できます。

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

2026-07-22に macOS arm64 の Docker Desktop 4.83.0（Engine 29.6.2、Compose 5.3.1）で次を確認済みです。

- 固定digestからCPU版backend/frontendをクリーンビルドできる
- 両コンテナがhealthyになり、UIとsame-origin APIがHTTP 200を返す
- Docker内のPython 3.12.10 / Linux aarch64 / CPU runtimeで決定的rankが成功する
- 認証なしは401、誤トークンは403、正しいセッショントークンは200になる
- 390×844のChromiumで認証フラグメントが消去され、Local server / Local CPUとして主要操作が表示される
- `docker compose down` でコンテナとネットワークを正常終了できる

Linux Docker build は GitHub Actions でも検証しています。Windows NVIDIA CUDA、物理スマートフォン、物理Safari は別の実機リリースゲートです。Firefox は対象外です。

## Dockerを使わない起動

固定している標準環境は Node.js `24.14.0`、npm または pnpm `11.9.0`、Python `3.12.10` です。対応範囲は Node.js 24系、Python 3.11〜3.14 です。

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


セットアップは依存関係、Python仮想環境、`.env`、モデル、利用可能な実行環境を確認します。既存の `.env` やプロジェクトデータを削除・上書きしません。バックエンドを起動できない場合もフロントエンドは終了せず、Browser / Theory-only mode で起動します。

同じLANの端末から使う場合:

```bash
# macOS / Linux
./scripts/serve-lan.sh
```

```powershell
# Windows
.\scripts\serve-lan.ps1
```

通常のローカルURLは `http://127.0.0.1:5173`、FastAPI は `http://127.0.0.1:8765` です。ポートは `.env` の `MTC_FRONTEND_PORT` と `APP_PORT` で変更できます。

## 困ったとき

### コマンドを実行できないとき（Windows版）

PowerShellでコマンドを実行したときに赤い文字のエラーが出て実行できない場合、Windowsが「この `.ps1` ファイルを実行してよいか分からない」として止めています。次のコマンドをPowerShellに貼り付けて Enter を押してください。

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

その後、実行できなかったコマンドをもう一度試してください。

この設定は**いま開いているPowerShellだけ**に適用されます。閉じれば元に戻るので、パソコン全体の設定が変わることはありません。

> [!NOTE]\
> この手順はWindowsでのみ必要です。PowerShellを管理者として起動する必要はありません。

### 画面が開かない・401エラーになる

起動ログに表示された **`#access=...` が付いたURL** をそのまま開いてください。このURLにはアクセス用の一時キーが含まれています。`http://127.0.0.1:5173` だけを開くと認証されず表示できません。

### ポート5173が使用中と言われる

ほかのアプリが同じポートを使っています。別のポートを指定して起動してください。

```bash
# macOS / Linux
MTC_FRONTEND_PORT=5174 ./scripts/start-local.sh
```

```powershell
# Windows
$env:MTC_FRONTEND_PORT = "5174"
.\scripts\start-local.ps1
```

### 「このセッションのみ」と表示される

ブラウザの保存領域が使えない状態です（プライベートモードや容量不足など）。曲は画面上には残りますが、**タブを閉じると失われます**。Export から JSON を書き出して保存してください。

### 音が出ない

ブラウザが音声の再生をブロックしている可能性があります。画面のどこかをクリックしてから Play を押し直してください。改善しない場合は右上の **Diagnostics** で音声まわりの状態を確認できます。

## GPU高速化（任意）

基本セットアップにGPUランタイムは含まれません。先に通常起動ができることを確認してから追加してください。

```bash
# macOS / Linux
./scripts/setup-acceleration.sh auto
```

```powershell
# Windows 11
.\scripts\setup-acceleration.ps1 auto
```

スクリプトは固定済み依存関係をインストールし、GPUが「存在する」だけでなく、小さな実推論が成功することまで確認します。失敗してもCPU / Browser機能は残ります。Windows では `cuda`、`directml`、`cpu` を明示でき、macOS では MPS / Core ML、Linux では CUDA または CPU を選択できます。

CUDA や外部モデルは必須ではありません。Docker標準構成は移植性を優先したCPU版です。GPU版Dockerは任意構成で、CUDA利用にはホスト側ドライバーと NVIDIA Container Toolkit が必要です。

## 基本操作

1. 初回チュートリアルまたはサンプル曲から開始します。
2. Basic設定で Key、Scale、Style、BPM、Bars を選び、「この設定で生成」を押します。
3. 上部のPlayを押します。状態バーに再生中の小節、ループ、保存、接続、推論モードが表示されます。
4. コードレーンで小節を選び、部分再生成を実行します。
5. 候補を試聴し、内容を確認してから採用します。AI結果が自動で曲を上書きすることはありません。
6. 再生中の編集は状態バーの `Edited · Apply at next ...` で反映時刻を確認できます。
7. JSON または MIDI を書き出します。保存に失敗した場合も、JSON書き出しによる退避を案内します。

主要ショートカット:

| キー | 動作 |
| --- | --- |
| `Space` | 再生 / 一時停止（入力欄では発動しません） |
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Ctrl + Shift + Z` / `Ctrl + Y` | Redo |
| `Delete` / `Backspace` | 選択ノートを削除（Undo可能） |
| `Esc` | モーダルを閉じる |

## 生成と好み学習の仕組み

「AI」と一括りにせず、処理を分けて実装しています。

| 層 | 方式 |
| --- | --- |
| 生成 | 決定的な音楽理論エンジン（スケール・ダイアトニック和声・ケイデンス・ボイスリーディング・モチーフ） |
| 好み調整 | 候補を特徴量化し、Like / Dislike / Favorite / A-B選択から更新した重みでランキング |
| 実行環境 | ローカル推論バックエンドを任意選択（`MTC_INFERENCE_MODEL` = `auto` / `linear` / `mlp` / `onnx` / `mock-deterministic`） |

曲そのものは生成AIではなく音楽理論エンジンが作ります。学習が効くのは「複数候補の並び順」であり、学習データが無い状態では中立（決定的な順序）になります。

推論のフォールバックは次のとおりです。

```text
利用可能なローカルGPU
  → ローカルCPU
    → ブラウザ軽量ランキング
      → 音楽理論だけの決定的生成
```

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

## 状態表示とエラー時の動作

上部の状態バーには Playback、現在小節、Loop、編集反映時刻、AI進捗・経過時間・Cancel、Engine、保存状態、オンライン状態、ローカルサーバー接続を表示します。状態は色だけでなくテキストとアイコンでも示します。

ローカル推論が失敗しても、現在の曲は変更されません。ブラウザ軽量ランキングへ切り替わり、生成・再生・手動編集・保存を継続できます。音声開始失敗はAI失敗と分離して表示します。技術ログは Developer の Diagnostics へ分離し、一般画面では「失敗した処理」「データが安全か」「次の対処」を表示します。

## 設定と診断

- **Basic**: Key、Scale、BPM、Bars、Style、Generate
- **Advanced**: 高度な和声、メロディ密度、シンコペーション、跳躍、コードトーン、モチーフ
- **Developer**: Backend、Device、Model、Batch、Server、Diagnostics

Diagnostics では、build時のNode.js、接続中サーバーのPython / OS / CPU、ネットワーク、API互換性、推論バックエンド、GPU名、モデル、ストレージ、Web Audio、AudioWorklet、IndexedDB、File System Access、Web MIDI、WebSocket、WebAssembly、WebGPU を実環境または実APIから確認します。ブラウザ名だけで判定しません。

## セキュリティ

- バックエンド既定待受はloopbackのみです。
- DockerではFastAPIをホストへ直接公開せず、フロントエンドのsame-origin proxyだけを公開します。
- LAN起動時は毎回暗号学的に生成した一時トークンで変更系APIを保護します。
- CORSは明示したloopback originだけを許可し、ワイルドカードを拒否します。
- APIから任意パス、任意モデル、シェルコマンドを指定できません。
- 読込失敗や推論失敗後の中間データを正式プロジェクトとして保存しません。
- `.env`、モデルファイル、個人パスはGitへ含めません。

## 品質チェック

```bash
# macOS / Linux
./scripts/test.sh
```

```powershell
# Windows
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

単体、API統合、任意GPU、ブラウザE2Eを分離し、GPUがない環境ではGPUテストを明示的にSkipします。E2E は Chromium と WebKit で、初回導線、サーバー停止、オフライン、API不一致、狭い画面、モーダルのキーボード操作、重大な自動WCAG違反を検査します。LAN E2E は実FastAPIとVite proxyを起動し、390px幅で認証、生成、再生、保護APIを検査します。NVIDIA GPU実機は GitHub Actions の `CUDA integration (self-hosted)` を Windows または Linux の CUDA ランナーで手動実行できます。

対応状況は [互換性マトリクス](docs/compatibility.md)、完成判定に必要な証跡は [リリース検証チェックリスト](docs/release-checklist.md)、名前付きコード進行・拡張和音・ジャンル別和声の調査根拠は [docs/research/](docs/research/) を参照してください。

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

コードにユーザー名を含む絶対パスは持たせません。曲内位置は PPQ 480 を基準とする整数tickで保存し、保存時刻はUTCのISO 8601文字列です。内部のモード・和声機能は表示言語に依存しない識別子を使用します。

## APIとデータ契約

FastAPI の OpenAPI は `/openapi.json` で確認できます。API はバージョン `1` と request ID を返し、モデルIDは許可リストからのみ選択できます。フロントエンド型は OpenAPI から生成し、CIで差分を検査します。

プロジェクトJSONには `schemaVersion` と `appVersion` が含まれます。旧v1形式は安全に移行し、未知の将来バージョンは現在の曲を変更せず拒否します。読込時はサイズ、MIME / 拡張子の手掛かり、JSON構造、数値範囲、tick、MIDI値を検証します。モデル本体はGitへ含めません。

## ディレクトリ

```text
frontend/src/music/       音楽理論・生成・検証（progressions.ts: 名前付き進行 / sections.ts: 曲構造・転調）
frontend/src/audio/       再生スケジューラー
frontend/src/state/       Draft / Committed / History
frontend/src/storage/     project localStorage / preference IndexedDB / memory fallback
frontend/src/features/    UI、診断、JSON / MIDI
frontend/src/api/         OpenAPI由来のローカル推論クライアント
backend/app/              FastAPIと推論バックエンド
backend/tests/            Unit / integration / optional GPU tests
scripts/                  全OSのsetup / dev / test / diagnostics
docs/                     互換性マトリクスとリリース検証チェックリスト
```

## ロードマップ

- 名前付き進行・曲構造（セクション/転調）をBasic/Advanced設定UIから選択可能にする（現状はAPI/設定オブジェクト経由）
- A/B選択データを使ったpairwise ranking学習
- GPUを活かしたさらに高度な学習やコード生成
- 楽器の数を増やす
- UI/UX面での快適性向上
- DAW連携（Standard MIDI File Type 1、コード/メロディのトラック分離）
- VSTプラグイン化も視野に

更新履歴は [CHANGELOG.md](CHANGELOG.md) を参照してください。

## ライセンス

[MIT License](LICENSE) です。著作権表示とライセンス条文を残せば、商用利用・改変・再配布・私的利用のいずれも自由に行えます。ソフトウェアは無保証で提供されます。

Copyright (c) 2026 uniuninaruru
