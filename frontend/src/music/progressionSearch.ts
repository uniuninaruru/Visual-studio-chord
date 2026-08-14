import type { Mode, ProgressionStep } from "../types/music";
import { diatonicQualityForDegree } from "./chords";
import {
  DEVICE_LABELS,
  enumerateVariants,
  type ProgressionDevice,
  type ProgressionVariant,
} from "./progressionVariants";

/**
 * Finding one progression among a thousand.
 *
 * A catalogue of thirty-six is a list you read. A catalogue of fifteen hundred
 * is only usable if you can ask it something, and the questions a writer
 * actually has are not "which id" -- they are "what starts on IV", "what has a
 * secondary dominant in it", "something like 4536 but longer", "what did that
 * one with the flat two sound like".
 *
 * So the query is one line of text and every sensible reading of it is tried at
 * once. `4536` is a degree sequence. `IV V iii vi` is the same thing written
 * differently. `王道` is a name. `サブドミナントマイナー` is a device. A writer
 * should not have to know which field they are searching.
 */

/** Roman numerals, upper case for the numeral itself; case is not significant on input. */
const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;

export function romanFor(step: ProgressionStep, mode: Mode): string {
  const accidental = step.alteration === -1 ? "♭" : step.alteration === 1 ? "♯" : "";
  const quality = step.quality ?? diatonicQualityForDegree(step.degree, mode);
  const numeral = NUMERALS[step.degree - 1] ?? String(step.degree);
  const minorish = quality === "minor" || quality === "minor7" || quality === "minorMajor7"
    || quality === "minorAdd9" || quality === "diminished" || quality === "diminished7"
    || quality === "halfDiminished7";
  const body = minorish ? numeral.toLowerCase() : numeral;
  const suffix = SUFFIX[quality] ?? "";
  return `${accidental}${body}${suffix}`;
}

const SUFFIX: Readonly<Record<string, string>> = {
  major: "", minor: "", diminished: "°", augmented: "+",
  dominant7: "7", major7: "maj7", minor7: "7", minorMajor7: "mM7",
  halfDiminished7: "ø7", diminished7: "°7", augmentedMajor7: "+maj7",
  sus2: "sus2", sus4: "sus4", add9: "add9", minorAdd9: "add9",
};

/** The whole progression as roman numerals, which is how it is read aloud. */
export function romanOf(variant: ProgressionVariant, mode: Mode): string {
  return variant.steps.map((step) => romanFor(step, mode)).join(" ");
}

/** Just the degree digits, which is how J-POP practice writes it: 4536. */
export function degreeDigitsOf(variant: ProgressionVariant): string {
  return variant.steps.map((step) => String(step.degree)).join("");
}

/**
 * Degrees with their accidentals, so a chromatic root can be typed as one.
 *
 * "4536" cannot express a flat two, and a writer looking for the tritone
 * substitution reaches for "b2" long before they reach for "♭II7". This is the
 * form that reads, and it is searched alongside the plain digits rather than
 * instead of them.
 */
export function degreeTokensOf(variant: ProgressionVariant): string {
  return variant.steps
    .map((step) => `${step.alteration === -1 ? "b" : step.alteration === 1 ? "#" : ""}${step.degree}`)
    .join("");
}

export interface ProgressionSearchResult {
  variant: ProgressionVariant;
  /** Higher is a better match. Only used to order; the value has no meaning on its own. */
  score: number;
  /** Which reading of the query matched, so the interface can say why. */
  reasons: readonly string[];
}

export interface ProgressionSearchOptions {
  mode: Mode;
  /** Free text: digits, roman numerals, a name, or a device. */
  query?: string;
  usage?: string;
  /** Only progressions using every one of these devices. */
  devices?: readonly ProgressionDevice[];
  /** Only the catalogued progressions, with nothing derived. */
  cataloguedOnly?: boolean;
  minSteps?: number;
  maxSteps?: number;
  limit?: number;
  maxDevices?: number;
}

/** Normalised for comparison: case folded, spacing and separators removed. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[♭b]/g, "b")
    .replace(/[♯#]/g, "#")
    .replace(/[\s\-–—_/|,]/g, "");
}

/**
 * A roman-numeral query as digits.
 *
 * Parsed one token at a time rather than across the whole string, because the
 * numerals are not self-delimiting once their separators are gone: "IV V"
 * concatenates to "ivv", which reads just as well as I-V-V, and "IVmaj7 V7
 * iii7 vi" came out as 4741 instead of 4536. Splitting on whitespace and the
 * separators a writer actually types keeps each numeral whole.
 *
 * Returns null where the text is not roman numerals at all, so a search for a
 * name is not mistaken for a very strange progression.
 */
export function degreesFromRoman(text: string): string | null {
  const tokens = text.split(/[\s\-–—_/|,]+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  let digits = "";
  for (const token of tokens) {
    const body = fold(token).replace(/(maj7|add9|sus[24]|m7|7|°|ø|\+)/g, "")
      .replace(/^[b#]/, "");
    // Longest first, or "iii" reads as three separate ones.
    const found = ["vii", "iii", "vi", "iv", "ii", "v", "i"]
      .find((numeral) => body === numeral);
    if (!found) return null;
    digits += String(NUMERALS.findIndex((entry) => entry.toLowerCase() === found) + 1);
  }
  return digits;
}

/**
 * Searches the derived catalogue.
 *
 * Every reading of the query is tried and the best is kept, rather than the
 * caller choosing a field. A query that reads as digits scores against the
 * degree sequence; one that reads as roman numerals is converted to digits and
 * scored the same way; anything scores against the label, the id and the device
 * names. A progression that matches two readings scores as the better of them,
 * not the sum, so a coincidence in one field cannot outrank a real match in
 * another.
 */
export function searchProgressions(
  options: ProgressionSearchOptions,
): ProgressionSearchResult[] {
  const variants = enumerateVariants(options.mode, {
    maxDevices: options.cataloguedOnly ? 0 : options.maxDevices ?? 2,
  });
  const query = options.query?.trim() ?? "";
  const folded = fold(query);
  const asDigits = /^[1-7]+$/.test(folded) ? folded : degreesFromRoman(query);

  const results: ProgressionSearchResult[] = [];
  for (const variant of variants) {
    if (options.usage && (variant.usage ?? "any") !== options.usage) continue;
    if (options.cataloguedOnly && variant.devices.length > 0) continue;
    if (options.devices?.length
      && !options.devices.every((device) => variant.devices.includes(device))) continue;
    if (options.minSteps !== undefined && variant.steps.length < options.minSteps) continue;
    if (options.maxSteps !== undefined && variant.steps.length > options.maxSteps) continue;

    if (folded === "") {
      results.push({ variant, score: 1, reasons: [] });
      continue;
    }

    let score = 0;
    const reasons: string[] = [];
    const digits = degreeDigitsOf(variant);
    if (asDigits) {
      if (digits === asDigits) { score = Math.max(score, 100); reasons.push("度数が一致"); }
      else if (digits.startsWith(asDigits)) { score = Math.max(score, 80); reasons.push("度数の先頭が一致"); }
      else if (digits.includes(asDigits)) { score = Math.max(score, 60); reasons.push("度数を含む"); }
    }
    if (/^[b#1-7]+$/.test(folded) && degreeTokensOf(variant).includes(folded)) {
      score = Math.max(score, 75);
      reasons.push("度数（変化記号つき）が一致");
    }
    const roman = fold(romanOf(variant, options.mode));
    if (roman.includes(folded)) { score = Math.max(score, 70); reasons.push("和音表記が一致"); }
    const label = fold(variant.label);
    if (label.includes(folded)) { score = Math.max(score, 90); reasons.push("名前が一致"); }
    // Three characters at least: every derived id ends in a disambiguating
    // "-2", "-3", and a two-character query was matching those rather than
    // anything a reader would call a match.
    if (folded.length >= 3 && fold(variant.id).includes(folded)) {
      score = Math.max(score, 50);
      reasons.push("IDが一致");
    }
    for (const device of variant.devices) {
      if (fold(DEVICE_LABELS[device]).includes(folded) || fold(device).includes(folded)) {
        score = Math.max(score, 65);
        reasons.push(`技法: ${DEVICE_LABELS[device]}`);
      }
    }
    if (score > 0) results.push({ variant, score, reasons });
  }

  // Catalogued progressions ahead of derived ones at the same score, then fewer
  // devices, then id -- so an exact match on a named progression is never
  // buried under its own variants, and the order is stable.
  results.sort((left, right) =>
    right.score - left.score
    || left.variant.devices.length - right.variant.devices.length
    || left.variant.steps.length - right.variant.steps.length
    || left.variant.id.localeCompare(right.variant.id));
  return options.limit === undefined ? results : results.slice(0, options.limit);
}
