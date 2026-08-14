import { describe, expect, it } from "vitest";
import { DEFAULT_GENERATOR_SETTINGS, generateComposition } from "../src/music";
import {
  createPreferenceModel,
  extractPreferenceFeatures,
  generatePreferred,
  seedForDraw,
  updatePreferenceModel,
  type PreferenceModel,
} from "../src/preference";
import type { GeneratedComposition, GeneratorSettings } from "../src/types/music";

/**
 * What the A/B judgements were for.
 *
 * The preference model has been learning since the A/B panel existed and had
 * never once changed what came out of the generator: `generator.ts` holds no
 * reference to preference of any kind, so every judgement went into reordering
 * a list of candidates that had already been drawn.
 *
 * The model cannot compose -- its features measure a finished piece and there
 * is no inverse from a weight on `melody.leapRate` to a generator setting -- so
 * what it does here is choose among draws. The tests that matter are therefore
 * two: that choosing moves the output at all, measured on seeds it never saw,
 * and that it does not cost the seed its meaning.
 */

function settingsFor(seed: string, bars = 16): GeneratorSettings {
  return { ...DEFAULT_GENERATOR_SETTINGS, bars, seed } as GeneratorSettings;
}

/** One measurable that varies across seeds, standing in for taste. */
function seventhRate(composition: GeneratedComposition): number {
  return composition.chords.filter((chord) => chord.quality.endsWith("7")).length
    / composition.chords.length;
}

/**
 * A model taught from A/B choices between real pieces, exactly as the panel
 * teaches it: the one with more sevenths wins each pair.
 */
function trainedOnSevenths(): PreferenceModel {
  let model = createPreferenceModel();
  const pieces = Array.from({ length: 20 }, (_, index) =>
    generateComposition(settingsFor(`train-${index}`)));
  for (let index = 0; index + 1 < pieces.length; index += 2) {
    const left = pieces[index]!;
    const right = pieces[index + 1]!;
    const [winner, loser] = seventhRate(left) >= seventhRate(right)
      ? [left, right]
      : [right, left];
    model = updatePreferenceModel(model, {
      type: "ab",
      winner: extractPreferenceFeatures(winner),
      loser: extractPreferenceFeatures(loser),
    });
  }
  return model;
}

describe("generating what the judgements asked for", () => {
  it("moves the output on seeds it was never trained on", () => {
    // Held out, because a model that only matches the pieces it learned from
    // has fitted them rather than learned anything. Twenty fresh seeds:
    // measured, the seventh rate goes from 37.5% to 66.2%.
    const model = trainedOnSevenths();
    const held = Array.from({ length: 20 }, (_, index) => settingsFor(`test-${index}`));
    const plain = held.map((settings) => seventhRate(generateComposition(settings)));
    const guided = held.map((settings) => seventhRate(
      generatePreferred(settings, { model, candidates: 8 }, generateComposition).composition,
    ));
    const mean = (values: readonly number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(guided)).toBeGreaterThan(mean(plain) + 0.15);
  }, 60_000);

  it("actually reaches past the first draw", () => {
    // The measurement above would also pass if the first draw happened to be
    // best every time, which would make the search a formality.
    const model = trainedOnSevenths();
    const picks = Array.from({ length: 20 }, (_, index) =>
      generatePreferred(settingsFor(`test-${index}`), { model, candidates: 8 },
        generateComposition).index);
    expect(picks.filter((pick) => pick !== 0).length).toBeGreaterThan(10);
  }, 60_000);

  it("changes nothing at all until something has been learned", () => {
    // Not a special case for the untrained model: with no weights and no bias
    // every candidate scores zero, the tie goes to the earliest draw, and the
    // earliest draw is the seed the user typed.
    const settings = settingsFor("untouched");
    const guided = generatePreferred(
      settings, { model: createPreferenceModel(), candidates: 8 }, generateComposition,
    );
    expect(guided.index).toBe(0);
    expect(JSON.stringify(guided.composition))
      .toBe(JSON.stringify(generateComposition(settings)));
  }, 30_000);

  it("hands the piece back a seed that reproduces it without the model", () => {
    // The rule the whole app is built on. A learned model deciding the output
    // would mean the same seed gave a different piece once it had learned more,
    // and that is not what happens: the draw that won is recorded in the seed
    // the piece carries, and generating that seed reproduces it exactly, with
    // no model involved and no matter what is learned afterwards.
    const model = trainedOnSevenths();
    const guided = generatePreferred(
      settingsFor("promise"), { model, candidates: 8 }, generateComposition,
    );
    expect(guided.composition.seed).toBe(seedForDraw("promise", guided.index));
    const reproduced = generateComposition(
      settingsFor(String(guided.composition.seed)),
    );
    expect(JSON.stringify(reproduced)).toBe(JSON.stringify(guided.composition));
  }, 60_000);

  it("leaves the first draw's seed exactly as it was given", () => {
    // So a user who never trains anything never sees their seed grow a suffix.
    expect(seedForDraw("plain", 0)).toBe("plain");
    expect(seedForDraw("plain", 3)).toBe("plain#3");
  });

  it("is off at one candidate", () => {
    const model = trainedOnSevenths();
    const settings = settingsFor("single");
    const guided = generatePreferred(settings, { model, candidates: 1 }, generateComposition);
    expect(guided.considered).toBe(1);
    expect(JSON.stringify(guided.composition))
      .toBe(JSON.stringify(generateComposition(settings)));
  }, 30_000);

  it("will not let a number make the generate button take a minute", () => {
    let drawn = 0;
    const count = (settings: GeneratorSettings) => {
      drawn += 1;
      return generateComposition(settings);
    };
    const model = createPreferenceModel();
    expect(generatePreferred(settingsFor("clamped"), { model, candidates: 500 }, count)
      .considered).toBe(16);
    expect(drawn).toBe(16);
    drawn = 0;
    expect(generatePreferred(settingsFor("clamped"), { model, candidates: 0 }, count)
      .considered).toBe(1);
    expect(drawn).toBe(1);
  }, 60_000);

  it("chooses the same draw every time", () => {
    const model = trainedOnSevenths();
    const pick = () => generatePreferred(
      settingsFor("stable"), { model, candidates: 6 }, generateComposition,
    ).index;
    expect(pick()).toBe(pick());
  }, 60_000);

  it("asks the category the judgements were made in", () => {
    // A model taught only about harmony has nothing to say about rhythm, and
    // asking the wrong one silently returns the untrained answer.
    let model = createPreferenceModel();
    const left = generateComposition(settingsFor("cat-a"));
    const right = generateComposition(settingsFor("cat-b"));
    model = updatePreferenceModel(model, {
      type: "ab",
      category: "harmony",
      winner: extractPreferenceFeatures(seventhRate(left) >= seventhRate(right) ? left : right),
      loser: extractPreferenceFeatures(seventhRate(left) >= seventhRate(right) ? right : left),
    });
    const combined = generatePreferred(
      settingsFor("cat-test"), { model, candidates: 6 }, generateComposition,
    );
    const harmony = generatePreferred(
      settingsFor("cat-test"), { model, candidates: 6, category: "harmony" }, generateComposition,
    );
    expect(combined.index, "combined learned nothing here").toBe(0);
    expect(harmony.score).not.toBe(0);
  }, 60_000);
});
