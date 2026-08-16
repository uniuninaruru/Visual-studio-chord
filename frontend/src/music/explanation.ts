import type {
  ChordEvent,
  GeneratedComposition,
  HarmonyFunction,
  SectionEvent,
  SectionKind,
} from "../types/music";
import { getProgressionTemplate } from "./progressions";

/**
 * Why the piece is what it is, said in the app's own words.
 *
 * The engine already knows. Every chord carries its roman numeral, its
 * harmonic function, where it was borrowed from and what it resolves to;
 * every section carries the named progression it was built from. None of it
 * was ever shown: measured across 171 chords of the shipped defaults, 44%
 * carried an `explanation` string and the rest carried none, because
 * validateComposition only requires one for chords that are not diatonic. The
 * ones that existed read "Slash chord: Em7 over B." -- true, mechanical, and
 * silent about why that chord is there.
 *
 * Computed rather than stored, for three reasons. It needs the whole piece --
 * which section a chord is in, what follows it, which progression it came
 * from -- and a per-chord field cannot see any of that. Writing it into the
 * composition would change the composition, and a piece's identity is its
 * seed and settings rather than how well it can describe itself. And it is
 * the context an assistant would need anyway, so it is built as data first
 * and prose second.
 */

const FUNCTION_LABEL: Readonly<Record<HarmonyFunction, string>> = {
  tonic: "トニック",
  predominant: "サブドミナント",
  dominant: "ドミナント",
  other: "その他",
};

/**
 * The three functions, in the terms function theory states them.
 *
 * Riemann's function theory groups every chord of a key under tonic,
 * subdominant or dominant, and the canonical motion is stability, then
 * departure, then tension, then resolution. Stated that way rather than as
 * "the chord that feels nice", because the point of naming a function is that
 * it predicts what comes next.
 */
const FUNCTION_ROLE: Readonly<Record<HarmonyFunction, string>> = {
  tonic: "安定。ここに来ると一段落し、どこへでも進めます。",
  predominant: "変化。安定から離れ、ドミナントへ向かう準備をします。",
  dominant: "緊張。トニックへ解決しようとする力が最も強い機能です。",
  other: "三機能の外。調の外の音を持ち込んで色を変えます。",
};

export const SECTION_LABEL: Readonly<Record<SectionKind, string>> = {
  intro: "イントロ",
  verse: "Aメロ",
  preChorus: "Bメロ",
  chorus: "サビ",
  bridge: "ブリッジ",
  quietChorus: "落ちサビ",
  finalChorus: "大サビ",
  outro: "アウトロ",
};

const SECTION_ROLE: Readonly<Record<SectionKind, string>> = {
  intro: "曲の入り口。まだ何も主張しない",
  verse: "話を始めるところ。音域も強弱も控えめ",
  preChorus: "サビへの橋渡し。緊張を溜める",
  chorus: "曲の頂点。いちばん高く、いちばん強い",
  bridge: "対比。登るのではなく別のことを言う",
  quietChorus: "サビと同じ和音を、音を減らして低く。次の頂点のために一度落とす",
  finalChorus: "最後のサビ。曲全体でいちばん高く、いちばん強い",
  outro: "閉じるところ",
};

/**
 * One statement about a chord, and the body of theory it comes from.
 *
 * The source is carried rather than implied. Everything else in this app that
 * makes a claim about music names where the claim comes from -- the
 * progression catalogue admits nothing without independent sources, the low
 * interval limits cite the standard orchestration table, the key finder names
 * Krumhansl-Schmuckler -- and an explanation shown to a user learning theory
 * should be held to the same bar rather than a lower one.
 */
export interface ExplanationReason {
  text: string;
  /** The area of theory this is standard in, for a reader who wants to look it up. */
  source: string;
}

export interface ChordExplanation {
  chordId: string;
  symbol: string;
  romanNumeral: string;
  bar: number;
  /** One line naming what this chord is. */
  headline: string;
  /** Why it is here, most specific first. */
  reasons: readonly ExplanationReason[];
}

export interface SectionExplanation {
  kind: SectionKind;
  label: string;
  startBar: number;
  endBar: number;
  /** The named progression it was built from, where it had one. */
  progressionLabel?: string;
  progressionId?: string;
  reasons: readonly ExplanationReason[];
}

export interface CompositionExplanation {
  key: string;
  mode: string;
  style: string;
  bars: number;
  bpm: number;
  timeSignature: string;
  cadence: string;
  sections: readonly SectionExplanation[];
  chords: readonly ChordExplanation[];
  /** Everything above as prose, which is what a reader wants and what an assistant is given. */
  text: string;
}

const MODE_LABEL: Readonly<Record<string, string>> = {
  major: "メジャー",
  naturalMinor: "ナチュラルマイナー",
  harmonicMinor: "ハーモニックマイナー",
  dorian: "ドリアン",
  mixolydian: "ミクソリディアン",
};

const CADENCE_LABEL: Readonly<Record<string, string>> = {
  authentic: "完全終止",
  plagal: "変格終止（アーメン終止）",
  half: "半終止",
  deceptive: "偽終止",
  loop: "終止させない循環",
};

const TENSION_NOTE: Readonly<Record<string, string>> = {
  "9": "9th",
  b9: "♭9th",
  "#9": "♯9th",
  "11": "11th",
  "#11": "♯11th",
  "13": "13th",
  b13: "♭13th",
  "6": "6th",
};

function sectionAt(
  composition: GeneratedComposition,
  chord: ChordEvent,
): SectionEvent | undefined {
  const bar = Math.floor(chord.startTick / composition.ticksPerBar);
  return composition.sections?.find((entry) => bar >= entry.startBar && bar < entry.endBar);
}

/**
 * One chord, and why it is where it is.
 *
 * Ordered most specific first: a borrowed chord's reason for existing is that
 * it was borrowed, not that it is a subdominant. The general facts come last
 * because they are true of many chords and say least about this one.
 */
export function explainChord(
  composition: GeneratedComposition,
  chord: ChordEvent,
): ChordExplanation {
  const bar = Math.floor(chord.startTick / composition.ticksPerBar) + 1;
  const section = sectionAt(composition, chord);
  const reasons: ExplanationReason[] = [];

  // What makes this chord itself, before what makes it ordinary.
  if (chord.specialKind === "secondaryDominant" || chord.source === "secondaryDominant") {
    const target = chord.targetDegree;
    // Standard definition: a dominant seventh built on the fifth above a
    // degree that is not the tonic, treating that degree as a temporary tonic.
    // The term for that treatment is tonicization.
    reasons.push({
      text: target === undefined
        ? "セカンダリードミナント。直後の和音を一時的な主和音とみなし（トニサイズ）、そこへ5度下行で解決します。"
        : `セカンダリードミナント（V7/${target}）。${target}度を一時的な主和音とみなし、5度下行で解決します。`,
      source: "機能和声：副属和音（セカンダリードミナント）",
    });
  }
  if (chord.specialKind === "tritoneSubstitution") {
    // The defining property is not "contains a tritone" but that the two
    // chords share the *same* tritone, with the third and seventh exchanged:
    // in C, G7 and D♭7 both hold B-F, as 3rd/7th and 7th/3rd respectively.
    // Replacing the home dominant always gives ♭II7, whose root is a semitone
    // above the tonic -- which is where the chromatic bass step comes from.
    reasons.push({
      text: "トライトーン代理。元のドミナントと同じ三全音を共有し、3度と7度が入れ替わります"
        + "（Cメジャーなら G7 と D♭7 がともに B–F を持つ）。根音が主音の半音上に来るため、"
        + "ベースが半音下行で解決します。",
      source: "ジャズ和声：トライトーン代理（♭II7）",
    });
  }
  if (chord.source === "borrowed" || chord.specialKind === "borrowed") {
    reasons.push({
      text: chord.borrowedFromMode
        ? `モーダルインターチェンジ。同主調（${MODE_LABEL[chord.borrowedFromMode] ?? chord.borrowedFromMode}）`
          + "から借りた和音で、主音は変えずに調外の音を持ち込みます。"
        : "モーダルインターチェンジ。同主調から借りた和音で、主音は変えずに調外の音を持ち込みます。",
      source: "モーダルインターチェンジ（借用和音）",
    });
  }
  if (chord.specialKind === "passingDiminished") {
    reasons.push({
      text: "パッシングディミニッシュ。全音で隣り合う2つの和音の間を半音で埋める経過和音です。"
        + "減七和音は短3度の積み重ねで、どの構成音からでも半音上行で解決できます。",
      source: "和声法：経過的減七和音",
    });
  }
  if (chord.specialKind === "suspended") {
    reasons.push({
      text: "サスペンデッド。3度を2度または4度に置き換えた和音で、長短の区別を保留します。"
        + "元は掛留（前の和音の音を保持して遅れて解決する）から来た形です。",
      source: "和声法：掛留とサスペンデッド和音",
    });
  }
  if (chord.bass) {
    reasons.push({
      text: `分数コード（${chord.symbol}）。最低音が根音ではなく ${chord.bass} です。`
        + "和音の機能は保ったまま、ベースの動きを独立した線として扱えます。",
      source: "和声法：転回形と分数コード",
    });
  }
  if (chord.tensions?.length) {
    const names = chord.tensions.map((tension) => TENSION_NOTE[tension] ?? tension).join("・");
    reasons.push({
      text: `${names} を付加。3度堆積を7度より上へ延長した音で、和音の機能は変えずに響きだけを変えます。`,
      source: "ジャズ和声：テンション（上部構造）",
    });
  }
  // The roman numeral is where a chromatic root always shows, whatever the
  // engine did or did not record about how it got there. Said only when
  // nothing more specific has already been said, so a secondary dominant is
  // not also announced as "a chord outside the key".
  if (reasons.length === 0 && /^[♭♯b#]/.test(chord.romanNumeral)) {
    reasons.push({
      text: `${chord.romanNumeral}。根音が調の音階外にある非ダイアトニック和音です。`,
      source: "和声法：非ダイアトニック和音",
    });
  }
  if (chord.transformation) {
    // P/L/R each move one voice by a step and hold the other two, which is the
    // property the theory is built on.
    reasons.push({
      text: `ネオ・リーマン変換 ${chord.transformation.operation}。`
        + `${chord.transformation.fromRoot}${chord.transformation.fromQuality === "minor" ? "m" : ""} から、`
        + "3声のうち2声を保ったまま残り1声だけを動かして移ります。",
      source: "新リーマン理論：P / L / R 変換",
    });
  }

  // Where it sits, which is the part a per-chord field could never say.
  if (section) {
    const template = section.progressionId
      ? getProgressionTemplate(section.progressionId)
      : undefined;
    const position = composition.chords
      .filter((entry) => sectionAt(composition, entry) === section)
      .findIndex((entry) => entry.id === chord.id);
    if (template && position >= 0) {
      // Counted into the progression's own cycle. A section holds more chords
      // than its progression has steps whenever the harmonic rhythm splits a
      // bar, and "the 4th chord of a three-chord progression" is a sentence
      // that should never have been printed.
      const cycle = template.steps.length;
      const within = (position % cycle) + 1;
      const lap = Math.floor(position / cycle) + 1;
      reasons.push({
        text: `${SECTION_LABEL[section.kind]}に置いた「${template.label}」の`
          + (lap > 1 ? `${lap}周目 ` : "")
          + `${within}番目の和音です。`,
        source: "このアプリの進行カタログ",
      });
    } else {
      reasons.push({
        text: `${SECTION_LABEL[section.kind]}の和音です。`,
        source: "このアプリの曲構成",
      });
    }
    if (section.transpose !== 0) {
      reasons.push({
        text: `このセクションは元の調から${section.transpose > 0 ? "上" : "下"}へ`
          + `${Math.abs(section.transpose)}半音転調しています。`,
        source: "このアプリの曲構成",
      });
    }
  }

  // The general facts, last, because they are true of many chords.
  reasons.push({
    text: `機能は${FUNCTION_LABEL[chord.function]}。${FUNCTION_ROLE[chord.function]}`,
    source: "機能和声：三機能",
  });
  if (chord.inversion > 0) {
    reasons.push({
      text: `第${chord.inversion}転回形。根音以外の構成音が最低音に来る形で、`
        + "根音のままより低音の跳躍が小さくなります。",
      source: "和声法：転回形",
    });
  }

  const headline = `${chord.symbol}（${chord.romanNumeral}）`;
  return { chordId: chord.id, symbol: chord.symbol, romanNumeral: chord.romanNumeral, bar, headline, reasons };
}

function explainSection(section: SectionEvent): SectionExplanation {
  const template = section.progressionId
    ? getProgressionTemplate(section.progressionId)
    : undefined;
  const reasons: ExplanationReason[] = [
    { text: SECTION_ROLE[section.kind], source: "ポピュラー編曲：セクションの役割" },
  ];
  if (template) {
    reasons.push({
      text: `進行は「${template.label}」`
        + (template.numeric ? `（${template.numeric}）` : "")
        + "。",
      source: "このアプリの進行カタログ",
    });
  }
  if (section.transpose !== 0) {
    reasons.push({
      text: `元の調から${section.transpose > 0 ? "+" : ""}${section.transpose}半音。`,
      source: "このアプリの曲構成",
    });
  }
  if (section.melodyMode && section.melodyMode !== section.mode) {
    reasons.push({
      text: `メロディだけ${MODE_LABEL[section.melodyMode] ?? section.melodyMode}で動きます（複調）。`,
      source: "このアプリの曲構成",
    });
  }
  return {
    kind: section.kind,
    label: SECTION_LABEL[section.kind],
    startBar: section.startBar + 1,
    endBar: section.endBar,
    progressionLabel: template?.label,
    progressionId: section.progressionId,
    reasons,
  };
}

/**
 * The whole piece explained.
 *
 * The prose is assembled from the same structures rather than written
 * separately, so the text and the data cannot drift apart -- and it is the
 * text an assistant is handed, which means what the user reads on screen is
 * exactly what would be sent.
 */
export function explainComposition(
  composition: GeneratedComposition,
): CompositionExplanation {
  const sections = (composition.sections ?? []).map(explainSection);
  const chords = composition.chords.map((chord) => explainChord(composition, chord));
  const settings = composition.settings;

  const lines: string[] = [];
  lines.push(
    `${settings.key} ${MODE_LABEL[settings.mode] ?? settings.mode}、`
    + `${settings.bpm} BPM、${settings.timeSignature}、${settings.bars}小節。`
    + `スタイルは ${composition.resolvedStyle}。`
    + `終止は${CADENCE_LABEL[composition.cadence] ?? composition.cadence}。`,
  );

  if (sections.length > 0) {
    lines.push("");
    lines.push("【構成】");
    for (const section of sections) {
      lines.push(
        `${section.startBar}〜${section.endBar}小節 ${section.label}: `
        + section.reasons.map((reason) => reason.text).join(" "),
      );
    }
  }

  lines.push("");
  lines.push("【コード】");
  for (const chord of chords) {
    lines.push(`${chord.bar}小節目 ${chord.headline}`);
    for (const reason of chord.reasons) lines.push(`  - ${reason.text}［${reason.source}］`);
  }

  return {
    key: settings.key,
    mode: MODE_LABEL[settings.mode] ?? settings.mode,
    style: composition.resolvedStyle,
    bars: settings.bars,
    bpm: settings.bpm,
    timeSignature: settings.timeSignature,
    cadence: CADENCE_LABEL[composition.cadence] ?? composition.cadence,
    sections,
    chords,
    text: lines.join("\n"),
  };
}
