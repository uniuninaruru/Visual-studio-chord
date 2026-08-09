import { describe, expect, it } from "vitest";
import { majorTransitionCosts } from "../src/music/melodyHarmonizer";
import { PROGRESSION_TEMPLATES } from "../src/music/progressions";

/**
 * Measuring the transition prior against progressions it has never seen.
 *
 * Every earlier figure for this prior was circular. The prior is counted from
 * the progression catalogue, and 30% of the four-bar windows this app produces
 * are literally template sequences, so scoring the app's output against the
 * prior was asking the catalogue whether it agreed with itself. It did:
 * in-sample 0.351 against held-out 0.435, and the gap is the circularity.
 *
 * Leave-one-out removes it. For each template the prior is rebuilt without that
 * template, and the template is then scored by a prior that never counted a
 * single one of its moves. What survives is a real claim: the prior has learned
 * something about how chords follow one another that generalises past the
 * twenty-eight sequences behind it.
 *
 * This is the instrument, not the result. Its value is that any future change
 * to the prior -- more data, phrase position, section role -- can be measured
 * here rather than argued about.
 */

/** Mean transition cost of a degree sequence under a given prior. */
function scoreSequence(degrees: readonly number[], costs: ReadonlyArray<readonly number[]>): number {
  if (degrees.length < 2) return 0;
  let total = 0;
  for (let index = 0; index + 1 < degrees.length; index += 1) {
    const from = (degrees[index] as number) - 1;
    const to = (degrees[index + 1] as number) - 1;
    total += costs[from]?.[to] ?? 1;
  }
  return total / (degrees.length - 1);
}

const MAJOR_TEMPLATES = PROGRESSION_TEMPLATES.filter((template) =>
  template.modes.includes("major") && template.steps.length >= 3);

/**
 * Sequences of the same shape with no progression behind them.
 *
 * Built from a fixed generator rather than Math.random, so the figure this
 * test asserts against is the same on every machine and every run.
 */
function randomSequences(count: number, length: number): number[][] {
  let state = 0x2f6e2b1;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
  return Array.from({ length: count }, () =>
    Array.from({ length }, () => 1 + Math.floor(next() * 7)));
}

describe("the transition prior, measured on data it never saw", () => {
  it("scores a held-out real progression well below a random sequence", () => {
    // The claim the prior exists to support. Without this gap it is a lookup
    // table for twenty-eight sequences rather than a model of anything.
    let heldOutTotal = 0;
    for (const template of MAJOR_TEMPLATES) {
      const withoutIt = majorTransitionCosts({ exclude: new Set([template.id]) });
      heldOutTotal += scoreSequence(template.steps.map((step) => step.degree), withoutIt);
    }
    const heldOut = heldOutTotal / MAJOR_TEMPLATES.length;

    const costs = majorTransitionCosts();
    const lengths = MAJOR_TEMPLATES.map((template) => template.steps.length);
    const meanLength = Math.round(
      lengths.reduce((sum, value) => sum + value, 0) / lengths.length,
    );
    const random = randomSequences(400, meanLength);
    const randomScore = random.reduce(
      (sum, sequence) => sum + scoreSequence(sequence, costs), 0,
    ) / random.length;

    // Measured: held-out 0.435, random 0.698, a separation of 0.263. The bound
    // is set below that with room for the catalogue to grow, because a new
    // template makes every other template's held-out score a little different.
    expect(heldOut).toBeLessThan(randomScore);
    expect(randomScore - heldOut).toBeGreaterThan(0.15);
  });

  it("scores its own training data better than held-out data, which is the circularity", () => {
    // Kept as a test rather than a note, because the day these two converge is
    // the day the prior stops being fitted to its own catalogue -- and that is
    // worth finding out from a failing test rather than from a rediscovery.
    const inSample = MAJOR_TEMPLATES.reduce((sum, template) =>
      sum + scoreSequence(template.steps.map((step) => step.degree), majorTransitionCosts()),
    0) / MAJOR_TEMPLATES.length;

    const heldOut = MAJOR_TEMPLATES.reduce((sum, template) =>
      sum + scoreSequence(
        template.steps.map((step) => step.degree),
        majorTransitionCosts({ exclude: new Set([template.id]) }),
      ),
    0) / MAJOR_TEMPLATES.length;

    expect(inSample).toBeLessThan(heldOut);
  });

  it("leaves the shipped prior alone when nothing is excluded", () => {
    // The evaluation must not be able to change what the app uses.
    expect(JSON.stringify(majorTransitionCosts({ exclude: new Set() })))
      .toBe(JSON.stringify(majorTransitionCosts()));
  });

  it("actually removes a template's moves from the counts", () => {
    // Otherwise the whole evaluation is measuring nothing, and would still pass
    // every assertion above.
    const template = MAJOR_TEMPLATES[0]!;
    const full = majorTransitionCosts();
    const without = majorTransitionCosts({ exclude: new Set([template.id]) });
    expect(JSON.stringify(without)).not.toBe(JSON.stringify(full));

    const first = (template.steps[0]!.degree) - 1;
    const second = (template.steps[1]!.degree) - 1;
    // Its own first move must cost more once its votes are gone.
    expect(without[first]![second]!).toBeGreaterThan(full[first]![second]!);
  });
});
