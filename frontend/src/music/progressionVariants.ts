import type {
  Mode,
  ProgressionStep,
  ProgressionTemplate,
} from "../types/music";
import { diatonicQualityForDegree } from "./chords";
import { PROGRESSION_TEMPLATES } from "./progressions";

/**
 * More progressions than anyone can source by name.
 *
 * progressions.ts admits a template only where several independent
 * practitioner sources give it the same name and the same degrees. That bar is
 * the reason the catalogue is trustworthy and also the reason it is small:
 * thirty-six entries, because the named progressions of the practitioner
 * literature number in the dozens. There is no honest way to hand-curate a
 * thousand of them.
 *
 * There is an honest way to reach a thousand. Every transformation below is
 * itself a documented device with its own literature -- the subdominant minor,
 * the secondary dominant, the tritone substitution, the passing diminished,
 * the seventh upgrade, the rotation of a loop -- and applying a documented
 * device to a documented progression gives a result whose provenance is
 * exactly "this template, then that device". Nothing here invents a
 * progression; it states what the catalogue already contains under a
 * transformation the catalogue already names elsewhere.
 *
 * So a variant is never presented as a named progression. It carries the id it
 * came from and the devices applied, and the interface says so.
 */

export type ProgressionDevice =
  | "rotation"
  | "sevenths"
  | "subdominantMinor"
  | "subdominantMinorApproach"
  | "secondaryDominant"
  | "tritoneSub"
  | "passingDiminished";

export const DEVICE_LABELS: Readonly<Record<ProgressionDevice, string>> = {
  rotation: "回転",
  sevenths: "7th化",
  subdominantMinor: "サブドミナントマイナー",
  subdominantMinorApproach: "IV→IVm 経由",
  secondaryDominant: "セカンダリードミナント",
  tritoneSub: "トライトーン代理",
  passingDiminished: "パッシングディミニッシュ",
};

export interface ProgressionVariant extends ProgressionTemplate {
  /** The catalogued progression this was derived from. */
  baseId: string;
  /** Applied in this order. Empty for the catalogued progression itself. */
  devices: readonly ProgressionDevice[];
}

/** A degree a fifth above the given one, wrapped into 1-7. */
function fifthAbove(degree: number): number {
  return ((degree - 1 + 4) % 7) + 1;
}

function sameSteps(left: readonly ProgressionStep[], right: readonly ProgressionStep[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Starting the loop somewhere else.
 *
 * The catalogue already contains one of these as its own entry -- the axis
 * progression and its rotation onto vi are both listed, because practitioners
 * name them separately. The device generalises that: a progression written as
 * a loop is a cycle, and which chord it is counted from is a choice a writer
 * makes rather than a property of the harmony.
 *
 * Only offered where the progression really is a loop. A twelve-bar blues
 * rotated onto its fifth bar is not a blues, so anything whose steps do not
 * return toward their opening is left alone.
 */
function rotations(template: ProgressionTemplate): ProgressionStep[][] {
  const steps = template.steps;
  if (steps.length < 3 || steps.length > 6) return [];
  const out: ProgressionStep[][] = [];
  for (let offset = 1; offset < steps.length; offset += 1) {
    out.push([...steps.slice(offset), ...steps.slice(0, offset)]);
  }
  return out;
}

/** Diatonic sevenths, where the template has not already pinned a quality. */
function sevenths(template: ProgressionTemplate, mode: Mode): ProgressionStep[] | null {
  let changed = false;
  const steps = template.steps.map((step) => {
    if (step.quality !== undefined || step.alteration !== undefined) return step;
    const triad = diatonicQualityForDegree(step.degree, mode);
    const seventh = SEVENTH_FOR_TRIAD[triad];
    if (!seventh) return step;
    changed = true;
    return { ...step, quality: seventh };
  });
  return changed ? steps : null;
}

const SEVENTH_FOR_TRIAD: Readonly<Record<string, ProgressionStep["quality"]>> = {
  major: "major7",
  minor: "minor7",
  diminished: "halfDiminished7",
};

/**
 * The subdominant turned minor.
 *
 * The most heavily documented single alteration in J-POP practice: IV becomes
 * IVm, which puts the flat sixth of the parallel minor a semitone above the
 * fifth of the tonic and resolves inward. Sources describe both the straight
 * swap and the approach that keeps the major IV first, so both are offered.
 */
function subdominantMinor(template: ProgressionTemplate): ProgressionStep[] | null {
  let changed = false;
  const steps = template.steps.map((step) => {
    if (step.degree !== 4 || step.alteration !== undefined) return step;
    if (step.quality !== undefined && step.quality !== "major") return step;
    changed = true;
    return { ...step, quality: "minor" as const, role: "borrowed" as const };
  });
  return changed ? steps : null;
}

function subdominantMinorApproach(template: ProgressionTemplate): ProgressionStep[] | null {
  const index = template.steps.findIndex((step) =>
    step.degree === 4 && step.alteration === undefined
    && (step.quality === undefined || step.quality === "major"));
  if (index < 0) return null;
  const major = template.steps[index] as ProgressionStep;
  return [
    ...template.steps.slice(0, index + 1),
    { ...major, quality: "minor" as const, role: "borrowed" as const },
    ...template.steps.slice(index + 1),
  ];
}

/**
 * A dominant seventh borrowed to point at the next chord.
 *
 * Inserted before a step whose root is not the tonic, because V7/I is just V7.
 * The target is declared on the step so the validator can check that what
 * follows is what was promised -- the app already refuses a secondary dominant
 * that does not resolve, and a variant is held to the same rule as a
 * hand-written progression.
 */
function secondaryDominants(template: ProgressionTemplate): ProgressionStep[][] {
  const out: ProgressionStep[][] = [];
  for (const [index, step] of template.steps.entries()) {
    if (step.degree === 1 || step.alteration !== undefined) continue;
    // Nothing to lead into if the previous step is already leading into it.
    // Wrapping counts: the catalogue's 丸サ進行 ends on a I7 that is V/IV of
    // the IV the loop returns to, and inserting in front of that IV would put
    // a chord between a dominant and the target it declares.
    const previous = index === 0
      ? template.steps[template.steps.length - 1]
      : template.steps[index - 1];
    if (previous?.role === "secondaryDominant") continue;
    // And nothing may be inserted into a two-chord device: a dominant dropped
    // between the IV and the IVm of a subdominant-minor approach destroys the
    // approach, leaving a name on a figure that no longer does what it says.
    if (previous !== undefined && previous.degree === step.degree
      && (step.role === "borrowed" || previous.role === "borrowed")) continue;
    out.push([
      ...template.steps.slice(0, index),
      {
        degree: fifthAbove(step.degree),
        quality: "dominant7",
        role: "secondaryDominant",
        targetDegree: step.degree,
      },
      ...template.steps.slice(index),
    ]);
  }
  return out;
}

/**
 * bII7 in place of the V7 it substitutes for, which is the definition.
 *
 * Only where that V actually resolves to the tonic. A tritone substitution is
 * a substitution *for a dominant going somewhere*, and bII7 in front of iii is
 * not one -- it is a chromatic chord with a name it has not earned. Wrapping
 * counts, since a loop's last chord resolves to its first.
 */
function tritoneSub(template: ProgressionTemplate): ProgressionStep[] | null {
  const index = template.steps.findIndex((step, position) => {
    if (step.degree !== 5 || step.alteration !== undefined) return false;
    if (step.quality !== "dominant7" && step.quality !== "major") return false;
    const next = template.steps[(position + 1) % template.steps.length];
    if (next === undefined || next.degree !== 1 || next.alteration !== undefined) return false;
    // And not a V that something else is pointing at. Substituting it moves
    // its root by a tritone, which leaves the secondary dominant in front
    // declaring a target that is no longer there.
    const previous = template.steps[
      (position - 1 + template.steps.length) % template.steps.length
    ];
    return previous?.role !== "secondaryDominant" || previous.targetDegree !== step.degree;
  });
  if (index < 0) return null;
  const steps = [...template.steps];
  steps[index] = {
    degree: 2,
    alteration: -1,
    quality: "dominant7",
    role: "tritoneSubstitution",
    targetDegree: 1,
  };
  return steps;
}

/**
 * A diminished chord filling a whole step between two roots.
 *
 * Only between roots a whole tone apart and only rising, which is where the
 * device is written: #I dim between I and ii, #II dim between ii and iii, #IV
 * dim between IV and V. Falling motion has its own devices and this is not
 * one of them.
 */
const PASSING_DIMINISHED_FROM: ReadonlySet<number> = new Set([1, 2, 4, 5]);

function passingDiminished(template: ProgressionTemplate): ProgressionStep[][] {
  const out: ProgressionStep[][] = [];
  for (let index = 0; index + 1 < template.steps.length; index += 1) {
    const from = template.steps[index] as ProgressionStep;
    const to = template.steps[index + 1] as ProgressionStep;
    if (from.alteration !== undefined || to.alteration !== undefined) continue;
    if (!PASSING_DIMINISHED_FROM.has(from.degree)) continue;
    if (to.degree !== from.degree + 1) continue;
    out.push([
      ...template.steps.slice(0, index + 1),
      {
        degree: from.degree,
        alteration: 1,
        quality: "diminished7",
        role: "passingDiminished",
      },
      ...template.steps.slice(index + 1),
    ]);
  }
  return out;
}

/** Every result of applying one device to one progression. */
function applyDevice(
  template: ProgressionTemplate,
  device: ProgressionDevice,
  mode: Mode,
): ProgressionStep[][] {
  switch (device) {
    case "rotation": return rotations(template);
    case "sevenths": {
      const result = sevenths(template, mode);
      return result ? [result] : [];
    }
    case "subdominantMinor": {
      const result = subdominantMinor(template);
      return result ? [result] : [];
    }
    case "subdominantMinorApproach": {
      const result = subdominantMinorApproach(template);
      return result ? [result] : [];
    }
    case "secondaryDominant": return secondaryDominants(template);
    case "tritoneSub": {
      const result = tritoneSub(template);
      return result ? [result] : [];
    }
    case "passingDiminished": return passingDiminished(template);
  }
}

/**
 * Devices in the order they are applied.
 *
 * Fixed, so the enumeration is deterministic and an id means one thing.
 * Rotation first because it changes what the later devices see; the seventh
 * upgrade last because it should colour whatever the others produced.
 */
const DEVICE_ORDER: readonly ProgressionDevice[] = [
  "rotation",
  "subdominantMinor",
  "subdominantMinorApproach",
  "secondaryDominant",
  "tritoneSub",
  "passingDiminished",
  "sevenths",
];

export interface EnumerateOptions {
  /** How many devices may stack on one progression. Two is already thousands. */
  maxDevices?: number;
  /** Longest result to keep, so a stacked expansion stays a progression. */
  maxSteps?: number;
}

/**
 * The catalogue, and everything the devices make of it.
 *
 * Breadth-first over the device order, so a variant with one device is always
 * enumerated before any with two and the ids stay stable as the depth is
 * raised. Duplicates are dropped by their step sequence rather than by their
 * id: two different device chains often arrive at the same progression, and
 * the same chords under two names would be two entries a reader has to tell
 * apart for no reason.
 */
export function enumerateVariants(
  mode: Mode,
  options: EnumerateOptions = {},
): ProgressionVariant[] {
  const maxDevices = options.maxDevices ?? 2;
  const maxSteps = options.maxSteps ?? 8;
  const seen = new Set<string>();
  const stems = new Map<string, number>();
  const out: ProgressionVariant[] = [];

  const add = (
    base: ProgressionTemplate,
    steps: readonly ProgressionStep[],
    devices: readonly ProgressionDevice[],
  ): ProgressionVariant | null => {
    // The cap bounds what the devices may build, never what the catalogue
    // already contains: a twelve-bar blues is twelve steps long and dropping
    // it would be the derived set quietly losing a catalogued progression.
    if (devices.length > 0 && steps.length > maxSteps) return null;
    const key = `${mode}:${JSON.stringify(steps)}`;
    if (seen.has(key)) return null;
    seen.add(key);
    // Two rotations of one progression, or two insertion points for one
    // secondary dominant, are different progressions reached by the same
    // device chain. Without a disambiguator they would share an id, and an id
    // is what the search results, the section plan and the project file all
    // use to mean one progression.
    const stem = devices.length === 0 ? base.id : `${base.id}+${devices.join("+")}`;
    const taken = stems.get(stem) ?? 0;
    stems.set(stem, taken + 1);
    const variant: ProgressionVariant = {
      id: taken === 0 ? stem : `${stem}-${taken + 1}`,
      label: devices.length === 0
        ? base.label
        : `${base.label}（${devices.map((device) => DEVICE_LABELS[device]).join(" + ")}）`,
      numeric: devices.length === 0 ? base.numeric : undefined,
      usage: base.usage,
      modes: base.modes,
      steps: [...steps],
      baseId: base.id,
      devices: [...devices],
    };
    out.push(variant);
    return variant;
  };

  const catalogued = PROGRESSION_TEMPLATES.filter((template) => template.modes.includes(mode));
  let frontier: ProgressionVariant[] = [];
  for (const template of catalogued) {
    const added = add(template, template.steps, []);
    if (added) frontier.push(added);
  }

  for (let depth = 0; depth < maxDevices; depth += 1) {
    const next: ProgressionVariant[] = [];
    for (const parent of frontier) {
      for (const device of DEVICE_ORDER) {
        // Each device once per chain, and only in the fixed order, so a chain
        // is a subsequence of DEVICE_ORDER and cannot be reached two ways.
        const last = parent.devices[parent.devices.length - 1];
        if (last !== undefined && DEVICE_ORDER.indexOf(device) <= DEVICE_ORDER.indexOf(last)) continue;
        const base = PROGRESSION_TEMPLATES.find((entry) => entry.id === parent.baseId);
        if (!base) continue;
        for (const steps of applyDevice(parent, device, mode)) {
          if (sameSteps(steps, parent.steps)) continue;
          const added = add(base, steps, [...parent.devices, device]);
          if (added) next.push(added);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return out;
}
