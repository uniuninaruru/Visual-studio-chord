import type {
  CanonicalPitchClass,
  ChordEvent,
  ChordQuality,
  GeneratorSettings,
  Mode,
  ProgressionStep,
  SectionEvent,
  Tension,
} from "../types/music";
import { createStepChordEvent, diatonicSeventhQualityForDegree, intervalsForQuality, rootForStep } from "./chords";
import { getProgressionTemplate } from "./progressions";
import { deriveSeed, hashSeed } from "./random";
import { pitchClassToSemitone, normalizePitchClass } from "./scales";
import { ticksPerBar } from "./time";
import type { JazzSettings, JazzStyleId } from "./jazzProfiles";
import type { JazzHarmonyResult } from "./jazzHarmony";

type TheoryFunction = "tonic" | "predominant" | "dominant" | "color";
type PlannedCandidate = {
  step: ProgressionStep;
  fn: TheoryFunction;
  preference: number;
  name: string;
};
type Cadence = JazzHarmonyResult["cadence"];
type Phrase = { startBar: number; endBar: number; sectionKind: SectionEvent["kind"] };
type PhrasePlan = Phrase & { cadence: Cadence };

const STYLE_FUNCTIONS: Readonly<Record<JazzStyleId, readonly TheoryFunction[]>> = {
  swing: ["tonic", "predominant", "dominant", "tonic"],
  ballad: ["tonic", "tonic", "predominant", "dominant"],
  bebop: ["predominant", "dominant", "tonic", "predominant"],
  modern: ["tonic", "color", "predominant", "tonic"],
  neoSoul: ["tonic", "tonic", "predominant", "tonic"],
};

function tonicQuality(mode: Mode): ChordQuality {
  if (mode === "major") return "major7";
  if (mode === "mixolydian") return "dominant7";
  if (mode === "harmonicMinor") return "minorMajor7";
  return "minor7";
}

function dominantQuality(): ChordQuality {
  return "dominant7";
}

function iiQuality(mode: Mode): ChordQuality {
  return mode === "naturalMinor" || mode === "harmonicMinor" ? "halfDiminished7" : "minor7";
}

function fourthQuality(mode: Mode): ChordQuality {
  return diatonicSeventhQualityForDegree(4, mode);
}

function fifthDiatonicQuality(mode: Mode): ChordQuality {
  return diatonicSeventhQualityForDegree(5, mode);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function makeCandidate(
  degree: number,
  quality: ChordQuality,
  fn: TheoryFunction,
  name: string,
  preference = 0,
  extra: Omit<ProgressionStep, "degree" | "quality"> & { tensions?: readonly Tension[] } = {},
): PlannedCandidate {
  return {
    step: { degree, quality, ...extra },
    fn,
    preference,
    name,
  };
}

function candidatesForStyle(
  style: JazzStyleId,
  mode: Mode,
  chromaticism: number,
  form: JazzSettings["form"],
): Readonly<Record<TheoryFunction, readonly PlannedCandidate[]>> {
  const colorLevel = clamp01(chromaticism);
  const homeTensions: readonly Tension[] = style === "neoSoul" ? ["9", "13"] : ["9"];
  const tonic: PlannedCandidate[] = [
    makeCandidate(1, tonicQuality(mode), "tonic", "home", style === "modern" ? 0.05 : 0, { tensions: homeTensions }),
    makeCandidate(6, diatonicSeventhQualityForDegree(6, mode), "tonic", "submediant", style === "ballad" || style === "neoSoul" ? 0.02 : 0.12, { tensions: ["9"] }),
    makeCandidate(3, diatonicSeventhQualityForDegree(3, mode), "tonic", "mediant", style === "neoSoul" || style === "modern" ? 0.04 : 0.16, { tensions: style === "neoSoul" ? ["9"] : [] }),
  ];
  const predominant: PlannedCandidate[] = [
    makeCandidate(2, iiQuality(mode), "predominant", "supertonic", style === "bebop" ? 0 : 0.04, {
      tensions: style === "neoSoul" ? ["9", "11"] : style === "ballad" ? ["11"] : [],
    }),
    makeCandidate(4, fourthQuality(mode), "predominant", "subdominant", style === "modern" || style === "neoSoul" ? 0 : 0.05, {
      tensions: style === "modern" || style === "neoSoul" ? ["9", "#11"] : [],
    }),
  ];
  const dominantTensions: readonly Tension[] = style === "bebop"
    ? ["b9"]
    : style === "ballad"
      ? ["13"]
      : style === "neoSoul"
        ? ["#9"]
        : style === "modern"
          ? ["#11"]
          : ["13"];
  const dominant: PlannedCandidate[] = [
    makeCandidate(5, dominantQuality(), "dominant", "dominant", 0, { tensions: dominantTensions }),
  ];
  const color: PlannedCandidate[] = [];

  // Color is style-dependent. Modern jazz has room for a broad bVII/IV palette;
  // neo-soul keeps its borrowed colour in the upper structure and bass motion.
  if (style === "modern" || style === "neoSoul") {
    color.push(makeCandidate(4, fourthQuality(mode), "color", "open-fourth", 0.02, {
      tensions: ["9", "#11"],
    }));
    if (mode === "major") {
      color.push({
        step: { degree: 7, alteration: -1, quality: "dominant7", role: "chromatic", tensions: ["13"] },
        fn: "color",
        preference: style === "modern" ? 0 : 0.08,
        name: "flat-seven-color",
      });
    } else {
      color.push(makeCandidate(7, "dominant7", "color", "seventh-color", 0.04, {
        role: "chromatic",
        tensions: ["13"],
      }));
    }
    color.push(makeCandidate(3, diatonicSeventhQualityForDegree(3, mode), "color", "mediant-color", 0.08, {
      tensions: ["9", "#11"],
    }));
  } else {
    color.push(...predominant.slice(0, 1), ...tonic.slice(1, 2));
  }

  if (style === "bebop") {
    dominant.push(makeCandidate(7, diatonicSeventhQualityForDegree(7, mode), "dominant", "leading-tone", 0.08));
    // VI7 is admitted only when the search confirms the following chord is ii.
    // The target-bearing metadata is never left on an unresolved chord.
    if (colorLevel >= 0.3) {
      dominant.push(makeCandidate(6, "dominant7", "dominant", "five-of-two", 0.14, {
        role: "secondaryDominant",
        targetDegree: 2,
        tensions: ["b9"],
      }));
    }
  }

  if (form === "modal") {
    return { tonic, predominant, dominant: [], color };
  }
  if (colorLevel < 0.12) {
    return { tonic, predominant, dominant, color: color.slice(0, 1) };
  }
  return { tonic, predominant, dominant, color };
}

function sectionEvents(
  form: JazzSettings["form"],
  bars: number,
  key: CanonicalPitchClass,
  mode: Mode,
  progressionId?: string,
): SectionEvent[] {
  if (bars <= 0) return [];
  let starts: number[];
  let kinds: SectionEvent["kind"][];
  if (form === "aaba") {
    starts = [0, 1, 2, 3, 4].map((index) => Math.floor((bars * index) / 4));
    kinds = ["verse", "verse", "bridge", "finalChorus"];
  } else if (form === "blues") {
    starts = Array.from({ length: Math.floor((bars - 1) / 12) + 1 }, (_, index) => index * 12);
    starts.push(bars);
    kinds = starts.slice(0, -1).map((_, index) => index === 0 ? "verse" : "chorus");
  } else if (form === "modal") {
    starts = bars > 8 ? [0, Math.floor(bars / 2), bars] : [0, bars];
    kinds = bars > 8 ? ["verse", "bridge"] : ["verse"];
  } else {
    starts = [0, bars];
    kinds = ["verse"];
  }
  const distinctStarts = starts.filter((value, index) => index === 0 || value > (starts[index - 1] as number));
  return distinctStarts.slice(0, -1).map((startBar, index) => ({
    id: `theory-jazz-section-${index}`,
    kind: kinds[index] ?? "verse",
    startBar,
    endBar: distinctStarts[index + 1] as number,
    key,
    mode,
    transpose: 0,
    ...(progressionId ? { progressionId } : {}),
  })).filter((section) => section.endBar > section.startBar);
}

function phrasesForForm(
  form: JazzSettings["form"],
  sections: readonly SectionEvent[],
  bars: number,
): Phrase[] {
  if (bars <= 0) return [];
  if (form === "free") {
    return Array.from({ length: Math.ceil(bars / 4) }, (_, index) => ({
      startBar: index * 4,
      endBar: Math.min(bars, index * 4 + 4),
      sectionKind: "verse" as const,
    }));
  }
  return sections.map((section) => ({
    startBar: section.startBar,
    endBar: section.endBar,
    sectionKind: section.kind,
  }));
}

function cadenceForPhrase(
  form: JazzSettings["form"],
  style: JazzStyleId,
  phraseIndex: number,
  phraseCount: number,
  sectionKind: SectionEvent["kind"],
): Cadence {
  if (form === "blues" || form === "modal") return "loop";
  if (phraseIndex === phraseCount - 1) {
    if (style === "modern" || style === "neoSoul") return "plagal";
    return "authentic";
  }
  if (sectionKind === "bridge" && (style === "modern" || style === "neoSoul")) return "plagal";
  return "half";
}

function planPhraseCadences(
  form: JazzSettings["form"],
  style: JazzStyleId,
  sections: readonly SectionEvent[],
  bars: number,
): PhrasePlan[] {
  const phrases = phrasesForForm(form, sections, bars);
  return phrases.map((phrase, index) => ({
    ...phrase,
    cadence: cadenceForPhrase(form, style, index, phrases.length, phrase.sectionKind),
  }));
}

function cadenceTail(cadence: Cadence, mode: Mode, style: JazzStyleId): PlannedCandidate[] {
  const tonic = makeCandidate(1, tonicQuality(mode), "tonic", "cadence-tonic", 0, {
    tensions: style === "neoSoul" ? ["9"] : [],
  });
  const dominant = makeCandidate(5, "dominant7", "dominant", "cadence-dominant", 0, {
    tensions: style === "bebop" ? ["b9"] : style === "ballad" ? ["13"] : [],
  });
  switch (cadence) {
    case "authentic":
      return [
        makeCandidate(2, iiQuality(mode), "predominant", "cadential-two", 0, {
          tensions: style === "bebop" ? ["11"] : [],
        }),
        dominant,
        tonic,
      ];
    case "plagal":
      return [makeCandidate(4, fourthQuality(mode), "predominant", "plagal-four", 0), tonic];
    case "half":
      return [
        makeCandidate(mode === "major" || mode === "mixolydian" ? 2 : 4,
          mode === "major" || mode === "mixolydian" ? iiQuality(mode) : fourthQuality(mode),
          "predominant", "half-cadence-approach", 0),
        dominant,
      ];
    case "deceptive":
      return [dominant, makeCandidate(6, diatonicSeventhQualityForDegree(6, mode), "tonic", "deceptive-six", 0)];
    case "loop":
      return [
        makeCandidate(4, fourthQuality(mode), "predominant", "loop-four", 0),
        makeCandidate(5, fifthDiatonicQuality(mode), "dominant", "loop-five", 0),
      ];
  }
}

function functionSchedule(style: JazzStyleId, phrase: PhrasePlan, form: JazzSettings["form"]): readonly TheoryFunction[] {
  if (form === "modal") return ["tonic", "tonic", "color", "predominant"];
  if (phrase.sectionKind === "bridge") {
    if (style === "swing" || style === "bebop") return ["dominant", "predominant", "dominant", "tonic"];
    if (style === "ballad") return ["predominant", "tonic", "predominant", "dominant"];
    if (style === "modern") return ["color", "predominant", "tonic", "color"];
    return ["tonic", "predominant", "tonic", "dominant"];
  }
  return STYLE_FUNCTIONS[style];
}

function desiredFunctions(
  style: JazzStyleId,
  phrase: PhrasePlan,
  form: JazzSettings["form"],
  freeBars: number,
): TheoryFunction[] {
  const schedule = functionSchedule(style, phrase, form);
  return Array.from({ length: freeBars }, (_, index) => schedule[index % schedule.length] as TheoryFunction);
}

function candidateOptions(
  menus: Readonly<Record<TheoryFunction, readonly PlannedCandidate[]>>,
  wanted: TheoryFunction,
  style: JazzStyleId,
): PlannedCandidate[] {
  const orderedFunctions: TheoryFunction[] = [wanted];
  const fallbacks: TheoryFunction[] = style === "modern" || style === "neoSoul"
    ? ["color", "predominant", "tonic", "dominant"]
    : ["predominant", "tonic", "dominant", "color"];
  for (const fn of fallbacks) if (!orderedFunctions.includes(fn)) orderedFunctions.push(fn);
  const options: PlannedCandidate[] = [];
  for (const fn of orderedFunctions) {
    for (const candidate of menus[fn]) {
      options.push({
        ...candidate,
        preference: candidate.preference + (fn === wanted ? 0 : 0.72 + orderedFunctions.indexOf(fn) * 0.05),
      });
    }
  }
  return options;
}

function functionTransitionCost(from: TheoryFunction, to: TheoryFunction): number {
  const table: Readonly<Record<TheoryFunction, Readonly<Record<TheoryFunction, number>>>> = {
    tonic: { tonic: 0.24, predominant: 0.05, dominant: 0.2, color: 0.16 },
    predominant: { tonic: 0.23, predominant: 0.34, dominant: 0.01, color: 0.18 },
    dominant: { tonic: 0.01, predominant: 0.38, dominant: 0.24, color: 0.22 },
    color: { tonic: 0.14, predominant: 0.16, dominant: 0.2, color: 0.26 },
  };
  return table[from][to];
}

function circularDistance(left: number, right: number): number {
  const difference = Math.abs(((left - right) % 12 + 12) % 12);
  return Math.min(difference, 12 - difference);
}

function chordRoot(step: ProgressionStep, key: GeneratorSettings["key"], mode: Mode): number {
  return pitchClassToSemitone(rootForStep(key, mode, step.degree, step.alteration));
}

function bassPitch(step: ProgressionStep, key: GeneratorSettings["key"], mode: Mode): number {
  const degree = step.bassDegree ?? step.degree;
  const alteration = step.bassDegree === undefined ? step.alteration : step.bassAlteration;
  return pitchClassToSemitone(rootForStep(key, mode, degree, alteration));
}

function guideToneClasses(step: ProgressionStep, key: GeneratorSettings["key"], mode: Mode): number[] {
  const root = chordRoot(step, key, mode);
  const quality = step.quality ?? diatonicSeventhQualityForDegree(step.degree, mode);
  const intervals = intervalsForQuality(quality);
  const third = intervals.find((interval) => interval === 3 || interval === 4);
  const seventh = intervals.find((interval) => interval === 9 || interval === 10 || interval === 11);
  return [third, seventh].flatMap((value) => value === undefined ? [] : [(root + value) % 12]);
}

function guideMotionCost(previous: ProgressionStep, current: ProgressionStep, settings: GeneratorSettings): number {
  // J-GUIDE: prefer small motion between thirds/sevenths rather than scoring roots alone.
  const before = guideToneClasses(previous, settings.key, settings.mode);
  const after = guideToneClasses(current, settings.key, settings.mode);
  if (before.length < 2 || after.length < 2) return 0;
  const direct = circularDistance(before[0] as number, after[0] as number)
    + circularDistance(before[1] as number, after[1] as number);
  const crossed = circularDistance(before[0] as number, after[1] as number)
    + circularDistance(before[1] as number, after[0] as number);
  return Math.min(direct, crossed) * 0.42;
}

function bassMotionWeight(style: JazzStyleId): number {
  switch (style) {
    case "ballad": return 0.085;
    case "modern": return 0.12;
    case "neoSoul": return 0.1;
    case "bebop": return 0.055;
    case "swing": return 0.07;
  }
}

function unresolvedTarget(previous: PlannedCandidate, current: PlannedCandidate): boolean {
  return previous.step.targetDegree !== undefined
    && (previous.step.role === "secondaryDominant" || previous.step.role === "tritoneSubstitution")
    && current.step.degree !== previous.step.targetDegree;
}

function transitionCost(
  previous: PlannedCandidate,
  current: PlannedCandidate,
  settings: GeneratorSettings,
  jazz: JazzSettings,
): number {
  if (unresolvedTarget(previous, current)) return Number.POSITIVE_INFINITY;
  const bassDistance = circularDistance(
    bassPitch(previous.step, settings.key, settings.mode),
    bassPitch(current.step, settings.key, settings.mode),
  );
  const sameDegree = previous.step.degree === current.step.degree
    && previous.step.alteration === current.step.alteration;
  const repeatedPenalty = sameDegree ? 0.52 : 0;
  const sameFunctionPenalty = previous.fn === current.fn ? 0.09 : 0;
  return functionTransitionCost(previous.fn, current.fn)
    + guideMotionCost(previous.step, current.step, settings)
    + bassDistance * bassMotionWeight(jazz.style)
    + repeatedPenalty
    + sameFunctionPenalty;
}

function chooseCandidatePath(
  optionsByBar: readonly (readonly PlannedCandidate[])[],
  settings: GeneratorSettings,
  jazz: JazzSettings,
): PlannedCandidate[] {
  if (optionsByBar.length === 0) return [];
  type Node = { path: PlannedCandidate[]; score: number; last: PlannedCandidate };
  let beam: Node[] = [];
  const width = 56;
  for (let position = 0; position < optionsByBar.length; position += 1) {
    const choices = optionsByBar[position] as readonly PlannedCandidate[];
    const next: Node[] = [];
    for (const candidate of choices) {
      if (position === 0) {
        const noise = (hashSeed(deriveSeed(settings.seed, "theory-harmony-choice", position, candidate.name)) % 997) / 5000;
        next.push({ path: [candidate], score: candidate.preference + noise, last: candidate });
        continue;
      }
      for (const node of beam) {
        const move = transitionCost(node.last, candidate, settings, jazz);
        if (!Number.isFinite(move)) continue;
        const noise = (hashSeed(deriveSeed(settings.seed, "theory-harmony-choice", position, candidate.name)) % 997) / 5000;
        next.push({
          path: [...node.path, candidate],
          score: node.score + candidate.preference + move + noise,
          last: candidate,
        });
      }
    }
    next.sort((left, right) => left.score - right.score);
    beam = next.slice(0, width);
    if (beam.length === 0) {
      throw new Error(`No theory-harmony path resolves its target-bearing chord at bar ${position}.`);
    }
  }
  const selected = beam[0]?.path;
  if (!selected || selected.length !== optionsByBar.length) {
    throw new Error("Theory-harmony search did not produce a complete bar path.");
  }
  for (let index = 0; index < selected.length - 1; index += 1) {
    const current = selected[index] as PlannedCandidate;
    const next = selected[index + 1] as PlannedCandidate;
    if (unresolvedTarget(current, next)) {
      throw new Error(`Theory-harmony path left a target-bearing chord unresolved at bar ${index}.`);
    }
  }
  return selected;
}

function bluesStep(position: number): ProgressionStep {
  // J-BLUES: I7 and IV7 are blues tonics/areas, not unresolved V7s.
  const slot = ((position % 12) + 12) % 12;
  const degree = slot < 4 || (slot >= 6 && slot < 8) || slot === 10 ? 1
    : slot === 4 || slot === 5 || slot === 9 ? 4
      : 5;
  return { degree, quality: "dominant7" };
}

function sanitizeTargetClaims(steps: readonly ProgressionStep[]): ProgressionStep[] {
  return steps.map((current, index) => {
    if (current.targetDegree === undefined) return { ...current };
    const next = steps[index + 1];
    const claimNeedsResolution = current.role === "secondaryDominant" || current.role === "tritoneSubstitution";
    if (!claimNeedsResolution) return { ...current };
    if (next?.degree === current.targetDegree) return { ...current };
    const unclaimed = { ...current };
    delete unclaimed.role;
    delete unclaimed.targetDegree;
    return unclaimed;
  });
}

function finalCadence(chords: readonly ChordEvent[], mode: Mode): Cadence {
  const last = chords.at(-1);
  const previous = chords.at(-2);
  if (!last || !previous) return "loop";
  const validDominant = previous.quality === "dominant7" || previous.quality === "major";
  if (last.degree === 1 && previous.degree === 5 && validDominant) return "authentic";
  if (last.degree === 1 && previous.degree === 4) return "plagal";
  if (last.degree === 6 && previous.degree === 5 && validDominant) return "deceptive";
  const finalIsDominant = last.quality === "dominant7" || last.quality === "major";
  if (last.degree === 5 && (previous.degree === (mode === "major" || mode === "mixolydian" ? 2 : 4)) && finalIsDominant) return "half";
  return "loop";
}

/**
 * Creates a jazz harmony plan from a phrase/cadence plan, then uses a bounded
 * deterministic beam search over style-specific T/PD/D and colour candidates.
 * The beam cost balances functional direction, guide-tone continuity and bass
 * travel; it is a transparent authored prior rather than a corpus statistic.
 */
export function planTheoryHarmony(options: {
  settings: GeneratorSettings;
  jazz: JazzSettings;
  ppq: number;
}): JazzHarmonyResult {
  const { settings, jazz, ppq } = options;
  if (!Number.isInteger(settings.bars) || settings.bars < 0) throw new RangeError("bars must be a non-negative integer");
  if (!Number.isInteger(ppq) || ppq <= 0) throw new RangeError("ppq must be a positive integer");
  const barTicks = ticksPerBar(settings.timeSignature, ppq);
  const totalTicks = barTicks * settings.bars;
  const key = normalizePitchClass(settings.key);
  const explicitTemplate = settings.progressionId === undefined
    ? undefined
    : getProgressionTemplate(settings.progressionId);
  if (settings.progressionId !== undefined && explicitTemplate === undefined) {
    throw new RangeError(`Unknown explicit progression: ${settings.progressionId}`);
  }

  const sections = sectionEvents(jazz.form, settings.bars, key, settings.mode, settings.progressionId);
  const phrasePlans = planPhraseCadences(jazz.form, jazz.style, sections, settings.bars);
  const steps: ProgressionStep[] = [];

  if (explicitTemplate) {
    // H-FORM/J-CADENCE: an explicit user progression wins over generated form
    // choices; each named step is repeated without degree/quality reharmonising.
    for (let bar = 0; bar < settings.bars; bar += 1) {
      steps.push({ ...(explicitTemplate.steps[bar % explicitTemplate.steps.length] as ProgressionStep) });
    }
  } else if (jazz.form === "blues") {
    for (let bar = 0; bar < settings.bars; bar += 1) steps.push(bluesStep(bar));
  } else {
    const menus = candidatesForStyle(jazz.style, settings.mode, jazz.chromaticism, jazz.form);
    const optionsByBar: PlannedCandidate[][] = Array.from({ length: settings.bars }, () => []);
    for (const phrase of phrasePlans) {
      const phraseLength = phrase.endBar - phrase.startBar;
      const tail = cadenceTail(phrase.cadence, settings.mode, jazz.style);
      const effectiveTail = phraseLength >= tail.length ? tail : tail.slice(tail.length - phraseLength);
      const freeLength = Math.max(0, phraseLength - effectiveTail.length);
      const wanted = desiredFunctions(jazz.style, phrase, jazz.form, freeLength);
      for (let localBar = 0; localBar < freeLength; localBar += 1) {
        const wantedFunction = wanted[localBar] as TheoryFunction;
        const absoluteBar = phrase.startBar + localBar;
        optionsByBar[absoluteBar] = candidateOptions(menus, wantedFunction, jazz.style);
      }
      effectiveTail.forEach((candidate, index) => {
        optionsByBar[phrase.startBar + freeLength + index] = [candidate];
      });
    }
    // Any uncovered bar (only possible for an empty/degenerate section plan)
    // receives the simplest tonic candidate rather than an invalid event.
    for (let bar = 0; bar < settings.bars; bar += 1) {
      if (optionsByBar[bar]?.length === 0) {
        optionsByBar[bar] = [makeCandidate(1, tonicQuality(settings.mode), "tonic", "fallback-tonic")];
      }
    }
    const selected = chooseCandidatePath(optionsByBar, settings, jazz);
    for (let bar = 0; bar < settings.bars; bar += 1) steps.push((selected[bar] as PlannedCandidate).step);
  }

  const materialSteps = sanitizeTargetClaims(steps);
  const chords: ChordEvent[] = [];
  let previousNotes: readonly number[] | undefined;
  for (let bar = 0; bar < settings.bars; bar += 1) {
    const startTick = bar * barTicks;
    const durationTick = Math.min(barTicks, totalTicks - startTick);
    const chord = createStepChordEvent({
      key: settings.key,
      mode: settings.mode,
      step: materialSteps[bar] as ProgressionStep,
      startTick,
      durationTick,
      id: `theory-jazz-chord-${bar}-${hashSeed(deriveSeed(settings.seed, "theory-chord", bar)).toString(36)}`,
      previousNotes,
      voiceLeadingStrength: 0.86,
    });
    chords.push(chord);
    previousNotes = chord.notes;
  }

  return {
    chords,
    sections,
    // Blues turnaround V points into the next chorus: `loop` is the closest
    // truthful label in JazzHarmonyResult's existing cadence vocabulary.
    cadence: (jazz.form === "blues" || jazz.form === "modal") && !explicitTemplate
      ? "loop"
      : finalCadence(chords, settings.mode),
    resolvedStyle: "jazz",
  };
}
