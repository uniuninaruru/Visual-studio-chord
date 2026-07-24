# コード進行・音楽理論 調査まとめ（実装リファレンス）

Visual studio chord の生成エンジンを拡張するための、コード進行と音楽理論の調査結果です。ジャンル別コード進行、拡張和音、ボイスリーディング規則、非和声音の分類、ケイデンスを、**現行コードの拡張ポイントに対応づけて**整理しています。

> ## 信頼度の考え方（重要）
>
> **コード進行は自然法則ではなく「慣習」です。** したがって学術文献を頂点に置く評価軸は、この領域では機能しません。実際「王道進行」という名称は2008年にニコニコ動画で個人（音極道氏）が付けたものが定着し、査読論文（Ramage 2023）は**15年後にそれを追認した**にすぎません。**実務者の合意そのものが ground truth** です。
>
> そこで本文書では次の軸を使います:
>
> | ラベル | 意味 |
> |---|---|
> | **実務者合意** | 複数の独立した実務者（作曲教室・プロデューサー・DTM解説）が**同じ名前・同じ度数**で言及。慣習として確定 |
> | **単一出典** | 1サイトのみの主張。有用だが裏取り推奨 |
> | **自動採譜** | ChordU / Chordify 等の機械解析による曲固有の情報。**最も弱い**（実地でサイト間の不一致を確認済み） |
> | **理論的確立** | 音程計算・声部進行則など、演繹で確かめられるもの |
>
> 注意すべき失敗モードは「ブログだから不正確」ではなく、**(a) 要約層での捏造**（出典に無い記述の混入）と **(b) 自動採譜の不一致**です。人が書いた解説記事はむしろ正確なことが多く、特に**「曲のどこで使うか」は実務者サイトにしか書かれていません**。

## ★ 最有力の情報源 — 実曲コード進行データベース

解説記事より優先すべき一次データ源。

**[コード進行メモ倉庫](https://music-chord.com/)** — JASRAC / NexTone 許諾済み。**実曲のセクション別コード進行**を収録（アニメ・映画・ドラマ・CM主題歌を多数含む）。

- **セクション（イントロ / A メロ / B メロ / サビ / C メロ / アウトロ）ごとに分けて**コードとキーを表示 → 本エンジンに欠けている「セクション別進行」「セクション別転調」の実データがそのまま取れる
- アーティスト別一覧あり（YOASOBI、サカナクション、ヨルシカ 等）
- **注意**: 度数（ディグリー）表記は**実際のページには出ていない**。表示されるのは実コード記号のみなので、**記載キーから度数を自分で導出する必要がある**
- **注意**: 自動採譜ではなく人手のメモと思われるが、正確性の保証はない

実務者による解説サイト（下記）は「**曲のどこで使うか**」を教えてくれる点で学術資料より有用:
- [うちやま作曲教室 — 王道コード進行 全10パターン](https://sakkyoku.info/beginner/popular-chord-progression-pattern/)
- [JBG音楽院 — カノン/小室/王道の使い分け](https://jbg-ongakuin.com/staff-blog/20250808/)

---

## 日本の実務者が使う数字表記

日本の作曲現場では**度数を数字で**呼びます（全キーに移調できるため）。本文書のローマ数字と対応させておきます。

| 通称 | 数字 | 度数 | C major |
|---|---|---|---|
| 王道進行 | **4536** | `IV–V–iii–vi` | F–G–Em–Am |
| 小室進行 | **6451** | `vi–IV–V–I` | Am–F–G–C |
| 丸サ進行 / Just the Two of Us | **4361** | `IVM7–III7–vi–I7` | FM7–E7–Am–C7 |
| 循環コード | **1625** | `I–vi–ii–V` | C–Am–Dm–G |

**使い分け（実務者サイトの一致した記述）**:
- **王道進行** — サビ**冒頭4小節**が最も効果的。「迫ってきたと思ったら突き離される、答えが出ない情景」
- **小室進行** — アップテンポなサビ全体、A メロ→サビの橋渡し。「マイナーからメジャーへの移行＝困難に立ち向かう疾走感」
- **カノン進行** — バラードのサビ全体、卒業ソング。下降ベースが「流れている」感覚を生む

この「どこで使うか」の情報は**エンジンのセクション別進行割り当てに直接使えます**。

### 実務者が挙げる装飾技法（本文書に不足していたもの）

| 技法 | 例 | 内容 |
|---|---|---|
| **クリシェ** | `I–IM7–I7–I6`（D–DM7–D7–D6） | 和音を保ったまま**内声を半音ずつ下降**させる（D→C♯→C→B）。J-POPの定番だが現行エンジンに概念なし |
| **パッシングディミニッシュ** | `I–♯Idim–IIm7`（A–A♯dim–Bm7） | 根音の間を減七で埋める。既存 `diminished7` で表現可 |
| **サブドミナントマイナー** | `IV–iv–I`（F–Fm–C） | 同主短調からの借用。「切なさを倍増」。実曲（milet）でも `Gm7` として確認 |
| **セカンダリードミナント** | `I–III7–VIm`（A–C♯7–F♯m） | 王道進行の `iii` を `III7` に置換する派生が定番 |

**クリシェは現行エンジンに該当概念がありません**（和音記号は変わらず内声だけが動くため、`ChordQuality` の列挙では表現しにくい）。ボイシング層での実装が必要です。

---

現行コードの主な拡張ポイント（`frontend/src/types/music.ts`）:
- `ChordQuality` — 現在は3和音・7th・sus・add9まで。**9th/11th/13thは未実装**
- `StylePresetId` — 現在8スタイル（pop, j-pop, rock, jazz, lo-fi, edm, ballad, game-music）
- `CadenceType` — authentic, plagal, half, deceptive, loop
- `Mode` — major, naturalMinor, harmonicMinor, dorian, mixolydian
- `NoteRole` — chordTone, scaleTone, passing, neighbor, approach（**5種のみ**）
- `ChordSpecialKind` — secondaryDominant, borrowed, tritoneSubstitution, suspended, addedTone

---

## 1. ジャンル別コード進行（進行テンプレートの素材）

度数列はそのまま `StylePreset.majorProgressions` / `minorProgressions` のテンプレート候補として使えます。現在テンプレートは4度数固定ですが、ここには可変長の進行が含まれます。

### 1.1 Pop / Rock（確立）

| 名称 | 度数列 | C majorでの例 | 備考 |
|---|---|---|---|
| Axis（王道4和音） | `I–V–vi–IV` | C–G–Am–F | 最頻出。回転形も同じ和音 |
| Axis回転 | `vi–IV–I–V` | Am–F–C–G | "sensitive female" |
| Axis回転 | `IV–I–V–vi` | F–C–G–Am | |
| Axis回転 | `V–vi–IV–I` | G–Am–F–C | |
| 50s / Doo-wop | `I–vi–IV–V` | C–Am–F–G | |
| ミクソリディア風 | `I–V–♭VII–IV` | C–G–B♭–F | ♭VII（借用）が肝。現行 `borrowed` で表現可 |

`I–V–♭VII–IV` の ♭VII は既存の `ChordSpecialKind: "borrowed"` に対応します。

### 1.2 J-POP（広く流布）

| 名称 | 度数列 | C majorでの例 | 特徴 |
|---|---|---|---|
| 王道進行 | `IVM7–V7–iii7–vi` | FM7–G7–Em7–Am | 長和音2つ→短和音2つ。「明→哀」 |
| 王道（7thなし） | `IV–V–iii–vi` | F–G–Em–Am | |
| 王道フル解決 | `IVM7–V7–iii7–vi–ii7–V7–I` | | 8和音の拡張形 |
| 王道（短調） | `VIM7–VII7–v7–i` | | 短調版 |
| カノン進行 | `I–V–vi–iii–IV–I–IV–V` | C–G–Am–Em–F–C–F–G | 下降ベース。スラッシュコードで実装（3章参照） |

王道進行の `iii7`（Em7）は現行エンジンでは自動的に選ばれにくい度数で、**「進行テンプレートを選べる」機能**があってこそ狙って出せます。これがユーザー要望「コード進行を選んで生成」の直接の裏付けです。

### 1.3 EDM（広く流布）

短調が基本。1和音2小節、120–128 BPM が定型。

| 度数列 | 例 | 使用曲（報告ベース） |
|---|---|---|
| `i–III–VII–VI` | Am–C–G–F | Avicii "Levels" |
| `i–VI–III–VII` | Am–F–C–G | 汎用 |
| `VI–VII–i`（ビルドアップ） | F–G–Am | 盛り上げ |
| `iv–I–vi–V`（長短混在） | | Calvin Harris "Sweet Nothing" |

### 1.4 Lo-fi hip hop（広く流布）

ジャズ/ソウルの和声を**遅く**したもの。7th/9thが必須で、1和音を数小節保持。

| 度数列 | 7th化した例 |
|---|---|
| `ii–V–I` | Dm7–G7–Cmaj7 |
| `I–vi–ii–V` | Cmaj7–Am7–Dm7–G7 |
| `I–vi–IV–V`（7th化） | Cmaj7–Am7–Fmaj7–G7 |

→ **lo-fi プリセットは 9th/11th/13th 実装（2章）と最も相性が良い。** 現行の三和音出力ではlo-fiらしさが出ない。

### 1.5 Jazz / Blues（確立）

| 名称 | 度数列 | 備考 |
|---|---|---|
| ii–V–I（長調） | `ii7–V7–IM7` | 必ず7th。根音が5度上行 |
| ii–V–i（短調） | `iiø7–V7(alt)–i` | ii度がハーフディミニッシュ |
| 12小節ブルース | `I7 I7 I7 I7 / IV7 IV7 I7 I7 / V7 IV7 I7 (V7)` | 全て属7 |
| クイックチェンジ | `I7 IV7 I7 I7 / ...` | 2小節目でIVへ |
| リズムチェンジェス A | `I–vi–ii–V` の高速反復 | AABA 32小節 |
| リズムチェンジェス B（ブリッジ） | `III7–VI7–II7–V7` | ドミナント連鎖（各コードが次のV7） |
| ターンアラウンド各種 | `I–vi–ii–V` / `I–VI–ii–V` / `iii–vi–ii–V` / `I–♭III–♭VI–♭II7`(Tadd Dameron) | コーラス末尾 |
| バックドア進行 | `iv7–♭VII7–I` | プラガル終止の拡張。♭VII7はV7と3度・7度を共有 |

Bird changes（Blues for Alice型）は小節数の食い違いがあり**要検証**。原譜での照合を推奨。

### 1.6 R&B / Neo-soul / Gospel（広く流布〜確立）

**進行そのものより「コードクオリティの格上げ規則」が重要。** 骨格は ii–V–I 系だが、各コードにテンション/オルタレーションを1段足す。

一次確認済みのリハーモナイズ実例（Orange Candy Music）:
```
R&B版:      Fmaj7 – Dm7  – Gm7  – C7
ネオソウル版: Fmaj9 – D7♯9 – Gm11 – C13♭9
```
差し替え規則: メジャー7th→**メジャー9th**、マイナー7th→**マイナー11th**、ドミナント7th→**ドミナント13(♭9)** 、一部を**セカンダリードミナント/オルタード化**。

一次確認済みのゴスペル進行:
- `I–vi–ii–V` の9th化: `Cmaj9–Am9–Dm9–G7♭9`（確認済）
- `1-4-5 + セカンダリードミナント`: `C–C7–F–D7–G–C`（確認済）
- トライトーン代理終止: `D♭7→C`（V7の代理、確認済）
- ゴスペル・トレイン（下降ベース）: `C–C/B–Am–Am/G–F–F/E–Dm–G`（確認済）
- 経過減七: `C/E–F–F♯dim7–C/G–G7♯9♯5`（確認済）

→ これらは 9th/11th/13th（2章）とスラッシュコード/転回（3章）が揃わないと表現できない。

---

## 2. 拡張和音 9th / 11th / 13th（`ChordQuality` 拡張）

### 2.1 正確な音程スタック（確立）

```
dominant9   = 1-3-5-♭7-9
major9      = 1-3-5-7-9
minor9      = 1-♭3-5-♭7-9
dominant7♭9 = 1-3-5-♭7-♭9      dominant7♯9 = 1-3-5-♭7-♯9
dominant11  = 1-3-5-♭7-9-11
minor11     = 1-♭3-5-♭7-9-11
dominant7♯11= 1-3-5-♭7-♯11     major7♯11   = 1-3-5-7-♯11
dominant13  = 1-3-5-♭7-9-(11)-13   ※11は通常省略
major13     = 1-3-5-7-9-(♯11)-13
minor13     = 1-♭3-5-♭7-9-11-13
```

**設計判断**: 既存の列挙値追加（`dominant9`等）を並べるか、`baseQuality + tensions[]` 構造へ変えるか。テンションの組み合わせ爆発を考えると後者が拡張性は高い。

現行の `add9`/`minorAdd9`（7thを含まない）は理論的に正しく、**9thコードとは別物として維持すべき**（Cadd9 = C-E-G-D、C9 = C-E-G-B♭-D）。

### 2.2 アヴォイドノート（確立・実装必須）

メジャー/ドミナント系（長3度）に**ナチュラル11th**を重ねると、3rdと11thが**短9度**でぶつかり強く濁る。
- 対処1: 3rdを省略 → 実質 sus4 / 9sus4 の響き
- 対処2: 11thを半音上げ #11 に → リディアン・サウンド（major7♯11, dominant7♯11）

度数別のダイアトニック成立可否（Cメジャーに適用して導出、音程計算自体は確立）:
- **IV度**: 自然に #11（リディアン）になり衝突なし → 拡張和音が最も自然
- **ii度・vi度**（マイナー系）: 自然9th/11th/13th すべて衝突なし
- **I度・V度**: 11thが3rdと衝突 → 11th省略、または I add9/6、V13で11th省略
- **iii度**: 9thが♭9（アヴォイド） → 拡張は避ける
- **vii度**: 9thが♭9 → 拡張はほぼ使わない

ドミナント13thは**11thを省略**、マイナー13thは**11thを保持**が標準。

### 2.3 ボイシングの縮約（確立・実装必須）

1-3-5-7-9-11-13 をクローズドで積むと13thまで**21半音（長13度）**＝人間の手では非現実的。実務は「省略・再配置」:

- **ガイドトーン（3rd・7th）最優先保持** — コードの性質を決める2音
- **5th・root は省略可**（ベースがrootを担当するなら）
- **テンションは機能上意味のある1〜2個に絞る**（dominant13なら13thそのもの）
- **エクステンションは常に上声（7thより上）に置く** — でないと13thが6thに聞こえる
- ルートレス・ヴォイシング Type A（3-5-7-9）/ Type B（7-9-3-5）、Drop 2（上から2番目を1oct下げ、スパン9-10度）

現行の `voiceChord`（MIDI 43-84に収める）は、この「4-5音への圧縮＋root省略」発想と親和的。9th/11th/13th実装時は**素の7音stackを鳴らさず、縮約ロジックを追加**するのが現実的。

---

## 3. ボイスリーディング規則（`voicingCost` 強化）

現行 `voicingCost` は「中心からの距離・ベース距離・移動量・共通音」のみ。以下を**ペナルティスコア**として追加できる（一次教材の姿勢どおり、0/1の禁止ではなくスタイル別に重み可変）。

| 規則 | 内容 | 信頼度 |
|---|---|---|
| 共通音保持・最小移動 | 0（保持）> 半音/全音 > 3度 > それ以上。既存のコスト関数に直結 | 確立 |
| 導音の上行解決 | V/vii の導音（スケール度7）は特に外声で半音上行してトニックへ。導音の**重複禁止** | 確立 |
| 7thの下行解決 | 和声的7th音は下行解決。**重複禁止** | 確立 |
| 並行5度・8度の禁止 | 6声ペアで両声部が同方向かつ両区間がP5/P8なら違反。P5→減5は許容 | 確立 |
| 隠伏5度・8度 | 外声（S-B）が類似運動でP5/P8に到達し、ソプラノが順次でなければ減点 | 広く流布 |
| 声部交差の回避 | S>A>T>B の順序維持。上3声はオクターブ以内 | 確立 |
| 傾向音（弱） | スケール度2,4,6は1,3,5へ下行傾向。**ただし弱い傾向**（soft preference） | 広く流布 |

**スタイル別の反転**: pop/rock/edm では並行5度・プレーニング（並行和声）を**低ペナルティ**に、jazz(バップ)・classical系では**高ペナルティ**に。ジャズのガイドトーン並行（3rd同士・7th同士の並行）は完全音程ではないので許容。

**形式的裏付け**: Tymoczko「効率的ボイスリーディング」（総移動距離最小化＋交差禁止）＝声部割り当てを最適化問題として定式化できる（要検証：原論文PDF直接確認できず）。

---

## 4. 非和声音の分類（`NoteRole` 拡張）

現行 `NoteRole`（chordTone/scaleTone/passing/neighbor/approach）は粒度不足。**「進入（順次/跳躍）× 離脱（順次/跳躍）× 拍の強弱」の3軸**で決定木化できる（確立）。

| 種別 | 進入 | 離脱 | 拍 | 判別キー |
|---|---|---|---|---|
| 経過音 (passing) | 順次 | 順次（同方向） | 主に弱 | approach=step, departure=step, 同方向 |
| 刺繍音 (neighbor) | 順次 | 順次（反対方向） | 主に弱 | 前後が同ピッチ, 反対方向 |
| 倚音 (appoggiatura) | 跳躍 | 順次（反対方向） | **強** | approach=leap, departure=step, 強拍 |
| 逸音 (escape tone) | 順次 | 跳躍（反対方向） | 弱 | approach=step, departure=leap, 弱拍 |
| 掛留音 (suspension) | タイ保持 | 順次**下行** | 強 | 和声変化を跨いで同音保持→下行解決 |
| 遅延音 (retardation) | タイ保持 | 順次**上行** | 強 | suspensionの上行版 |
| 先取音 (anticipation) | 順次 | 保持（次和音の音を先取り） | 弱 | pitch(NCT)==次コードトーン |
| 保続音 (pedal point) | — | — | — | 単一ピッチ持続中に和声が複数回変化 |

補助カテゴリ: 不完全刺繍音、二重刺繍音（changing tones）。掛留音の数値ラベルは 9–8, 7–6, 4–3（最頻）, 2–3。

**設計示唆**: 拍の強弱は主判別軸ではなく「進入/離脱が一致した上での二次分類（accented variant）」として扱う。

---

## 5. ケイデンス（`CadenceType` の精緻化）

| 種別 | 定義 | 現行対応 |
|---|---|---|
| 完全正格 (PAC) | V(根音位置)→I(根音位置)、導音が主音へ、ソプラノが主音 | `authentic`（今回のP0修正で導音を保証済み） |
| 不完全正格 (IAC) | V→I だがPAC条件を1つ以上満たさない（転回、非主音ソプラノ、vii°使用） | `authentic` の下位分類として追加余地 |
| 半終止 (HC) | フレーズがVで終わる | `half` |
| 変終止 (Plagal) | IV→I（長調）/ iv→i（短調） | `plagal` |
| 偽終止 (Deceptive) | V→非トニック（通常vi/VI） | `deceptive` |
| フリギア半終止 | iv6→V（短調のみ、ベースが半音下行） | **未実装**。短調専用の追加候補 |

現行の `CadenceType` は機能的終止のみ。ドリアン/ミクソリディアンの**モーダル終止**（♭VII→i 等）は別概念で、モーダル終止型を追加する余地がある（前回の改善提案書 #2 と整合）。

---

## 6. 実装への落とし込み（優先順位）

調査を踏まえた、コード進行・理論拡張の推奨順:

1. **進行テンプレート選択 UI + データ拡充** — 本文書の1章の度数列を `StylePreset` のテンプレートとして投入。可変長テンプレート対応が必要。ユーザー要望の核心。
2. **7th中心の生成をスタイル既定に** — lo-fi/jazz/R&B プリセットは三和音でなく7thを既定へ。
3. **9th/11th/13th（`ChordQuality`拡張 + アヴォイドノート回避 + 縮約ボイシング）** — 2章。lo-fi/R&B/gospelの表現に必須。
4. **ボイスリーディング評価の強化** — 3章。スタイル別ペナルティ重み。
5. **非和声音の精密分類** — 4章。`NoteRole` 拡張。
6. **モーダル終止・フリギア半終止** — 5章。

---

## 出典

**ジャンル進行**
- [I–V–vi–IV progression — Wikipedia](https://en.wikipedia.org/wiki/I%E2%80%93V%E2%80%93vi%E2%80%93IV_progression)
- [王道進行 / Royal road progression — Wikipedia](https://en.wikipedia.org/wiki/Royal_road_progression)
- [Rhythm changes — Wikipedia](https://en.wikipedia.org/wiki/Rhythm_changes)
- [Turnaround (music) — Wikipedia](https://en.wikipedia.org/wiki/Turnaround_(music))
- [Backdoor progression — Wikipedia](https://en.wikipedia.org/wiki/Backdoor_progression)
- [Tritone substitution — Wikipedia](https://en.wikipedia.org/wiki/Tritone_substitution)
- [Eight-bar blues — Wikipedia](https://en.wikipedia.org/wiki/Eight-bar_blues)
- [Ii–V–I progression — Wikipedia](https://en.wikipedia.org/wiki/Ii%E2%80%93V%E2%80%93I_progression)
- [Exposed: Top 4 Gospel Progressions — Hear and Play](https://hearandplay.com/main/top-4-gospel-progressions/)
- [Top 10 Gospel Chord Progressions — Gospelmaps](https://www.gospelmaps.com/top-gospel-chord-progressions/)
- [Common Gospel Chord Progressions — PianoGroove](https://www.pianogroove.com/blues-piano-lessons/gospel-chord-progressions/)
- [Neo Soul vs RnB Chords — Orange Candy Music](https://orangecandymusic.com/the-difference-between-neo-soul-chords-and-rnb-chords/)
- [5 EDM Chord Progressions — eMastered](https://emastered.com/blog/edm-chord-progressions)
- [Lo-fi chord progressions — Flat](https://blog.flat.io/lofi-chord-progressions/)

**拡張和音**
- [Ninth chord](https://en.wikipedia.org/wiki/Ninth_chord) / [Eleventh chord](https://en.wikipedia.org/wiki/Eleventh_chord) / [Thirteenth chord](https://en.wikipedia.org/wiki/Thirteenth_chord) — Wikipedia
- [Avoid note — Wikipedia](https://en.wikipedia.org/wiki/Avoid_note)
- [Extended Chords and Jazz Harmony — Interactive Chord Finder](https://interactivechordfinder.com/articles/2026021507-extended-chords-jazz-harmony/)
- [Rootless Voicings Type A/B](https://piano.org/theory/rootless-voicings/) / [Drop 2 Voicings](https://piano.org/theory/drop-2-voicings/) — piano.org

**ボイスリーディング**
- [Guide to SATB part-writing — Fundamentals, Function, and Form](https://milnepublishing.geneseo.edu/fundamentals-function-form-workbook/front-matter/guide-to-satb-part-writing/)
- [Jazz Voicings — Open Music Theory (Megan Lavengood)](https://viva.pressbooks.pub/openmusictheory/chapter/jazz-voicings/)
- [Consecutive fifths](https://en.wikipedia.org/wiki/Consecutive_fifths) / [Parallel harmony](https://en.wikipedia.org/wiki/Parallel_harmony) — Wikipedia
- [The Geometry of Musical Chords — Dmitri Tymoczko](https://dmitri.mycpanel.princeton.edu/voiceleading.pdf)（要検証）

**非和声音**
- [Open Music Theory — Embellishing Tones](https://openmusictheory.github.io/embellishingTones.html)
- [Music Theory for the 21st-Century Classroom — Puget Sound](https://musictheory.pugetsound.edu/mt21c/)
- [Nonchord tone — Wikipedia](https://en.wikipedia.org/wiki/Nonchord_tone)

**ケイデンス**
- [Authentic, Half, Plagal, and Deceptive Cadences — Harmony and Musicianship with Solfège](https://pressbooks.pub/harmonyandmusicianshipwithsolfege/chapter/authentic-half-plagal-and-deceptive-cadences/)
- [Cadences in Music Theory — Musicnotes](https://www.musicnotes.com/blog/cadences-in-music-theory-the-4-types-explained/)

---

*作成: 2026-07-23 / Web調査（一部は前回の並列調査エージェント6件の成果を統合）。ジャンル別進行の多くは音楽教育系サイト由来で学術的検証はない点、曲名との紐付けに未確認のものがある点に留意。*
