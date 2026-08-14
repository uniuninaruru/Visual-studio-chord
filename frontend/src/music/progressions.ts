import type {
  Mode,
  ProgressionStep,
  ProgressionTemplate,
} from "../types/music";

/**
 * Named chord progressions gathered in docs/research/.
 *
 * Only progressions that multiple independent practitioner sources describe
 * with the same name *and* the same degrees are included. Individual song
 * transcriptions are deliberately excluded: cross-checking them against their
 * sources turned up mislabelling and disagreement often enough that they are
 * not safe as engine primitives.
 *
 * Degrees are 1-7 with an optional `alteration` for chromatic roots (bVI, bVII,
 * #IV). `quality` pins a chord that is not the diatonic default, which is what
 * makes the Marunouchi III7 or a Blackadder augmented actually reproducible.
 */

/**
 * Ionian only. Mixolydian is deliberately excluded from these: its diatonic
 * degrees differ (iii is diminished and v is minor), so a template that pins
 * `iii7` or `V7` describes chords mixolydian does not contain.
 */
const MAJOR: readonly Mode[] = ["major"];
/**
 * Templates whose degrees stay valid over a flat-seventh major scale — those
 * that only touch I, IV, vi and ii, or that pin every non-diatonic quality
 * explicitly.
 */
const MAJOR_AND_MIXO: readonly Mode[] = ["major", "mixolydian"];
const MINOR: readonly Mode[] = ["naturalMinor", "harmonicMinor", "dorian"];
const ALL: readonly Mode[] = [
  "major",
  "naturalMinor",
  "harmonicMinor",
  "dorian",
  "mixolydian",
];

function step(
  degree: number,
  extra: Omit<ProgressionStep, "degree"> = {},
): ProgressionStep {
  return { degree, ...extra };
}

export const PROGRESSION_TEMPLATES: readonly ProgressionTemplate[] = [
  // ---------------------------------------------------------------- J-POP core
  {
    id: "royal-road",
    label: "王道進行",
    numeric: "4536",
    usage: "chorus",
    modes: MAJOR,
    steps: [
      step(4, { quality: "major7" }),
      step(5, { quality: "dominant7" }),
      step(3, { quality: "minor7" }),
      step(6),
    ],
  },
  {
    id: "royal-road-triads",
    label: "王道進行（三和音）",
    numeric: "4536",
    usage: "chorus",
    modes: MAJOR_AND_MIXO,
    steps: [step(4), step(5), step(3), step(6)],
  },
  {
    id: "royal-road-resolved",
    label: "王道進行（解決形）",
    usage: "chorus",
    modes: MAJOR,
    steps: [
      step(4, { quality: "major7" }),
      step(5, { quality: "dominant7" }),
      step(3, { quality: "minor7" }),
      step(6),
      step(2, { quality: "minor7" }),
      step(5, { quality: "dominant7" }),
      step(1, { quality: "major7" }),
    ],
  },
  {
    id: "komuro",
    label: "小室進行",
    numeric: "6451",
    usage: "chorus",
    modes: MAJOR_AND_MIXO,
    steps: [step(6), step(4), step(5), step(1)],
  },
  {
    id: "marunouchi",
    label: "丸サ進行 / Just the Two of Us",
    numeric: "4361",
    usage: "any",
    modes: MAJOR,
    steps: [
      step(4, { quality: "major7" }),
      // III7 tonicises the relative minor; this is the defining move.
      step(3, {
        quality: "dominant7",
        role: "secondaryDominant",
        targetDegree: 6,
      }),
      step(6, { quality: "minor7" }),
      step(1, { quality: "dominant7", role: "secondaryDominant", targetDegree: 4 }),
    ],
  },
  {
    id: "canon",
    label: "カノン進行",
    usage: "chorus",
    modes: MAJOR_AND_MIXO,
    steps: [
      step(1),
      step(5),
      step(6),
      step(3),
      step(4),
      step(1),
      step(4),
      step(5),
    ],
  },
  {
    id: "canon-descending-bass",
    label: "カノン進行（下降ベース）",
    usage: "verse",
    modes: MAJOR,
    steps: [
      step(1),
      step(3, { quality: "minor7", bassDegree: 7 }),
      step(6),
      step(6, { quality: "minor7", bassDegree: 5 }),
      step(4),
      step(1, { bassDegree: 3 }),
      step(2, { quality: "minor7" }),
      step(5),
    ],
  },
  {
    id: "circulation",
    label: "循環コード",
    numeric: "1625",
    usage: "verse",
    modes: MAJOR_AND_MIXO,
    steps: [step(1), step(6), step(2), step(5)],
  },
  {
    id: "asia-favourite",
    label: "I–III–vi",
    usage: "verse",
    modes: MAJOR,
    steps: [
      step(1),
      // A bare major III (not III7) still tonicises vi, but the validator
      // reserves the secondaryDominant role for actual dominant sevenths, so
      // this is tagged as the chromatic alteration it literally is.
      step(3, { quality: "major", role: "chromatic", targetDegree: 6 }),
      step(6),
    ],
  },

  // ------------------------------------------------------------------ Pop/rock
  {
    id: "axis",
    label: "Axis (I–V–vi–IV)",
    usage: "chorus",
    modes: MAJOR_AND_MIXO,
    steps: [step(1), step(5), step(6), step(4)],
  },
  {
    id: "axis-rotation-vi",
    label: "Axis 回転 (vi–IV–I–V)",
    usage: "any",
    modes: MAJOR_AND_MIXO,
    steps: [step(6), step(4), step(1), step(5)],
  },
  {
    id: "fifties",
    label: "50s / Doo-wop (I–vi–IV–V)",
    usage: "any",
    modes: MAJOR_AND_MIXO,
    steps: [step(1), step(6), step(4), step(5)],
  },
  {
    id: "mixolydian-bVII",
    label: "I–V–♭VII–IV",
    usage: "any",
    modes: MAJOR_AND_MIXO,
    steps: [
      step(1),
      step(5),
      step(7, { alteration: -1, role: "chromatic" }),
      step(4),
    ],
  },
  {
    id: "rock-VI-VII-i",
    label: "VI–VII–i（ロック/アクション）",
    usage: "chorus",
    modes: MINOR,
    steps: [step(6), step(7), step(1)],
  },

  // ------------------------------------------------------- Devices / colourful
  {
    id: "cliche-descending",
    label: "クリシェ（下降）",
    usage: "verse",
    modes: ALL,
    steps: [
      step(1),
      step(1, { quality: "major7" }),
      step(1, { quality: "dominant7" }),
      step(1, { tensions: ["6"] }),
    ],
  },
  {
    id: "passing-diminished",
    label: "パッシングディミニッシュ",
    usage: "any",
    modes: MAJOR_AND_MIXO,
    steps: [
      step(1),
      step(1, {
        alteration: 1,
        quality: "diminished7",
        role: "passingDiminished",
      }),
      step(2, { quality: "minor7" }),
    ],
  },
  {
    id: "subdominant-minor",
    label: "サブドミナントマイナー (IV–iv–I)",
    usage: "any",
    // Ionian only: the borrowed iv comes from the parallel minor, and
    // mixolydian's parallel is major, whose IV is already major.
    modes: MAJOR,
    steps: [
      step(4),
      step(4, { quality: "minor", role: "borrowed" }),
      step(1),
    ],
  },
  {
    id: "backdoor",
    label: "バックドア進行 (iv7–♭VII7–I)",
    usage: "any",
    modes: MAJOR,
    steps: [
      // iv7 is the parallel minor's fourth degree with a seventh added. The
      // validator's borrowed rule compares against the parallel mode's plain
      // triad, so this is tagged chromatic and explained on its own terms.
      step(4, { quality: "minor7", role: "chromatic" }),
      step(7, { alteration: -1, quality: "dominant7", role: "chromatic" }),
      step(1, { quality: "major7" }),
    ],
  },
  {
    id: "tritone-sub",
    label: "トライトーン代理 (ii–♭II7–I)",
    usage: "any",
    modes: MAJOR_AND_MIXO,
    steps: [
      step(2, { quality: "minor7" }),
      step(2, {
        alteration: -1,
        quality: "dominant7",
        role: "tritoneSubstitution",
        targetDegree: 1,
      }),
      step(1, { quality: "major7" }),
    ],
  },
  {
    id: "blackadder",
    label: "ブラックアダーコード (Vaug/♭II–I)",
    usage: "any",
    modes: MAJOR_AND_MIXO,
    steps: [
      // Vaug over a bII bass: three semitone resolutions into the tonic.
      step(5, {
        quality: "augmented",
        bassDegree: 2,
        bassAlteration: -1,
        role: "chromatic",
        targetDegree: 1,
      }),
      step(1, { quality: "major7" }),
    ],
  },
  {
    id: "gospel-train",
    label: "ゴスペル・トレイン（下降ベース）",
    usage: "any",
    modes: MAJOR_AND_MIXO,
    steps: [
      step(1),
      step(1, { bassDegree: 7 }),
      step(6),
      step(6, { bassDegree: 5 }),
      step(4),
      step(4, { bassDegree: 3 }),
      step(2, { quality: "minor7" }),
      step(5),
    ],
  },
  {
    id: "gospel-1625-ninths",
    label: "ゴスペル 1-6-2-5（9th化）",
    usage: "any",
    modes: MAJOR,
    steps: [
      step(1, { quality: "major7", tensions: ["9"] }),
      step(6, { quality: "minor7", tensions: ["9"] }),
      step(2, { quality: "minor7", tensions: ["9"] }),
      step(5, { quality: "dominant7", tensions: ["b9"] }),
    ],
  },
  {
    id: "secondary-dominant-145",
    label: "I–IV–V + セカンダリードミナント",
    usage: "any",
    modes: MAJOR,
    steps: [
      step(1),
      step(1, { quality: "dominant7", role: "secondaryDominant", targetDegree: 4 }),
      step(4),
      step(2, { quality: "dominant7", role: "secondaryDominant", targetDegree: 5 }),
      step(5),
      step(1),
    ],
  },

  // --------------------------------------------------------------- Jazz / city
  {
    id: "ii-V-I",
    label: "ii–V–I",
    usage: "any",
    modes: MAJOR,
    steps: [
      step(2, { quality: "minor7" }),
      step(5, { quality: "dominant7" }),
      step(1, { quality: "major7" }),
    ],
  },
  {
    id: "ii-V-i-minor",
    label: "ii–V–i（短調）",
    usage: "any",
    modes: MINOR,
    steps: [
      step(2, { quality: "halfDiminished7" }),
      step(5, { quality: "dominant7", tensions: ["b9"] }),
      step(1, { quality: "minor7" }),
    ],
  },
  {
    id: "city-pop-plastic",
    label: "City pop（ii9–V7♭9–iii7–vi7）",
    usage: "verse",
    modes: MAJOR,
    steps: [
      step(2, { quality: "minor7", tensions: ["9"] }),
      step(5, { quality: "dominant7", tensions: ["b9"] }),
      step(3, { quality: "minor7" }),
      step(6, { quality: "minor7" }),
    ],
  },
  {
    id: "rhythm-changes-bridge",
    label: "リズムチェンジェス ブリッジ（ドミナント連鎖）",
    usage: "bridge",
    modes: MAJOR,
    steps: [
      step(3, { quality: "dominant7", role: "secondaryDominant", targetDegree: 6 }),
      step(6, { quality: "dominant7", role: "secondaryDominant", targetDegree: 2 }),
      step(2, { quality: "dominant7", role: "secondaryDominant", targetDegree: 5 }),
      step(5, { quality: "dominant7" }),
    ],
  },
  {
    id: "blues-12-bar",
    label: "12小節ブルース",
    usage: "any",
    modes: MAJOR,
    steps: [
      step(1, { quality: "dominant7" }),
      step(1, { quality: "dominant7" }),
      step(1, { quality: "dominant7" }),
      step(1, { quality: "dominant7" }),
      step(4, { quality: "dominant7" }),
      step(4, { quality: "dominant7" }),
      step(1, { quality: "dominant7" }),
      step(1, { quality: "dominant7" }),
      step(5, { quality: "dominant7" }),
      step(4, { quality: "dominant7" }),
      step(1, { quality: "dominant7" }),
      step(5, { quality: "dominant7" }),
    ],
  },

  // ----------------------------------------------------- Kawaii / lush diatonic
  {
    id: "kawaii-add9-axis",
    label: "Kawaii future bass（add9 装飾 Axis）",
    usage: "chorus",
    modes: MAJOR_AND_MIXO,
    steps: [
      step(1, { quality: "add9" }),
      step(5, { quality: "add9" }),
      step(6, { quality: "minor7" }),
      step(4, { quality: "major7" }),
    ],
  },
  {
    id: "neo-soul-upgrade",
    label: "ネオソウル（テンション格上げ）",
    usage: "any",
    modes: MAJOR,
    steps: [
      step(4, { quality: "major7", tensions: ["9"] }),
      step(2, { quality: "dominant7", tensions: ["#9"] }),
      step(5, { quality: "minor7", tensions: ["11"] }),
      step(1, { quality: "dominant7", tensions: ["13", "b9"] }),
    ],
  },

  // ------------------------------------------------------------- Minor / modal
  {
    id: "kanaria-phrygian",
    label: "i–♭III–♭VI–V（フリギア半終止）",
    usage: "chorus",
    modes: MINOR,
    steps: [
      step(1),
      // In natural/harmonic minor, degrees 3 and 6 are already the bIII and bVI
      // of the parallel major, so no alteration is needed here.
      step(3, { quality: "major" }),
      step(6, { quality: "major" }),
      // A major V in minor is the harmonic-minor dominant (Phrygian half cadence).
      step(5, { quality: "major" }),
    ],
  },
  {
    id: "minor-descending",
    label: "i–VII–VI–V（下降）",
    usage: "any",
    modes: MINOR,
    steps: [step(1), step(7), step(6), step(5, { quality: "major" })],
  },

  // ------------------------------------------------------------ minor, added
  //
  // The catalogue held five templates a minor key could use, against
  // twenty-nine for a major one, and a minor bridge therefore had two
  // progressions to choose between however many pieces were generated. These
  // four clear the same bar as everything above: two or more independent
  // practitioner sources describing the same degrees.
  //
  // Their `usage` is "any" because that is what the sources say. None of them
  // calls a progression a bridge progression, and marking one as such to fill
  // the tier would be inventing the evidence the catalogue exists to require.
  // A bridge draws from "bridge" then "any", so widening "any" is what reaches
  // it honestly.
  {
    id: "minor-three-chord",
    label: "i–iv–v–i（短調スリーコード）",
    numeric: "1451",
    usage: "any",
    modes: MINOR,
    // The most heavily attested of the four: four independent sources give it,
    // two of them naming it as the minor three-chord progression.
    steps: [step(1), step(4), step(5), step(1)],
  },
  {
    id: "minor-VI-III-VII",
    label: "i–♭VI–♭III–♭VII",
    usage: "any",
    modes: MINOR,
    // Am–F–C–G. The same four chords as the major-key axis progressions, heard
    // from the relative minor, which is why it is as common as it is.
    steps: [step(1), step(6), step(3), step(7)],
  },
  {
    id: "minor-VII-VI-VII",
    label: "i–♭VII–♭VI–♭VII",
    usage: "any",
    modes: MINOR,
    // The Andalusian descent that turns back instead of reaching the dominant.
    // Distinct from minor-descending in exactly that: it never resolves, which
    // is what makes it a vamp rather than a cadence.
    steps: [step(1), step(7), step(6), step(7)],
  },
  {
    id: "komuro-minor",
    label: "小室進行（短調形）",
    numeric: "1673",
    usage: "any",
    modes: MINOR,
    // The relative-minor reading of the 小室進行 already in this file: the same
    // chords, begun from the vi rather than resolved to the I. Included as its
    // own entry rather than by widening the major one's modes, because a
    // template's degrees are read against the key it is used in and 6-4-5-1 in
    // a minor key is not this progression.
    steps: [step(1), step(6), step(7), step(3)],
  },
];

const BY_ID = new Map(PROGRESSION_TEMPLATES.map((t) => [t.id, t]));

export function getProgressionTemplate(id: string): ProgressionTemplate | undefined {
  return BY_ID.get(id);
}

export function progressionTemplatesForMode(
  mode: Mode,
): readonly ProgressionTemplate[] {
  return PROGRESSION_TEMPLATES.filter((template) => template.modes.includes(mode));
}

/** Legacy degree arrays are lifted into the structured form unchanged. */
export function templateFromDegrees(
  id: string,
  degrees: readonly number[],
  modes: readonly Mode[],
): ProgressionTemplate {
  return {
    id,
    label: degrees.join("-"),
    modes,
    steps: degrees.map((degree) => ({ degree })),
  };
}
