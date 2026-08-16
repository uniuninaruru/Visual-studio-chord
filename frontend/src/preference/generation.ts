import type { GeneratedComposition, GeneratorSettings } from "../types/music";
import { extractPreferenceFeatures } from "./featureExtraction";
import { scorePreference } from "./model";
import type { PreferenceCategory, PreferenceModel } from "./types";

/**
 * Letting what was learned from A/B choices decide what gets generated.
 *
 * The preference model has been trained since the A/B panel existed and has
 * only ever reordered a list. Nothing upstream consulted it: `generator.ts`
 * carries no reference to preference of any kind, so a hundred judgements
 * changed which of five candidates appeared first and never changed what the
 * generator drew.
 *
 * What the model can honestly do is choose, not compose. Its features are
 * measurements of a finished piece -- how often the melody leaps, what share of
 * chords are sevenths, how wide the voicings sit -- and there is no inverse
 * from a weight on `melody.leapRate` to a generator setting. So this draws
 * several pieces and keeps the one the model likes best. Best-of-n, said
 * plainly, rather than a claim to have learned how to write.
 *
 * ## The seed keeps its promise
 *
 * Same seed and settings, same piece, is a rule this app is built on, and a
 * learned model changing the output would break it: the same seed would give a
 * different piece tomorrow.
 *
 * It does not, because the choice is recorded where it belongs. The draws are
 * seeds derived from the one the user gave, and the piece that wins carries the
 * derived seed it was drawn from. Generating "abc" with a trained model may
 * produce the piece whose seed is "abc#3", and generating "abc#3" reproduces it
 * exactly, with no model, forever. The model chooses which seed; the piece
 * always says which seed it was.
 *
 * ## It does nothing until it has learned something
 *
 * An untrained model has no weights and no bias, so every candidate scores
 * zero, the tie goes to the first draw, and the first draw is the user's own
 * seed. Generation with guidance on and nothing learned is byte-identical to
 * generation without it -- not by a special case, but because that is what
 * scoring nothing against nothing comes to.
 */

/** The draw a piece was chosen from, appended to the seed the user gave. */
export const PREFERRED_SEED_SEPARATOR = "#";

export interface PreferenceGuidance {
  model: PreferenceModel;
  /**
   * Which model to ask. The A/B panel's own category, so guidance follows the
   * judgements the user was actually making rather than a different profile.
   */
  category?: PreferenceCategory;
  /**
   * How many pieces to draw before choosing. One is no choosing at all, which
   * is the off switch.
   */
  candidates: number;
}

export interface PreferredGeneration {
  composition: GeneratedComposition;
  /** Which draw won, zero being the seed as given. */
  index: number;
  /** How many were drawn, which is not `candidates` when the count is clamped. */
  considered: number;
  /** The winner's score, for reporting. Zero from an untrained model. */
  score: number;
}

/**
 * The seed of the nth draw.
 *
 * The user's seed unchanged for the first, so a single draw is the piece the
 * app would have generated anyway and no user-facing seed grows a suffix it did
 * not need.
 */
export function seedForDraw(seed: GeneratorSettings["seed"], index: number): string {
  return index === 0 ? String(seed) : `${seed}${PREFERRED_SEED_SEPARATOR}${index}`;
}

/**
 * Draws several pieces and keeps the one the model likes best.
 *
 * `generate` is injected so this can be measured against a stub, and because a
 * module about preference should not decide what generation means.
 */
export function generatePreferred(
  settings: GeneratorSettings,
  guidance: PreferenceGuidance,
  generate: (settings: GeneratorSettings) => GeneratedComposition,
): PreferredGeneration {
  // At least one, and no more than a sensible ceiling: each draw is a whole
  // composition, and a number typed into a settings field should not be able to
  // make the generate button take a minute.
  const considered = Math.max(1, Math.min(16, Math.floor(guidance.candidates)));
  const category = guidance.category ?? "combined";

  let best: PreferredGeneration | null = null;
  for (let index = 0; index < considered; index += 1) {
    const composition = generate({ ...settings, seed: seedForDraw(settings.seed, index) });
    const score = scorePreference(
      guidance.model,
      extractPreferenceFeatures(composition),
      category,
    ).score;
    // Strictly greater, so an exact tie keeps the earlier draw and an untrained
    // model returns the user's own seed rather than the last one tried.
    if (best === null || score > best.score) {
      best = { composition, index, considered, score };
    }
  }

  return { ...(best as PreferredGeneration), considered };
}
