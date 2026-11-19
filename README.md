# Visual studio chord v2

コード進行とメロディを生成・編集する作曲支援アプリの作り直し版です。

**作り直しの途中です。** 公開中のアプリ（<https://uniuninaruru.github.io/Visual-studio-chord/>）は
v1 のままで、v1 のコードは `v1-final` タグにあります。方針と段階は
[docs/decisions/0001-v2-rewrite.md](docs/decisions/0001-v2-rewrite.md) にまとめています。

## いま使えるもの

- **試聴比較**（`/listen/`）: 生成エンジンの版どうしを、どちらが A かを伏せたまま聴き比べる
  ページです。再生位置を保ったまま A と B を切り替えられます。結果は `eval/results/` に
  保存されます（公開サイトではファイルとしてダウンロード）。

## 動かし方

Node.js 24 と pnpm 11 を使います。pnpm を入れていない場合は `pnpm` を `npx pnpm@11.9.0` に
読み替えてください。

```bash
pnpm install
```

```bash
pnpm dev
```

`http://127.0.0.1:5173/listen/` を開きます。

```bash
pnpm check
```

型検査、lint、テスト、ビルドをまとめて実行します。ブラウザでの確認は `pnpm test:e2e` です。

## 構成

| 場所 | 中身 |
|---|---|
| `packages/core` | 音楽コア。React・Tone.js・DOM に依存しない |
| `apps/web` | ブラウザのアプリ（いまは試聴比較だけ） |
| `eval/cases.json` | 聴き比べに使う固定の12ケース |
| `eval/renders/<版>/` | 各版の演奏データ（`vsc-render/1` 形式の JSON と MIDI） |
| `models/` | POP909 から作った和声 n-gram モデル |
| `tools/corpus/` | そのモデルの学習スクリプト |
| `docs/research/` | v1 時代の調査と出典台帳 |

## 音源

試聴比較のピアノは Salamander Grand Piano（Alexander Holm、CC BY 3.0）で、
再生するときに tonejs.github.io から読み込みます。読み込めない場合は簡易シンセで鳴らします。
比べる2つの版には常に同じ音源を使います。

## ライセンス

MIT。MIT 以外のコードは直接コピーしません。外部の MIT コードを移植する場合は
ライセンス表記を残します。
