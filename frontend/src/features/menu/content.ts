/**
 * What the menu shows.
 *
 * Kept as data rather than as markup so the guide, the release notes and the
 * credits can be checked against the app without reading JSX -- and so a claim
 * that stops being true is a line to delete rather than a paragraph to unpick.
 *
 * Everything here describes behaviour that exists. A guide that documents an
 * intention is worse than no guide, because it sends people looking for a
 * control that is not there.
 */

export interface GuideStep {
  title: string;
  body: string;
  /** Where in the app this happens, in the app's own words. */
  where?: string;
}

export interface GuideSection {
  heading: string;
  intro?: string;
  steps: GuideStep[];
}

export const GUIDE: readonly GuideSection[] = [
  {
    heading: "はじめの一曲",
    intro: "設定を触らなくても曲は出ます。まず一度鳴らしてから、気になったところだけ戻って直すのが速いです。",
    steps: [
      {
        title: "「この設定で生成」を押す",
        where: "左の生成設定",
        body: "キー・モード・BPM・拍子・小節数・スタイル・シードから一曲つくります。同じシードと同じ設定なら、何度押しても完全に同じ曲が出ます。偶然に頼らない代わりに、気に入った曲は必ず取り戻せます。",
      },
      {
        title: "再生する",
        where: "上部のトランスポート",
        body: "▶で再生、スペースキーで一時停止、■で停止して先頭に戻ります。コード進行のどこかを選んでいるときも、■を押せば曲全体の再生に戻ります。",
      },
      {
        title: "シードを変えて引き直す",
        where: "生成設定のシード",
        body: "設定はそのままにシードだけ変えると、同じ性格の別の曲が出ます。全部気に入らないときはスタイルを変えるほうが効きます。",
      },
    ],
  },
  {
    heading: "気に入らないところを直す",
    steps: [
      {
        title: "コードを選ぶ",
        where: "コードレーン",
        body: "小節のコードをクリックすると、その小節がループ範囲になります。選んだまま再生すると、その一箇所だけを繰り返し聴けます。",
      },
      {
        title: "別のコードに差し替える",
        where: "コードレーン → 再ハーモナイズ",
        body: "選んだコードに対して、同じ役割を果たす別の候補が出ます。候補は聴いてから決められます。",
      },
      {
        title: "候補 A / B / C を聴き比べる",
        body: "生成のたびに複数案が並びます。選んだ結果は「好みの学習」に溜まり、次からの並び順に反映されます。",
      },
      {
        title: "ノートを直接動かす",
        where: "ピアノロール",
        body: "メロディのノートはドラッグで移動、端をつまんで長さを変えられます。編集は履歴に残るのでUndoで戻せます。",
      },
      {
        title: "自動で整える",
        where: "よく分からなくても、曲を自動で整える",
        body: "何がおかしいか分からないときに使います。検出した問題と、それを直す変更が一覧で出るので、納得したものだけ適用できます。",
      },
    ],
  },
  {
    heading: "編集の反映タイミング",
    intro: "再生しながら編集すると、変更をいつ音に反映するかを選べます。",
    steps: [
      {
        title: "即時 / 次の拍 / 次の小節 / 次のループ",
        where: "編集反映タイミング",
        body: "「即時」は押した瞬間に切り替わるので確認には速く、音楽としては途中で切れます。「次のループ」は聴きながら次の周回で自然に入れ替わります。反映待ちの変更があるときは、状態バーに保留中として出ます。",
      },
    ],
  },
  {
    heading: "メロディから曲をつくる",
    steps: [
      {
        title: "メロディのMIDIを読み込む",
        body: "単旋律のMIDIファイルを渡すと、調を推定して、そのメロディに合うコードを付けた曲になります。ファイルが伴奏込みのときは、いちばんメロディらしい1トラックを選んで使います。",
      },
      {
        title: "読めないファイルは理由を言って断ります",
        body: "フォーマット2（独立した複数シーケンス）とSMPTEタイム（映像フレーム基準）は、推測すると全部のノートがずれるので受け付けません。読み込みに失敗しても、いま開いている曲は変わりません。",
      },
    ],
  },
  {
    heading: "書き出しと保存",
    steps: [
      {
        title: "MIDIで書き出す",
        body: "ベース／コード／メロディが別トラックで出ます。DAWでそのまま開けます。鳴っている音と書き出される音は同じものです。",
      },
      {
        title: "JSONで書き出す・読み込む",
        body: "設定と編集内容をまとめて持ち運べます。同じJSONからは同じ曲が復元されます。",
      },
      {
        title: "自動保存",
        where: "状態バーの「保存」",
        body: "編集はブラウザ内に自動保存されます。残り容量も同じ場所に出ます。ブラウザのデータを消すと消えるので、残したいものはJSONで書き出してください。",
      },
    ],
  },
  {
    heading: "困ったとき",
    steps: [
      {
        title: "音が出ない",
        body: "ブラウザは操作なしに音を鳴らせない決まりなので、まずページ内を一度クリックしてから再生してください。それでも駄目なら環境診断を開くと、音声の初期化に失敗した理由が出ます。",
      },
      {
        title: "動作環境を確認する",
        where: "環境診断",
        body: "ブラウザの対応状況、保存の状態、接続先を一覧で確認できます。生成はすべてブラウザ内で完結するので、サーバに繋がっていなくても曲はつくれます。",
      },
    ],
  },
];

export interface ReleaseNote {
  version: string;
  date: string;
  headline: string;
  changes: readonly string[];
}

/**
 * What changed, in terms of what it does rather than what was edited.
 *
 * Entries name the effect a listener or a user can notice. "Refactored the
 * voicing selector" belongs in the git log; "the chorus is now played higher
 * than the verse" belongs here.
 */
export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: "0.4.0",
    date: "2026-08",
    headline: "伴奏の鳴り方と、曲の展開",
    changes: [
      "アルペジオがペダルのように音を保持するようになりました。これまでは和音を単音の列に分解して弾いており、ボイシングが一度も和音として鳴っていませんでした。3音以上が同時に鳴っている時間が0%から63%になります。",
      "サビの伴奏がAメロより高い音域で鳴るようになりました。セクションごとの音域差は、これまで音量にだけ付いていたものです。",
      "ピアノで最も普通の押さえ方（左手ルート＋5度、右手はその上のコード）を候補に追加しました。この幅のボイシングは、これまで一つも生成されていませんでした。",
      "既定の設定をすべて有効にしました。ボイシング、テンション、強弱、曲構成、グルーヴは、これまで一つずつ手で有効にしないと使われませんでした。",
      "短調に専用のコード進行の重みを与えました。長調用の表を流用していたため、短調の曲が長調的な進行になりがちでした。",
      "同じセクションが毎回同じ進行を返す問題を直しました。長調のブリッジのバリエーションが1種類から8種類になります。",
      "メロディMIDIの読み込みを追加しました。",
      "進行トラックでコードを選んだあと、停止ボタンで曲の先頭から再生できない問題を直しました。",
      "メニューを追加しました（このページです）。音量などの設定はここにあります。",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-07",
    headline: "ボイシングと音づくり",
    changes: [
      "ボイシングを「指定するもの」から「曲に合わせて選ばれるもの」に変えました。ドロップ、スプレッド、シェル、ルートレス、4度堆積などの形を候補として並べ、その場に最も合うものが選ばれます。",
      "ボイシングがメロディの位置を見るようになりました。和音の最高音がメロディを覆うと、書いたはずの旋律が texture に埋もれます。",
      "低音程限界を守るようになりました。低い音域で狭い音程を重ねると、和音ではなく濁りとして聞こえます。",
      "全シンセを共通のエフェクトバス（リバーブ→コンプレッサ→リミッタ）経由にしました。",
      "ベーストラックがベースの音域で鳴るようになりました。",
      "コードとベースに強弱が付きました。",
      "コードレーンから再ハーモナイズ候補を出せるようになりました。",
      "編集履歴の保存先をIndexedDBに移し、大きな曲でも保存が詰まらなくなりました。",
    ],
  },
];

export interface Credit {
  name: string;
  version?: string;
  license: string;
  url: string;
  note?: string;
}

/**
 * What this app is built on.
 *
 * Versions are the ones in package.json at the time of writing rather than
 * read at runtime -- the bundle does not carry the manifest, and a credits page
 * that silently reports the wrong version is worse than one that is plainly a
 * snapshot.
 */
export const RUNTIME_CREDITS: readonly Credit[] = [
  { name: "React", version: "19.2", license: "MIT", url: "https://react.dev/" },
  { name: "React DOM", version: "19.2", license: "MIT", url: "https://react.dev/" },
  { name: "Tone.js", version: "15.1", license: "MIT", url: "https://tonejs.github.io/", note: "再生とシンセ" },
  { name: "@tonejs/midi", version: "2.0", license: "MIT", url: "https://github.com/Tonejs/Midi", note: "MIDI書き出し" },
  { name: "Tonal", version: "4.10", license: "MIT", url: "https://github.com/tonaljs/tonal", note: "音楽理論の基礎計算" },
  { name: "Zustand", version: "5.0", license: "MIT", url: "https://zustand.docs.pmnd.rs/", note: "状態管理" },
];

export const BUILD_CREDITS: readonly Credit[] = [
  { name: "TypeScript", version: "6.0", license: "Apache-2.0", url: "https://www.typescriptlang.org/" },
  { name: "Vite", version: "8.1", license: "MIT", url: "https://vite.dev/" },
  { name: "Vitest", version: "4.1", license: "MIT", url: "https://vitest.dev/" },
  { name: "ESLint", license: "MIT", url: "https://eslint.org/" },
  { name: "Playwright", license: "Apache-2.0", url: "https://playwright.dev/", note: "ブラウザ結合テスト" },
];

/**
 * Where the music itself comes from, which is not a dependency question.
 *
 * No corpus ships with this app and none was copied into it. The entries below
 * are here because they were consulted, and because saying "trained on nothing"
 * would be as misleading as claiming a model that does not exist.
 */
export const MUSIC_CREDITS: readonly Credit[] = [
  {
    name: "Standard MIDI File 1.0",
    license: "仕様",
    url: "https://midi.org/standard-midi-files",
    note: "読み書きは仕様から自前で実装しています。外部のパーサは使っていません。",
  },
  {
    name: "Krumhansl–Schmuckler key profiles",
    license: "発表済みの研究",
    url: "https://en.wikipedia.org/wiki/Krumhansl-Schmuckler_key-finding_algorithm",
    note: "メロディからの調推定に使っている音度分布。",
  },
  {
    name: "Mutopia Project",
    license: "Public Domain / Creative Commons",
    url: "https://www.mutopiaproject.org/",
    note: "ボイシングの実測に参照。曲データは同梱していません。",
  },
  {
    name: "MAESTRO (Google Magenta)",
    license: "CC BY-NC-SA 4.0",
    url: "https://magenta.withgoogle.com/datasets/maestro",
    note: "同上。参照した数値は採用しなかったため、この由来の値はアプリに入っていません。",
  },
];
