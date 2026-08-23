import { describe, expect, it, vi } from "vitest";
import {
  MINIMAL_GENERATOR_SETTINGS,
  createDefaultSectionArrangement,
  assembleSectionArrangement,
  generateArrangementSection,
  reconcileSectionLinks,
  replaceChordSymbol,
  updateSectionDesign,
  validateSectionArrangement,
} from "../src/music";
import { generateComposition } from "../src/music/generator";
import { validateComposition, validateGeneratorSettings } from "../src/music/validation";
import { getScalePitchClasses, pitchClassToSemitone } from "../src/music/scales";
import type {
  GeneratorSettings,
  SectionArrangementPlan,
  SectionDesign,
} from "../src/types/music";

function settings(patch: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...MINIMAL_GENERATOR_SETTINGS,
    ...patch,
    melody: { ...MINIMAL_GENERATOR_SETTINGS.melody, ...patch.melody },
  };
}

describe("independent section arrangement domain", () => {
  it("creates a deterministic Intro → A → B → C plan with 8-bar sources", () => {
    const first = createDefaultSectionArrangement(settings({ seed: "default-arrangement" }));
    const second = createDefaultSectionArrangement(settings({ seed: "default-arrangement" }));
    expect(second).toEqual(first);
    expect(first.sequence.map((item) => item.sourceSectionId)).toEqual([
      "source-intro", "source-aMelo", "source-bMelo", "source-cMelo",
    ]);
    expect(first.sections.every((section) => section.design.bars === 8)).toBe(true);
    expect(validateSectionArrangement(first).errors).toEqual([]);
    expect(() => createDefaultSectionArrangement(settings({ mode: "naturalMinor", seed: "minor-arrangement" }))).not.toThrow();
  });

  it("chooses a usable default template for every role in every supported mode", () => {
    for (const mode of ["major", "naturalMinor", "harmonicMinor", "dorian", "mixolydian"] as const) {
      const plan = createDefaultSectionArrangement(settings({ mode, seed: `mode-${mode}` }));
      expect(validateSectionArrangement(plan).errors, mode).toEqual([]);
      expect(plan.sections).toHaveLength(4);
    }
  });

  it.each([8, 16, 24, 32] as const)("generates an independent %i-bar section", (bars) => {
    const design: SectionDesign = {
      id: `source-${bars}`,
      role: "aMelo",
      name: "A",
      templateId: "a-narrative",
      bars,
      key: "C",
      mode: "major",
      style: "pop",
      seed: `section-${bars}`,
    };
    const generated = generateArrangementSection(design, { baseSettings: settings() });
    expect(generated.material.settings.bars).toBe(bars);
    expect(generated.material.totalTicks).toBe(generated.material.ticksPerBar * bars);
    expect((generated.material as unknown as { arrangementPlan?: unknown }).arrangementPlan).toBeUndefined();
    expect(generated.dirty).toBe(false);
  });

  it("assembles 32 through 128 bars without mutating sources and preserves unique ids", () => {
    for (const sectionBars of [8, 16, 24, 32] as const) {
      const base = settings({ seed: `assembly-${sectionBars}` });
      const plan = createDefaultSectionArrangement(base);
      plan.sections = plan.sections.map((source) => ({
        ...generateArrangementSection(
          { ...source.design, bars: sectionBars },
          { baseSettings: base, projectSeed: base.seed },
        ),
      }));
      const sourceBefore = structuredClone(plan.sections[0]?.material);
      for (let total = 32; total <= 128; total += 32) {
        if (total % sectionBars !== 0) continue;
        const count = total / sectionBars;
        const sequence = Array.from({ length: count }, (_, index) => ({
          id: `instance-${sectionBars}-${index}`,
          sourceSectionId: plan.sections[index % plan.sections.length]!.design.id,
        }));
        const arranged = reconcileSectionLinks({ ...plan, sequence }, sequence);
        const assembled = assembleSectionArrangement(arranged, base);
        expect(assembled.ok, `${sectionBars}/${total}`).toBe(true);
        if (!assembled.ok) continue;
        expect(assembled.composition.settings.bars).toBe(total);
        expect(assembled.composition.bars).toHaveLength(total);
        expect(validateComposition(assembled.composition).errors).toEqual([]);
        const ids = [
          ...assembled.composition.chords.map((item) => item.id),
          ...assembled.composition.notes.map((item) => item.id),
          ...(assembled.composition.voices ?? []).flatMap((voice) => [voice.id, ...voice.notes.map((item) => item.id)]),
        ];
        expect(new Set(ids).size).toBe(ids.length);
      }
      expect(plan.sections[0]?.material).toEqual(sourceBefore);
    }
  });

  it("smooths chord and melody seams and merges repeated voice roles", () => {
    const base = settings({
      seed: "seam-smoothing",
      arrangement: {
        counterpoint: {
          enabled: true,
          position: "above",
          independence: 0.42,
        },
      },
    });
    const plan = createDefaultSectionArrangement(base);
    const assembled = assembleSectionArrangement(plan, base);
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const composition = assembled.composition;
    for (const section of composition.sections?.slice(1) ?? []) {
      const boundaryTick = section.startBar * composition.ticksPerBar;
      const before = composition.chords.filter((chord) => chord.startTick < boundaryTick).at(-1);
      const after = composition.chords.find((chord) => chord.startTick >= boundaryTick);
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      if (!before || !after) continue;
      const closestVoiceDistance = Math.min(
        ...before.notes.flatMap((left) => after.notes.map((right) => Math.abs(left - right))),
      );
      expect(closestVoiceDistance).toBeLessThanOrEqual(12);

      const previousMelody = composition.notes.filter((note) => note.startTick < boundaryTick).at(-1);
      const nextMelody = composition.notes.find((note) => note.startTick >= boundaryTick);
      if (previousMelody && nextMelody) expect(Math.abs(nextMelody.midi - previousMelody.midi)).toBeLessThanOrEqual(24);
    }
    const voiceKeys = new Set((composition.voices ?? []).map((voice) => `${voice.role}:${voice.instrument}`));
    expect((composition.voices ?? []).length).toBe(voiceKeys.size);
  });

  it("supports repeats and reordering by stable instance ids", () => {
    const base = settings({ seed: "repeat-reorder" });
    const plan = createDefaultSectionArrangement(base);
    const sequence = [
      { id: "i-c", sourceSectionId: "source-cMelo" },
      { id: "i-a", sourceSectionId: "source-aMelo" },
      { id: "i-a2", sourceSectionId: "source-aMelo" },
    ];
    const next = reconcileSectionLinks(plan, sequence);
    expect(next.links).toHaveLength(2);
    const assembled = assembleSectionArrangement(next, base);
    expect(assembled.ok).toBe(true);
    expect(assembled.ok && assembled.composition.sections?.map((section) => section.id)).toEqual([
      "i-c", "i-a", "i-a2",
    ]);
  });

  it("keeps assembly lifecycle stable and increments revision only for real mutations", () => {
    const base = settings({ seed: "lifecycle" });
    const plan = createDefaultSectionArrangement(base);
    expect(plan.assembledRevision).toBeNull();
    const assembled = assembleSectionArrangement(plan, base);
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    expect(assembled.plan.assembledRevision).toBe(plan.revision);
    expect(assembled.plan.resolvedLinks).toEqual(assembled.resolvedLinks);
    expect(validateSectionArrangement(assembled.plan).errors).toEqual([]);
    const repeated = assembleSectionArrangement(assembled.plan, base);
    expect(repeated).toEqual(assembled);

    const noOp = reconcileSectionLinks(plan, plan.sequence);
    expect(noOp).toBe(plan);
    expect(noOp.revision).toBe(plan.revision);
    const reordered = reconcileSectionLinks(plan, [
      { id: "instance-c", sourceSectionId: "source-cMelo" },
      { id: "instance-intro", sourceSectionId: "source-intro" },
      { id: "instance-aMelo", sourceSectionId: "source-aMelo" },
      { id: "instance-bMelo", sourceSectionId: "source-bMelo" },
    ]);
    expect(reordered.revision).toBe(plan.revision + 1);
    expect(reconcileSectionLinks(reordered, reordered.sequence)).toBe(reordered);
    expect(updateSectionDesign(plan, "source-intro", {})).toBe(plan);
    expect(updateSectionDesign(plan, "source-intro", { name: "Intro draft" }).revision).toBe(plan.revision + 1);
    const fixedIdentity = updateSectionDesign(plan, "source-intro", { id: "mutated", role: "cMelo" } as never);
    expect(fixedIdentity.sections[0]?.design.id).toBe("source-intro");
    expect(fixedIdentity.sections[0]?.design.role).toBe("intro");
    const isolatedSequence = reconcileSectionLinks(plan, [
      { id: "instance-c", sourceSectionId: "source-cMelo" },
      { id: "instance-intro", sourceSectionId: "source-intro" },
      { id: "instance-aMelo", sourceSectionId: "source-aMelo" },
      { id: "instance-bMelo", sourceSectionId: "source-bMelo" },
    ]);
    const reusedLink = isolatedSequence.links.find((link) => link.fromInstanceId === "instance-aMelo" && link.toInstanceId === "instance-bMelo")!;
    reusedLink.mode = "direct";
    expect(plan.links.find((link) => link.fromInstanceId === "instance-aMelo" && link.toInstanceId === "instance-bMelo")?.mode).toBe("auto");
    const isolatedDesign = updateSectionDesign(plan, "source-intro", { name: "isolated" });
    isolatedDesign.sections[0]!.material.chords[0]!.symbol = "mutated";
    expect(plan.sections[0]!.material.chords[0]!.symbol).not.toBe("mutated");
    const assembledReordered = reconcileSectionLinks(assembled.plan, reordered.sequence);
    expect(assembledReordered.resolvedLinks).toEqual([]);
    expect(updateSectionDesign(assembled.plan, "source-intro", { name: "Edited after assembly" }).resolvedLinks).toEqual([]);
  });

  it("keeps a link seed and transition choice stable when its pair moves", () => {
    const base = settings({ seed: "stable-link" });
    const plan = createDefaultSectionArrangement(base);
    const original = assembleSectionArrangement(plan, base);
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    const movedSequence = [
      { id: "instance-c", sourceSectionId: "source-cMelo" },
      { id: "instance-intro", sourceSectionId: "source-intro" },
      { id: "instance-aMelo", sourceSectionId: "source-aMelo" },
      { id: "instance-bMelo", sourceSectionId: "source-bMelo" },
    ];
    const moved = reconcileSectionLinks(plan, movedSequence);
    const oldLink = plan.links.find((link) => link.fromInstanceId === "instance-aMelo" && link.toInstanceId === "instance-bMelo");
    const newLink = moved.links.find((link) => link.fromInstanceId === "instance-aMelo" && link.toInstanceId === "instance-bMelo");
    expect(newLink?.seed).toBe(oldLink?.seed);
    const movedResult = assembleSectionArrangement(moved, base);
    expect(movedResult.ok).toBe(true);
    if (!movedResult.ok) return;
    const originalResolved = original.resolvedLinks.find((link) => link.fromInstanceId === "instance-aMelo" && link.toInstanceId === "instance-bMelo");
    const movedResolved = movedResult.resolvedLinks.find((link) => link.fromInstanceId === "instance-aMelo" && link.toInstanceId === "instance-bMelo");
    expect(movedResolved?.technique).toBe(originalResolved?.technique);
    expect(movedResolved?.label).toBe(originalResolved?.label);
  });

  it("resolves auto same-key, forced dominant, valid pivot and invalid pivot fail-closed", () => {
    const base = settings({ seed: "link-modes" });
    const plan = createDefaultSectionArrangement(base);
    const auto = assembleSectionArrangement(plan, base);
    expect(auto.ok).toBe(true);
    expect(auto.ok && auto.resolvedLinks.every((link) => link.boundaryBar > 0)).toBe(true);

    const dominantPlan = {
      ...plan,
      links: plan.links.map((link) => ({ ...link, mode: "dominant" as const })),
    };
    const dominant = assembleSectionArrangement(dominantPlan, base);
    expect(dominant.ok).toBe(true);
    expect(dominant.ok && dominant.resolvedLinks.every((link) => link.technique === "secondaryDominant")).toBe(true);

    const pivotPlan = {
      ...plan,
      sections: plan.sections.map((source, index) => index === 1
        ? { ...source, design: { ...source.design, key: "F" as const } }
        : source),
      links: plan.links.map((link, index) => index === 0 ? { ...link, mode: "pivot" as const } : link),
    };
    // The design/material mismatch is intentionally rejected before a pivot
    // could be applied; regenerate the changed source to keep it a valid plan.
    pivotPlan.sections[1] = generateArrangementSection(pivotPlan.sections[1]!.design, { baseSettings: base });
    const pivot = assembleSectionArrangement(pivotPlan, base);
    expect(pivot.ok).toBe(true);
    expect(pivot.ok && pivot.resolvedLinks[0]?.technique).toBe("pivot");

    const invalidPivotPlan = {
      ...plan,
      sections: plan.sections.map((source, index) => index === 1
        ? { ...source, design: { ...source.design, key: "F#" as const } }
        : source),
      links: plan.links.map((link, index) => index === 0 ? { ...link, mode: "pivot" as const } : link),
    };
    invalidPivotPlan.sections[1] = generateArrangementSection(invalidPivotPlan.sections[1]!.design, { baseSettings: base });
    const invalidPivot = assembleSectionArrangement(invalidPivotPlan, base);
    expect(invalidPivot.ok).toBe(false);
    expect(!invalidPivot.ok && invalidPivot.issues.some((item) => item.code === "link.pivotUnavailable")).toBe(true);

    const sameKeyPivot = assembleSectionArrangement({
      ...plan,
      links: plan.links.map((link, index) => index === 0 ? { ...link, mode: "pivot" as const } : link),
    }, base);
    expect(sameKeyPivot.ok).toBe(false);
    expect(!sameKeyPivot.ok && sameKeyPivot.issues.some((item) => item.code === "link.pivotSameKey")).toBe(true);
  });

  it("uses truthful common-tone versus voice-leading labels and protects transition windows", () => {
    const base = settings({ seed: "truthful-links" });
    const directPlan = createDefaultSectionArrangement(base);
    directPlan.links = directPlan.links.map((link) => ({ ...link, mode: "direct" as const }));
    const direct = assembleSectionArrangement(directPlan, base);
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    expect(direct.resolvedLinks.every((link) => link.technique === "direct")).toBe(true);

    const dominantPlan = createDefaultSectionArrangement(base);
    dominantPlan.links = dominantPlan.links.map((link, index) => index === 0 ? { ...link, mode: "dominant" as const } : link);
    const dominant = assembleSectionArrangement(dominantPlan, base);
    expect(dominant.ok).toBe(true);
    if (!dominant.ok) return;
    const transition = dominant.composition.chords.find((chord) => chord.id === "link-instance-intro-instance-aMelo:transition");
    expect(transition).toBeDefined();
    if (transition) {
      const incoming = dominant.composition.sections?.find((section) => section.id === "instance-aMelo");
      const scale = new Set(getScalePitchClasses(incoming?.key ?? "C", incoming?.mode ?? "major").map(pitchClassToSemitone));
      const windowNotes = dominant.composition.notes.filter((note) => note.startTick >= transition.startTick && note.startTick < transition.startTick + transition.durationTick);
      expect(windowNotes.length).toBeGreaterThan(0);
      for (const note of windowNotes) {
        const pitchClass = note.midi % 12;
        const chordTone = transition.notes.some((tone) => tone % 12 === pitchClass);
        const scaleTone = scale.has(pitchClass);
        expect(chordTone || scaleTone).toBe(true);
        expect(note.role).toBe(chordTone ? "chordTone" : "scaleTone");
      }
    }

    const shortPlan = createDefaultSectionArrangement(base);
    shortPlan.links = shortPlan.links.map((link, index) => index === 0 ? { ...link, mode: "dominant" as const } : link);
    const shortMaterial = shortPlan.sections[0]!.material;
    const last = shortMaterial.chords.at(-1)!;
    const previous = shortMaterial.chords.at(-2)!;
    const shortStart = shortMaterial.totalTicks - shortMaterial.ticksPerBar / 4;
    shortPlan.sections[0] = {
      ...shortPlan.sections[0]!,
      material: {
        ...shortMaterial,
        chords: [
          ...shortMaterial.chords.slice(0, -2),
          { ...previous, durationTick: shortStart - previous.startTick },
          { ...last, startTick: shortStart, durationTick: shortMaterial.ticksPerBar / 4 },
        ],
      },
    };
    const short = assembleSectionArrangement(shortPlan, base);
    expect(short.ok).toBe(false);
    expect(!short.ok && short.issues.some((item) => item.code === "link.transitionWindow")).toBe(true);
  });

  it("reports commonTone and voiceLeading for actual no-transition boundaries", () => {
    const base = settings({ seed: "truthful-no-transition" });
    const sequence = [
      { id: "from", sourceSectionId: "source-intro" },
      { id: "to", sourceSectionId: "source-aMelo" },
    ];
    const makePlan = (lastSymbol: string, seed: string): SectionArrangementPlan => {
      const sourcePlan = createDefaultSectionArrangement(settings({ ...base, seed }));
      const from = sourcePlan.sections.find((section) => section.design.id === "source-intro")!;
      const last = from.material.chords.at(-1)!;
      from.material = {
        ...from.material,
        chords: [...from.material.chords.slice(0, -1), replaceChordSymbol(last, lastSymbol, "C", "major")],
      };
      const link = sourcePlan.links[0]!;
      return reconcileSectionLinks({
        ...sourcePlan,
        sequence,
        links: [{ ...link, fromInstanceId: "from", toInstanceId: "to", mode: "auto" as const }],
      }, sequence);
    };
    const common = assembleSectionArrangement(makePlan("G7", "common-tone-case"), base);
    expect(common.ok).toBe(true);
    expect(common.ok && common.resolvedLinks[0]?.technique).toBe("commonTone");

    let noCommon: ReturnType<typeof assembleSectionArrangement> | undefined;
    for (let index = 0; index < 128 && noCommon?.ok !== true; index += 1) {
      noCommon = assembleSectionArrangement(makePlan("Bdim", `voice-leading-case-${index}`), base);
      if (noCommon.ok && noCommon.resolvedLinks[0]?.technique !== "voiceLeading") noCommon = undefined;
    }
    expect(noCommon?.ok).toBe(true);
    expect(noCommon?.ok && noCommon.resolvedLinks[0]?.technique).toBe("voiceLeading");
  });

  it("fails closed when a narrow melody range has no legal transition pitch", () => {
    const sourceBase = settings({ seed: "truthful-links" });
    const plan = createDefaultSectionArrangement(sourceBase);
    plan.links = plan.links.map((link, index) => index === 0 ? { ...link, mode: "dominant" as const } : link);
    const narrowBase = {
      ...sourceBase,
      key: "D" as const,
      melody: { ...sourceBase.melody, minMidi: 61, maxMidi: 61 },
    };
    const assembled = assembleSectionArrangement(plan, narrowBase);
    expect(assembled.ok).toBe(false);
    expect(!assembled.ok && assembled.issues.some((item) => item.code === "link.melodyWindow")).toBe(true);
    expect(assembled).not.toHaveProperty("composition");
  });

  it("uses incoming section style, complete transition symbols, and project BPM override", () => {
    const project = settings({ seed: "local-style", style: "pop" });
    const plan = createDefaultSectionArrangement(project);
    plan.sections = plan.sections.map((source) => {
      const design = { ...source.design, style: "jazz" as const };
      return generateArrangementSection(design, { baseSettings: project, projectSeed: project.seed });
    });
    const popProject = assembleSectionArrangement(plan, project);
    const jazzProject = assembleSectionArrangement(plan, { ...project, style: "jazz" });
    expect(popProject.ok).toBe(true);
    expect(jazzProject.ok).toBe(true);
    if (!popProject.ok || !jazzProject.ok) return;
    expect(jazzProject.resolvedLinks).toEqual(popProject.resolvedLinks);

    let subdominant: typeof popProject | undefined;
    for (let index = 0; index < 160 && !subdominant; index += 1) {
      const candidateBase = settings({ seed: `subdominant-${index}`, style: "jazz" });
      const candidatePlan = createDefaultSectionArrangement(candidateBase);
      const candidate = assembleSectionArrangement(candidatePlan, candidateBase);
      if (candidate.ok && candidate.resolvedLinks.some((link) => link.technique === "subdominantPrep")) subdominant = candidate;
    }
    expect(subdominant).toBeDefined();
    if (subdominant) {
      const link = subdominant.resolvedLinks.find((item) => item.technique === "subdominantPrep")!;
      const transition = subdominant.composition.chords.find((chord) => chord.id === `${link.linkId}:transition`)!;
      expect(transition.symbol.endsWith("maj7") || transition.symbol.endsWith("m7")).toBe(true);
    }

    const old = assembleSectionArrangement(plan, project);
    const changedBpm = assembleSectionArrangement(plan, { ...project, bpm: 90 });
    expect(old.ok).toBe(true);
    expect(changedBpm.ok).toBe(true);
    if (old.ok && changedBpm.ok) {
      expect(changedBpm.composition.settings.bpm).toBe(90);
      expect(changedBpm.composition.totalTicks).toBe(old.composition.totalTicks);
      expect(changedBpm.composition.chords).toEqual(old.composition.chords);
      expect(changedBpm.composition.notes).toEqual(old.composition.notes);
    }
  });

  it("keeps one octave offset per incoming instance and preserves ordinary generator bar limits", () => {
    const base = settings({ seed: "instance-register" });
    const plan = createDefaultSectionArrangement(base);
    const sequence = [
      { id: "first", sourceSectionId: "source-intro" },
      { id: "second", sourceSectionId: "source-aMelo" },
    ];
    const directPlan = reconcileSectionLinks({
      ...plan,
      sequence,
      links: plan.links.slice(0, 1).map((link) => ({ ...link, fromInstanceId: "first", toInstanceId: "second", mode: "direct" as const })),
    }, sequence);
    const assembled = assembleSectionArrangement(directPlan, base);
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    for (const [instanceId, sourceId] of [["first", "source-intro"], ["second", "source-aMelo"]] as const) {
      const source = plan.sections.find((section) => section.design.id === sourceId)!;
      const actual = assembled.composition.notes.filter((note) => note.id.startsWith(`${instanceId}:`));
      const offsets = actual.map((note) => note.midi - source.material.notes.find((candidate) => note.id.endsWith(`:${candidate.id}`))!.midi);
      expect(new Set(offsets).size).toBeLessThanOrEqual(1);
      if (instanceId === "first") expect(offsets.every((offset) => offset === 0)).toBe(true);
      const sourceIntervals = source.material.notes.slice(1).map((note, index) => note.midi - source.material.notes[index]!.midi);
      const actualIntervals = actual.slice(1).map((note, index) => note.midi - actual[index]!.midi);
      expect(actualIntervals).toEqual(sourceIntervals);
      expect(actual.every((note, index) => note.midi % 12 === source.material.notes[index]!.midi % 12)).toBe(true);
    }
  
    const wide = { ...base, bars: 128 as const };
    expect(validateGeneratorSettings(wide).valid).toBe(false);
    expect(() => generateComposition(wide)).toThrow();
  });

  it("rejects dirty, missing, malformed and over-128 plans", () => {
    const base = settings({ seed: "invalid-plans" });
    const plan = createDefaultSectionArrangement(base);
    expect(assembleSectionArrangement({ ...plan, sections: [{ ...plan.sections[0]!, dirty: true }, ...plan.sections.slice(1)] }, base).ok).toBe(false);
    expect(assembleSectionArrangement({ ...plan, sequence: [{ id: "missing", sourceSectionId: "nope" }], links: [] }, base).ok).toBe(false);
    expect(validateSectionArrangement({ ...plan, sequence: Array.from({ length: 17 }, (_, index) => ({ id: `over-${index}`, sourceSectionId: "source-intro" })), links: [] }).valid).toBe(false);
  });

  it("does not depend on Math.random", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("section arrangement must use a derived seed");
    });
    try {
      expect(createDefaultSectionArrangement(settings({ seed: "no-global-random" })).sequence).toHaveLength(4);
    } finally {
      random.mockRestore();
    }
  });

  it("keeps dirty drafts valid but blocks only referenced dirty sources", () => {
    const base = settings({ seed: "dirty-draft" });
    const plan = createDefaultSectionArrangement(base);
    const dirty = updateSectionDesign(plan, "source-cMelo", { key: "D" });
    expect(validateSectionArrangement(dirty).valid).toBe(true);
    expect(assembleSectionArrangement(dirty, base).ok).toBe(false);
    const sequence = dirty.sequence.slice(0, 3);
    const withoutDirty = reconcileSectionLinks(dirty, sequence);
    expect(assembleSectionArrangement(withoutDirty, base).ok).toBe(true);
  });

  it("returns validation issues instead of throwing for malformed plans", () => {
    const plan = createDefaultSectionArrangement(settings({ seed: "malformed" }));
    const first = plan.sections[0]!;
    const malformed = [
      null,
      [],
      { ...plan, sections: [null], sequence: [null], links: [null], resolvedLinks: [null] },
      { ...plan, sections: 12, sequence: 12, links: 12, resolvedLinks: 12 },
      { ...plan, sections: [{ ...first, material: { settings: null } }], sequence: [], links: [] },
      { ...plan, sections: [{ ...first, design: { ...first.design, seed: Number.POSITIVE_INFINITY } }] },
      { ...plan, assembledRevision: plan.revision + 1 },
    ] as unknown[];
    for (const candidate of malformed) {
      expect(() => validateSectionArrangement(candidate as SectionArrangementPlan)).not.toThrow();
      expect(validateSectionArrangement(candidate as SectionArrangementPlan).valid).toBe(false);
    }
  });
});
