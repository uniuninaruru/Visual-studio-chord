# 和声専用・非公開ローカル学習ポリシー

状態：最初のローカル学習段階に適用するリポジトリ方針。この文書は法律意見ではなく、
特定データセットの利用が適法であると認定するものでもありません。

## 目的と対象範囲

最初に作る重みは、**非公開・ローカル限定の和声専用pretraining artifact**です。
メロディ条件付きの公開モデルではなく、GitHubへ公開またはcommitしません。

初期学習表現へ含めてよい情報は次のとおりです。

- 調を基準に正規化したコードroot、quality、転回形、bass、extension
- 整数tickで表した和声リズム
- key／mode、拍子、小節内位置
- 評価と重複除去に必要なsynthetic／source区分

次の情報は含めません。

- メロディまたは対旋律のnote
- 音声と歌詞
- raw MIDI、velocity、演奏タイミングなどの演奏表現
- 伴奏、voicing、楽器編成、track arrangement
- 曲名、アーティスト名など作品を特定する表示metadata

除外形式を読み込んで後から捨てる処理も、この初期pipelineの対象外です。
normalized inputの時点で、許可した和声表現だけにします。

## データセット単位の確認

和声専用段階では、全楽曲に対する個別許諾確認を標準gateにしません。代わりに、
データセットまたはsource subset単位で次のprovenance判断を記録します。

- 安定したsource ID、version、正規URL、UTCの取得日
- citationとattribution
- source material／treeとnormalized inputの正確なSHA-256
- 確認対象のcontent scopeがharmony、key、meterだけであること
- review statusと、license、public domain、contract、owner-provided data、
  または明示した法定の学習例外などの判断根拠
- 許可purposeが非公開ローカル和声学習であること
- 除去と再buildの手順

`approved`はプロジェクト内の判断記録であり、compilerによる法的認定ではありません。
`pending`、`blocked`、出典不明、checksum不一致のsourceは学習へ入れません。

## Gitへ保存してよいもの

リポジトリへ保存できるものは次のとおりです。

- policy、schema、test、抽出／compilerのsource code
- データセット単位のcitation、source version、review status、SHA-256
- 順序付き音楽列やsource itemを復元できない件数と大分類の分布

公開summaryへrecord／work／source-item ID、順序付きコード列、希少な高次n-gram、
ローカル絶対path、認証情報、行単位のsplit assignmentを含めません。

次のものはローカル限定で、Gitの追跡対象外です。

- raw sourceとnormalized record
- train／validation／test row
- source-item identifierを含む詳細ledger／manifest
- optimizer state、training log、評価row、run directory
- checkpointと変換済みmodel binary

保存先には、ignore済みの`datasets/raw/`、`datasets/processed/`、
`training/runs/`、`local-models/`、または`models/`配下のdirectoryを使います。

## リポジトリ境界の自動検査

次を実行します。

```bash
python scripts/check-private-artifacts.py
```

この検査は`git ls-files`を確認します。ignoreされたローカルartifactは許可しつつ、
追跡されたMIDI／音声、weight binary、private dataset directory、model配下の
artifact directoryがあればCIを失敗させます。検査できるのはpath分類までであり、
紛らわしい名前のtext fileが非復元的かは証明できません。公開する集計cardは
引き続き人が確認します。

## モデル能力と公開境界

このポリシーで学習したcheckpointは「和声専用pretraining」と表示します。
推論時にメロディを渡しても、メロディ条件付きモデルになったことにはなりません。
将来のcapability manifest、fine-tuning data、評価gateが対応を明示するまで、
メロディ条件付きruntimeとは分離します。

weight共有、hosted service公開、メロディ／arrangement data追加、商用利用へ進む場合は、
sourceとreleaseを改めて確認します。アプリのMIT Licenseは、datasetや学習済みweightの
権利を付与しません。

## 非公開weightでも残るリスク

ローカル限定は配布時のリスクを減らしますが、次の問題までは解消しません。

- sourceの取得条件、access control、database／contract上の制約
- data複製やmodel学習に関する法域ごとの規則
- annotation error、provenance誤り、train／test leakage
- sourceと異常に似たoutputやmemorization
- confidential data、ローカル保存の安全性、backup／uploadによる流出
- 将来weight、output、serviceを共有したときに発生する義務

sourceが撤回された場合やprovenanceが変わった場合は、新しい学習を停止し、hashから
該当runを特定してlocal artifactを除去し、残ったapproved sourceだけで再buildします。
