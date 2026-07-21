# Harmony Lab

音楽理論に基づくコード進行とメロディを生成し、聴きながら部分編集・部分再生成できるローカル優先の作曲支援Webアプリです。設計書の Phase 1（編集可能なMVP）を実装しています。

## できること

- 12キー、Major / Natural Minor、4/4・3/4・6/8、4・8・16小節に対応
- Pop、J-Pop、Rock、Jazz、Lo-fi、EDM、Ballad、Game Musicのスタイル別生成
- 固定シードによる再現可能なコード進行・メロディ生成
- ダイアトニック進行、ローマ数字、Tonic / Predominant / Dominant表示
- Tone.jsによるループ再生と再生ヘッド
- 1小節または連続小節の選択、選択範囲だけの部分再生成
- 小節ロック、コード直接編集、ノート移調・時間移動・音価変更・削除
- 再生中の変更を Immediate / Next Beat / Next Bar / Next Loop で安全に反映
- Undo / Redo、localStorage保存、JSON入出力、2トラックMIDI出力
- FastAPIのhealth/device/models/rank API、CUDA検出とCPU/Browserフォールバック

## 必要環境

- 推奨: Docker Desktop、またはDocker Engine + Compose v2
- ネイティブ開発時のみ: Node.js 22.13以上、pnpm 11以上またはnpm、Python 3.10以上

Docker起動ではホスト側のNode.js、Python、PyTorch、CUDAは不要です。macOS、Windows、Linuxで同じローカルCPU構成を起動します。ブラウザはデスクトップでもスマートフォンでも利用でき、AIランキングなどの重い処理はデスクトップ側のFastAPIへ送ります。PyTorchがない場合もCPUへフォールバックします。

## セットアップ

### macOS / Windows / Linux共通（推奨）

Dockerだけを使用するため、ホスト側の言語ランタイム差に依存しません。

macOS / Linux:

```bash
./scripts/start-local.sh
```

Windows PowerShell:

```powershell
.\scripts\start-local.ps1
```

または全OS共通:

```bash
docker compose up --build
```

起動後は `http://127.0.0.1:5173` を開きます。終了は `Control + C`、バックグラウンドコンテナの停止は `docker compose down` です。

Docker版はフロントエンドだけをLANへ公開し、FastAPIはコンテナ内部に留めます。同じWi-Fi上のスマートフォンから `http://<デスクトップのプライベートIP>:5173` を開いてください。公共Wi-Fiやインターネットへ直接公開しないでください。

### ネイティブ開発

macOS / Linux:

```bash
chmod +x scripts/*.sh
./scripts/setup.sh
./scripts/dev.sh
```

Windows PowerShell:

```powershell
.\scripts\setup.ps1
.\scripts\dev.ps1
```

ネイティブ開発環境を同じLANのスマートフォンへ公開する場合:

```bash
# macOS / Linux
./scripts/serve-lan.sh
```

```powershell
# Windows PowerShell
.\scripts\serve-lan.ps1
```

手動で行う場合:

```bash
pnpm install
python3 -m venv .venv
.venv/bin/python -m pip install -e 'backend[test]'
```

npmを使う場合は、最初のコマンドを `npm install` に置き換えられます。

## ネイティブ起動

フロントエンドとFastAPIを一括起動:

```bash
./scripts/dev.sh
```

ブラウザで `http://127.0.0.1:5173` を開きます。FastAPIは `http://127.0.0.1:8765` で待ち受けます。

個別起動:

```bash
pnpm --dir frontend dev
.venv/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8765
```

FastAPIを起動しなくても、フロントエンドはBrowserモードで動作します。

## 基本操作

1. 左の生成設定でキー、スケール、スタイル、BPM、小節数、メロディ密度、シードを選ぶ。
2. 「この設定で生成」を押す。同じ設定とシードなら同じ結果になる。
3. 上部の再生ボタンでループを聴く。
4. コードレーンの小節をクリックする。Shift＋クリックで連続範囲を広げられる。
5. 鍵ボタンで変更したくない小節を保護する。
6. 下部で再生成対象を選び、「選択範囲を再生成」を押す。
7. ノートまたはコードを選び、右のインスペクターで編集する。
8. MIDIまたはJSONを書き出す。JSONは後から再読込できる。

## 品質チェック

```bash
./scripts/check.sh
```

個別コマンド:

```bash
pnpm --dir frontend typecheck
pnpm --dir frontend lint
pnpm --dir frontend test
pnpm --dir frontend build
(cd backend && ../.venv/bin/python -m pytest)
(cd backend && ../.venv/bin/python -m ruff check app tests)
```

## アーキテクチャ

```text
React / TypeScript UI
  ├─ pureな音楽理論・決定的生成エンジン
  ├─ Zustand編集状態・履歴・境界反映
  ├─ Tone.js小節単位スケジューラー
  ├─ localStorage / JSON / MIDI
  └─ LocalInferenceClient
             │ HTTP
             ▼
FastAPI Local AI Server
  ├─ health / device / models
  ├─ deterministic rank API
  ├─ optional PyTorch detection
  └─ CPU / CUDA fallback
```

曲データを唯一の正しい状態として保持し、Tone.jsオブジェクトは派生データとして管理しています。生成ロジックはReactコンポーネントから分離され、`Math.random()`は使用していません。

## セキュリティ

- FastAPIの既定待受は `127.0.0.1` のみです。
- CORSはlocalhost / loopbackの明示的なoriginだけを許可します。
- 許可originは `MTC_CORS_ORIGINS` で設定できます。例は `.env.example` を参照してください。
- APIは任意モデルパスやシェルコマンドを受け取りません。
- 外部から読み込むJSONは型・数値範囲・MIDI値を検証します。

## Phase 1で未実装のもの

以下は設計書どおり Phase 2 / 3 の対象です。

- A/B/C候補の常設比較UIと個人向け好み学習
- 7th・セカンダリードミナント・借用和音を使う高度な自動生成
- 詳細ドラッグ編集、複数ノート選択、コピー＆ペースト、クオンタイズ
- PyTorch / ONNXモデルのロード・アンロード、MLPランキング学習、OOM縮小再試行
- 条件付きAI生成、TensorRT、外部MIDI機器、オートメーション

未実装機能はUI上で実装済みとして表示していません。

## ディレクトリ

```text
frontend/src/music/      音楽理論・生成・検証
frontend/src/audio/      Tone.js再生スケジューラー
frontend/src/state/      Zustand編集状態と履歴
frontend/src/storage/    ローカル永続化
frontend/src/features/   UI機能とJSON/MIDI出力
backend/app/             FastAPIアプリケーション
backend/tests/           API・設定・デバイス検出テスト
```
