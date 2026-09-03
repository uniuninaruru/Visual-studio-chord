import type {
  BarCount,
  ChordEvent,
  GeneratedComposition,
  GeneratorSettings,
  Mode,
  NoteEvent,
  ResolvedSectionLink,
  SectionArrangementLength,
  SectionArrangementPlan,
  SectionArrangementRole,
  SectionDesign,
  SectionLinkConfig,
  SectionLinkMode,
  SectionLinkTechnique,
  SectionMaterial,
  SectionSequenceInstance,
  SectionSourceDefinition,
  SectionTemplateId,
  StylePresetId,
  ValidationResult,
  VoiceLeadingSettings,
} from "../types/music";
import {
  createDiatonicChordEvent,
  voiceChord,
} from "./chords";
import { bassRegisterPitch } from "./compositionTracks";
import { withHands } from "./hands";
import { findPivotChords } from "./modulation";
import { generateComposition } from "./generator";
import { planTransition, transitionsInto, type TransitionChord } from "./sectionTransitions";
import { getProgressionTemplate } from "./progressions";
import { deriveSeed, hashSeed, type Seed } from "./random";
import { revoiceInFourParts } from "./voiceLeading";
import {
  getScalePitchClasses,
  isSupportedMode,
  midiToNoteName,
  normalizePitchClass,
  pitchClassToSemitone,
} from "./scales";
import { createBars, ticksPerBar } from "./time";
import { validateComposition, validateGeneratorSettings } from "./validation";

/** A stable catalogue entry decouples the UI-facing template id from a progression id. */
export interface SectionTemplate {
  id: SectionTemplateId;
  role: SectionArrangementRole;
  label: string;
  progressionId: string;
  usage?: "verse" | "preChorus" | "chorus" | "bridge" | "any";
}

/**
 * The arranger's small, role-aware catalogue. Every role has at least two
 * stable ids; the actual harmonic material remains the existing, audited
 * progression catalogue.
 */
export const SECTION_TEMPLATE_CATALOG: readonly SectionTemplate[] = [
  { id: "intro-ambient", role: "intro", label: "Ambient", progressionId: "cliche-descending", usage: "verse" },
  { id: "intro-hook", role: "intro", label: "Hook", progressionId: "minor-three-chord", usage: "any" },
  { id: "a-narrative", role: "aMelo", label: "Narrative", progressionId: "cliche-descending", usage: "verse" },
  { id: "a-groove", role: "aMelo", label: "Groove", progressionId: "fifties", usage: "any" },
  { id: "b-build", role: "bMelo", label: "Build", progressionId: "axis", usage: "chorus" },
  { id: "b-lift", role: "bMelo", label: "Lift", progressionId: "minor-descending", usage: "any" },
  { id: "c-release", role: "cMelo", label: "Release", progressionId: "royal-road-triads", usage: "chorus" },
  { id: "c-contrast", role: "cMelo", label: "Contrast", progressionId: "minor-three-chord", usage: "any" },
];

const TEMPLATE_BY_ID = new Map<string, SectionTemplate>(SECTION_TEMPLATE_CATALOG.map((template) => [template.id, template]));
const ROLE_TO_SECTION_KIND: Readonly<Record<SectionArrangementRole, "intro" | "verse" | "preChorus" | "chorus">> = {
  intro: "intro",
  aMelo: "verse",
  bMelo: "preChorus",
  cMelo: "chorus",
};
const SECTION_LENGTHS: readonly SectionArrangementLength[] = [8, 16, 24, 32];
const ARRANGEMENT_BAR_COUNTS: readonly number[] = [
  8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128,
];

export function getSectionArrangementTemplate(id: string): SectionTemplate | undefined {
  return TEMPLATE_BY_ID.get(id);
}

export const getSectionTemplate = getSectionArrangementTemplate;

export function sectionArrangementTemplatesForRole(
  role: SectionArrangementRole,
): readonly SectionTemplate[] {
  return SECTION_TEMPLATE_CATALOG.filter((template) => template.role === role);
}

export interface SectionGenerationOptions {
  /** Settings shared by the project; section design fields override key/mode/style/bars. */
  baseSettings?: GeneratorSettings;
  /** Optional project seed used to derive a source-local deterministic stream. */
  projectSeed?: Seed;
  /** Revision is part of the stream so an explicit regenerate is reproducible. */
  revision?: number;
}

export interface SectionArrangementIssue {
  code: string;
  message: string;
  sectionId?: string;
  instanceId?: string;
  linkId?: string;
}

export interface SectionArrangementValidation {
  valid: boolean;
  errors: SectionArrangementIssue[];
  warnings: SectionArrangementIssue[];
}

export type SectionArrangementAssemblyResult =
  | {
      ok: true;
      composition: GeneratedComposition;
      plan: SectionArrangementPlan;
      resolvedLinks: ResolvedSectionLink[];
    }
  | { ok: false; issues: SectionArrangementIssue[] };

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(code: string, message: string, context: Partial<SectionArrangementIssue> = {}): SectionArrangementIssue {
  return { code, message, ...context };
}

function result(errors: SectionArrangementIssue[], warnings: SectionArrangementIssue[] = []): SectionArrangementValidation {
  return { valid: errors.length === 0, errors, warnings };
}

function isRole(value: unknown): value is SectionArrangementRole {
  return value === "intro" || value === "aMelo" || value === "bMelo" || value === "cMelo";
}

function isLinkMode(value: unknown): value is SectionLinkMode {
  return value === "auto" || value === "direct" || value === "dominant" || value === "pivot";
}

function isLinkTechnique(value: unknown): value is SectionLinkTechnique {
  return [
    "direct", "pivot", "secondaryDominant", "commonTone", "voiceLeading",
    "tritoneSub", "backdoor", "diminishedApproach", "chromaticApproach", "subdominantPrep",
  ].includes(value as SectionLinkTechnique);
}

function isSectionLength(value: unknown): value is SectionArrangementLength {
  return SECTION_LENGTHS.includes(value as SectionArrangementLength);
}

function isStyle(value: unknown): value is StylePresetId {
  return ["pop", "j-pop", "rock", "jazz", "lo-fi", "edm", "ballad", "game-music", "random"]
    .includes(value as StylePresetId);
}

function templateForRoleAndMode(role: SectionArrangementRole, mode: Mode): SectionTemplate {
  const candidates = SECTION_TEMPLATE_CATALOG.filter((template) => {
    if (template.role !== role) return false;
    const progression = getProgressionTemplate(template.progressionId);
    return progression?.modes.includes(mode) ?? false;
  });
  return candidates[0] ?? SECTION_TEMPLATE_CATALOG.find((template) => template.role === role) as SectionTemplate;
}

function sourceSettings(
  design: SectionDesign,
  generation: SectionGenerationOptions,
): { settings: GeneratorSettings; derivedSeed: string } {
  const base = clone(generation.baseSettings ?? {
    key: design.key,
    mode: design.mode,
    bpm: 120,
    timeSignature: "4/4",
    bars: design.bars,
    style: design.style,
    seed: design.seed,
    melody: {
      minMidi: 55,
      maxMidi: 88,
      density: 0.52,
      velocity: 92,
      chordToneRate: 0.68,
      restRate: 0.14,
      syncopation: 0.18,
      leapProbability: 0.12,
    },
  } as GeneratorSettings);
  const stream = generation.projectSeed ?? design.seed;
  const revision = generation.revision ?? 0;
  const derivedSeed = deriveSeed(
    stream,
    "section-arrangement-material",
    design.id,
    design.templateId,
    design.bars,
    design.seed,
    revision,
  );
  const template = TEMPLATE_BY_ID.get(design.templateId);
  if (!template || template.role !== design.role) {
    throw new RangeError(`Unknown section template '${design.templateId}' for role '${design.role}'.`);
  }
  const progression = getProgressionTemplate(template.progressionId);
  if (!progression || !progression.modes.includes(design.mode)) {
    throw new RangeError(`Section template '${design.templateId}' does not support mode '${design.mode}'.`);
  }
  return {
    derivedSeed,
    settings: {
      ...base,
      key: design.key,
      mode: design.mode,
      bars: design.bars as BarCount,
      style: design.style,
      seed: derivedSeed,
      progressionId: template.progressionId,
      // A source section is already an independent material span. Its own
      // legacy form planner must not create another plan inside it.
      songForm: { ...(base.songForm ?? {}), form: "none" },
    },
  };
}

/** Generates one immutable source definition; editing a design can keep this material and set dirty. */
export function generateArrangementSection(
  design: SectionDesign,
  generation: SectionGenerationOptions = {},
): SectionSourceDefinition {
  const { settings } = sourceSettings(design, generation);
  const material = generateComposition(settings);
  const flat = clone(material) as SectionMaterial;
  // The generator does not add an arrangement plan. Keep the explicit delete
  // as a guard for future callers that pass a composition-producing adapter.
  delete (flat as unknown as { arrangementPlan?: unknown }).arrangementPlan;
  return {
    design: clone(design),
    material: flat,
    generationRevision: generation.revision ?? 0,
    dirty: false,
  };
}

function defaultDesign(
  role: SectionArrangementRole,
  index: number,
  settings: GeneratorSettings,
): SectionDesign {
  const template = templateForRoleAndMode(role, settings.mode);
  return {
    id: `source-${role}`,
    role,
    name: role === "intro" ? "Intro" : role === "aMelo" ? "A" : role === "bMelo" ? "B" : "C",
    templateId: template.id,
    bars: 8,
    key: normalizePitchClass(settings.key),
    mode: settings.mode,
    style: settings.style,
    seed: deriveSeed(settings.seed, "section-design", role, index),
  };
}

function planId(seed: Seed): string {
  return `arrangement-${hashSeed(deriveSeed(seed, "plan")).toString(36)}`;
}

function seedForLink(planSeed: Seed, linkId: string): string {
  return deriveSeed(planSeed, "section-link", linkId);
}

/** Creates and generates the canonical Intro → A → B → C arrangement. */
export function createDefaultSectionArrangement(settings: GeneratorSettings): SectionArrangementPlan {
  const roles: readonly SectionArrangementRole[] = ["intro", "aMelo", "bMelo", "cMelo"];
  const sections = roles.map((role, index) => {
    const design = defaultDesign(role, index, settings);
    return generateArrangementSection(design, { baseSettings: settings, projectSeed: settings.seed });
  });
  const sequence: SectionSequenceInstance[] = roles.map((role) => ({
    id: `instance-${role}`,
    sourceSectionId: `source-${role}`,
  }));
  const links: SectionLinkConfig[] = sequence.slice(1).map((to, index) => ({
    id: `link-${sequence[index]?.id}-${to.id}`,
    fromInstanceId: sequence[index]?.id as string,
    toInstanceId: to.id,
    mode: "auto",
    seed: seedForLink(String(settings.seed), `link-${sequence[index]?.id}-${to.id}`),
  }));
  return {
    version: 1,
    id: planId(settings.seed),
    seed: String(settings.seed),
    revision: 0,
    assembledRevision: null,
    manualSongEdited: false,
    sections,
    sequence,
    links,
    resolvedLinks: [],
  };
}

function materialValidation(
  source: SectionSourceDefinition,
  errors: SectionArrangementIssue[],
): void {
  if (!isRecord(source)) {
    errors.push(issue("section.type", "Every source section must be an object."));
    return;
  }
  const design = source.design;
  const material = source.material;
  if (!isRecord(material)) {
    errors.push(issue("section.material", "Generated material is required.", { sectionId: isRecord(design) && typeof design.id === "string" ? design.id : undefined }));
    return;
  }
  const context = { sectionId: design.id };
  try {
    const validation = validateComposition(material as GeneratedComposition);
    if (!validation.valid) {
      errors.push(...validation.errors.map((entry) => issue(
        `material.${entry.code}`,
        entry.message,
        context,
      )));
    }
  } catch {
    errors.push(issue("material.invalid", "Generated material is malformed and could not be validated.", context));
  }
  if ((material as unknown as { arrangementPlan?: unknown }).arrangementPlan !== undefined) {
    errors.push(issue("material.nestedPlan", "Section material must not contain a nested arrangement plan.", context));
  }
  if (!Array.isArray(material.bars) || !isRecord(material.settings)
    || !Number.isFinite(material.totalTicks) || !Number.isFinite(material.ticksPerBar)
    || material.bars.length !== material.settings.bars
    || material.totalTicks !== material.ticksPerBar * material.settings.bars) {
    errors.push(issue("material.grid", "Section material must carry an exact local bar grid.", context));
  }
  // A dirty source deliberately retains its last generated material while the
  // draft design is edited. Validate that material against its own embedded
  // settings, but defer design/material equality until regeneration.
  if (!source.dirty && isRecord(material.settings)) {
    if (material.settings.bars !== design.bars) {
      errors.push(issue("material.bars", "Section material bars must equal its design bars.", context));
    }
    try {
      if (normalizePitchClass(material.settings.key) !== normalizePitchClass(design.key)) {
        errors.push(issue("material.key", "Section material key must equal its design key.", context));
      }
    } catch {
      errors.push(issue("material.key", "Section material key must be a supported pitch class.", context));
    }
    if (material.settings.mode !== design.mode || material.settings.style !== design.style) {
      errors.push(issue("material.design", "Section material mode/style must equal its design.", context));
    }
  }
}

/** Validates source material, sequence topology, lengths and adjacent link configuration. */
export function validateSectionArrangement(plan: SectionArrangementPlan): SectionArrangementValidation {
  const errors: SectionArrangementIssue[] = [];
  if (!plan || typeof plan !== "object") return result([issue("plan.type", "Arrangement plan must be an object.")]);
  if (plan.version !== 1) errors.push(issue("plan.version", "Only arrangement plan version 1 is supported."));
  if (typeof plan.id !== "string" || plan.id.length === 0) errors.push(issue("plan.id", "Arrangement plan id is required."));
  if (typeof plan.seed !== "string" || plan.seed.length === 0) errors.push(issue("plan.seed", "Arrangement plan seed is required."));
  if (!Number.isInteger(plan.revision) || plan.revision < 0) {
    errors.push(issue("plan.revision", "revision must be a non-negative integer."));
  }
  if (plan.assembledRevision !== null
    && (!Number.isInteger(plan.assembledRevision) || plan.assembledRevision < 0)) {
    errors.push(issue("plan.assembledRevision", "assembledRevision must be null or a non-negative integer."));
  }
  if (Number.isInteger(plan.revision) && Number.isInteger(plan.assembledRevision)
    && (plan.assembledRevision as number) > plan.revision) {
    errors.push(issue("plan.assembledRevision", "assembledRevision cannot exceed revision."));
  }
  if (typeof plan.manualSongEdited !== "boolean") errors.push(issue("plan.manualSongEdited", "manualSongEdited must be boolean."));
  if (!Array.isArray(plan.sections) || plan.sections.length === 0) {
    errors.push(issue("sections.empty", "At least one source section is required."));
  }
  if (!Array.isArray(plan.resolvedLinks)) {
    errors.push(issue("resolvedLinks.type", "resolvedLinks must be an array."));
  }

  const sections = Array.isArray(plan.sections) ? plan.sections : [];
  const sectionIds = new Set<string>();
  for (const source of sections) {
    if (!isRecord(source)) {
      errors.push(issue("section.type", "Every source section must be an object."));
      continue;
    }
    const design = source.design;
    if (!isRecord(design)) {
      errors.push(issue("section.design", "Every source section needs a design."));
      continue;
    }
    const sectionId = typeof design.id === "string" ? design.id : undefined;
    if (sectionId === undefined || sectionId.length === 0 || sectionIds.has(sectionId)) {
      errors.push(issue("section.id", "Source section ids must be non-empty and unique.", { sectionId: design.id }));
    }
    if (sectionId !== undefined) sectionIds.add(sectionId);
    if (!isRole(design.role)) errors.push(issue("section.role", "Section role is unsupported.", { sectionId }));
    if (typeof design.name !== "string" || design.name.trim().length === 0) errors.push(issue("section.name", "Section name is required.", { sectionId }));
    const template = TEMPLATE_BY_ID.get(design.templateId);
    if (!template || template.role !== design.role) {
      errors.push(issue("section.template", "Template id is not valid for this role.", { sectionId }));
    } else {
      const progression = getProgressionTemplate(template.progressionId);
      if (!progression || !progression.modes.includes(design.mode)) {
        errors.push(issue(
          "section.templateMode",
          `Template '${template.id}' does not support mode '${design.mode}'.`,
          { sectionId },
        ));
      }
    }
    if (!isSectionLength(design.bars)) errors.push(issue("section.bars", "Section length must be 8, 16, 24, or 32 bars.", { sectionId }));
    if (typeof design.key !== "string") errors.push(issue("section.key", "Section key is required.", { sectionId }));
    else {
      try { normalizePitchClass(design.key); } catch { errors.push(issue("section.key", "Section key is unsupported.", { sectionId })); }
    }
    if (typeof design.mode !== "string" || !isSupportedMode(design.mode)) errors.push(issue("section.mode", "Section mode is unsupported.", { sectionId }));
    if (!isStyle(design.style)) errors.push(issue("section.style", "Section style is unsupported.", { sectionId }));
    if ((typeof design.seed !== "string" && typeof design.seed !== "number")
      || (typeof design.seed === "string" && design.seed.length === 0)
      || (typeof design.seed === "number" && !Number.isFinite(design.seed))) {
      errors.push(issue("section.seed", "Section seed must be non-empty and finite.", { sectionId }));
    }
    if (!Number.isInteger(source.generationRevision) || source.generationRevision < 0) errors.push(issue("section.revision", "Generation revision must be non-negative.", { sectionId }));
    if (typeof source.dirty !== "boolean") errors.push(issue("section.dirty", "Dirty must be boolean.", { sectionId }));
    if (!isRecord(source.material)) errors.push(issue("section.material", "Generated material is required.", { sectionId }));
    else materialValidation(source as SectionSourceDefinition, errors);
  }

  const instances = Array.isArray(plan.sequence) ? plan.sequence : [];
  const instanceIds = new Set<string>();
  let totalBars = 0;
  for (const instance of instances) {
    if (!isRecord(instance)) {
      errors.push(issue("sequence.type", "Every sequence instance must be an object."));
      continue;
    }
    const instanceId = typeof instance.id === "string" ? instance.id : undefined;
    if (instanceId === undefined || instanceId.length === 0 || instanceIds.has(instanceId)) {
      errors.push(issue("sequence.id", "Sequence instance ids must be non-empty and unique.", { instanceId }));
    }
    if (instanceId !== undefined) instanceIds.add(instanceId);
    const source = sections.find((entry) =>
      isRecord(entry) && isRecord(entry.design) && entry.design.id === instance.sourceSectionId,
    );
    if (!source || !isRecord(source.design) || !isSectionLength(source.design.bars)) {
      errors.push(issue("sequence.reference", "Sequence references a missing source section.", { instanceId }));
    } else totalBars += source.design.bars;
  }
  if (instances.length === 0) errors.push(issue("sequence.empty", "Sequence must contain at least one instance."));
  if (totalBars > 128) errors.push(issue("sequence.totalBars", "Assembled sequence cannot exceed 128 bars."));
  if (totalBars > 0 && !ARRANGEMENT_BAR_COUNTS.includes(totalBars)) errors.push(issue("sequence.grid", "Sequence total must be a multiple of 8 through 128 bars."));

  const links = Array.isArray(plan.links) ? plan.links : [];
  const linkIds = new Set<string>();
  const expected = new Set<string>();
  for (let index = 1; index < instances.length; index += 1) {
    expected.add(`${instances[index - 1]?.id}->${instances[index]?.id}`);
  }
  for (const link of links) {
    if (!isRecord(link)) {
      errors.push(issue("link.type", "Every section link must be an object."));
      continue;
    }
    const linkId = typeof link.id === "string" ? link.id : undefined;
    if (linkId === undefined || linkId.length === 0 || linkIds.has(linkId)) errors.push(issue("link.id", "Link ids must be non-empty and unique.", { linkId }));
    if (linkId !== undefined) linkIds.add(linkId);
    const pair = `${link.fromInstanceId}->${link.toInstanceId}`;
    if (!expected.has(pair)) errors.push(issue("link.adjacency", "Links must connect adjacent sequence instances.", { linkId: link.id }));
    expected.delete(pair);
    if (!isLinkMode(link.mode)) errors.push(issue("link.mode", "Link mode is unsupported.", { linkId: link.id }));
    if (typeof link.seed !== "string" || link.seed.length === 0) {
      errors.push(issue("link.seed", "Link seed must be non-empty.", { linkId: link.id }));
    } else if (typeof plan.seed === "string" && link.seed !== seedForLink(plan.seed, link.id as string)) {
      errors.push(issue("link.seed", "Link seed must be derived from the arrangement seed and stable link id.", { linkId: link.id }));
    }
  }
  for (const pair of expected) errors.push(issue("link.missing", `Missing link configuration for ${pair}.`));

  const resolvedLinks = Array.isArray(plan.resolvedLinks) ? plan.resolvedLinks : [];
  const resolvedIds = new Set<string>();
  for (const resolved of resolvedLinks) {
    if (!isRecord(resolved)) {
      errors.push(issue("resolvedLinks.entry", "Every resolved link must be an object."));
      continue;
    }
    if (typeof resolved.linkId !== "string" || resolved.linkId.length === 0 || resolvedIds.has(resolved.linkId)) {
      errors.push(issue("resolvedLinks.id", "Resolved link ids must be non-empty and unique.", { linkId: resolved.linkId }));
    }
    if (typeof resolved.linkId === "string") resolvedIds.add(resolved.linkId);
    if (typeof resolved.fromInstanceId !== "string" || typeof resolved.toInstanceId !== "string") errors.push(issue("resolvedLinks.reference", "Resolved link instance ids are required.", { linkId: resolved.linkId }));
    if (!Number.isInteger(resolved.boundaryBar) || resolved.boundaryBar < 0) errors.push(issue("resolvedLinks.boundary", "Resolved link boundaryBar must be a non-negative integer.", { linkId: resolved.linkId }));
    if (!isLinkMode(resolved.mode)) errors.push(issue("resolvedLinks.mode", "Resolved link mode is unsupported.", { linkId: resolved.linkId }));
    if (!isLinkTechnique(resolved.technique)) errors.push(issue("resolvedLinks.technique", "Resolved link technique is unsupported.", { linkId: resolved.linkId }));
    if (typeof resolved.label !== "string" || typeof resolved.explanation !== "string") errors.push(issue("resolvedLinks.explanation", "Resolved link label and explanation are required.", { linkId: resolved.linkId }));
  }
  if (plan.assembledRevision === plan.revision && plan.manualSongEdited === false) {
    const validLinkRecords = links.filter(isRecord) as SectionLinkConfig[];
    if (resolvedLinks.length !== validLinkRecords.length) {
      errors.push(issue("resolvedLinks.coverage", "Current assembled links must have exactly one resolved explanation each."));
    }
    let boundaryBar = 0;
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index];
      if (!isRecord(instance) || typeof instance.id !== "string") continue;
      if (index > 0) {
        const link = validLinkRecords.find((candidate) => candidate.fromInstanceId === instances[index - 1]?.id && candidate.toInstanceId === instance.id);
        const resolved = resolvedLinks.find((candidate) => isRecord(candidate) && candidate.linkId === link?.id) as ResolvedSectionLink | undefined;
        if (!link || !resolved || resolved.fromInstanceId !== link.fromInstanceId || resolved.toInstanceId !== link.toInstanceId || resolved.mode !== link.mode || resolved.boundaryBar !== boundaryBar) {
          errors.push(issue("resolvedLinks.coverage", "Resolved links must match current adjacent links and boundaries.", { linkId: link?.id }));
        }
      }
      const source = sections.find((entry) => isRecord(entry) && isRecord(entry.design) && entry.design.id === instance.sourceSectionId);
      if (source && isRecord(source.design) && isSectionLength(source.design.bars)) boundaryBar += source.design.bars;
    }
  }
  return result(errors);
}

/** Keeps links attached to instance ids when a sequence is reordered or repeated. */
export function reconcileSectionLinks(
  plan: SectionArrangementPlan,
  sequence: readonly SectionSequenceInstance[],
): SectionArrangementPlan {
  const previous = new Map(plan.links.map((link) => [`${link.fromInstanceId}->${link.toInstanceId}`, link]));
  const links = sequence.slice(1).map((to, index) => {
    const from = sequence[index] as SectionSequenceInstance;
    const pair = `${from.id}->${to.id}`;
    const existing = previous.get(pair);
    return existing ? clone(existing) : {
      id: `link-${from.id}-${to.id}`,
      fromInstanceId: from.id,
      toInstanceId: to.id,
      mode: "auto" as const,
      seed: seedForLink(plan.seed, `link-${from.id}-${to.id}`),
    };
  });
  const nextSequence = [...clone(sequence)];
  if (JSON.stringify(plan.sequence) === JSON.stringify(nextSequence)
    && JSON.stringify(plan.links) === JSON.stringify(links)) {
    return plan;
  }
  return {
    ...clone(plan),
    revision: plan.revision + 1,
    sequence: nextSequence,
    links,
    resolvedLinks: [],
  };
}

export const reconcileArrangementLinks = reconcileSectionLinks;

/** Applies a design-only edit without overwriting the previous material. */
export function updateSectionDesign(
  plan: SectionArrangementPlan,
  sectionId: string,
  patch: Partial<Omit<SectionDesign, "id" | "role">>,
): SectionArrangementPlan {
  const { id: _ignoredId, role: _ignoredRole, ...designPatch } = patch as Partial<SectionDesign>;
  void _ignoredId;
  void _ignoredRole;
  const source = plan.sections.find((entry) => entry.design.id === sectionId);
  if (!source) return plan;
  const design = { ...source.design, ...designPatch };
  if (JSON.stringify(design) === JSON.stringify(source.design)) return plan;
  const sections = plan.sections.map((entry) => entry.design.id === sectionId
    ? { ...clone(entry), design, dirty: true }
    : clone(entry));
  return {
    ...clone(plan),
    revision: plan.revision + 1,
    sections,
    resolvedLinks: [],
  };
}

function sectionInstanceMap(plan: SectionArrangementPlan): Map<string, SectionSourceDefinition> {
  return new Map(plan.sections.map((source) => [source.design.id, source]));
}

function offsetNote(note: NoteEvent, offsetTick: number, offsetBar: number, prefix: string): NoteEvent {
  return {
    ...note,
    id: `${prefix}:${note.id}`,
    startTick: note.startTick + offsetTick,
    barIndex: note.barIndex + offsetBar,
  };
}

function offsetChord(chord: ChordEvent, offsetTick: number, prefix: string): ChordEvent {
  return {
    ...chord,
    id: `${prefix}:${chord.id}`,
    startTick: chord.startTick + offsetTick,
  };
}

interface OffsetMaterial {
  chords: ChordEvent[];
  notes: NoteEvent[];
  voices: NonNullable<SectionMaterial["voices"]>;
  lockedBars: number[];
}

function offsetMaterial(material: SectionMaterial, offsetBar: number, offsetTick: number, instanceId: string): OffsetMaterial {
  return {
    chords: material.chords.map((chord) => offsetChord(chord, offsetTick, instanceId)),
    notes: material.notes.map((note) => offsetNote(note, offsetTick, offsetBar, instanceId)),
    voices: (material.voices ?? []).map((voice) => ({
      ...voice,
      id: `${instanceId}:${voice.id}`,
      notes: voice.notes.map((note) => offsetNote(note, offsetTick, offsetBar, `${instanceId}:${voice.id}`)),
    })),
    lockedBars: material.lockedBars.map((bar) => bar + offsetBar),
  };
}

function noteName(midi: number): string {
  return midiToNoteName(midi);
}

function smoothMelodyByInstance(
  instanceNotes: ReadonlyMap<string, NoteEvent[]>,
  sequence: readonly SectionSequenceInstance[],
  settings: GeneratorSettings,
): NoteEvent[] {
  let previousLast: NoteEvent | undefined;
  const result: NoteEvent[] = [];
  for (const [index, instance] of sequence.entries()) {
    const notes = [...(instanceNotes.get(instance.id) ?? [])]
      .sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id));
    if (index > 0 && previousLast && notes.length > 0) {
      const first = notes[0] as NoteEvent;
      const previousMidi = previousLast.midi;
      const candidates: number[] = [];
      for (let octave = -8; octave <= 8; octave += 1) {
        const offset = octave * 12;
        if (notes.every((note) => {
          const midi = note.midi + offset;
          return midi >= settings.melody.minMidi && midi <= settings.melody.maxMidi;
        })) candidates.push(offset);
      }
      const chosen = candidates.sort((left, right) =>
        Math.abs((first.midi + left) - previousMidi) - Math.abs((first.midi + right) - previousMidi)
        || Math.abs(left) - Math.abs(right)
        || left - right,
      )[0];
      if (chosen !== undefined) {
        for (const note of notes) {
          note.midi += chosen;
          note.noteName = noteName(note.midi);
        }
      }
    }
    if (notes.length > 0) previousLast = notes[notes.length - 1];
    result.push(...notes);
  }
  return result.sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id));
}

function hasCommonPitchClass(left: ChordEvent, right: ChordEvent): boolean {
  const tones = new Set(left.notes.map((note) => ((note % 12) + 12) % 12));
  return right.notes.some((note) => tones.has(((note % 12) + 12) % 12));
}

function transitionCandidate(
  link: SectionLinkConfig,
  previous: SectionSourceDefinition,
  incoming: SectionSourceDefinition,
  options: { style: StylePresetId },
): { transition: TransitionChord | null; pivot?: ReturnType<typeof findPivotChords>[number]; technique: SectionLinkTechnique; label: string; explanation: string } | { error: SectionArrangementIssue } {
  const from = previous.material.chords.at(-1);
  const to = incoming.material.chords[0];
  if (!from || !to) return { error: issue("link.material", "Link endpoint material has no boundary chord.", { linkId: link.id }) };
  const fromKey = previous.design.key;
  const toKey = incoming.design.key;
  const sameKey = pitchClassToSemitone(fromKey) === pitchClassToSemitone(toKey)
    && previous.design.mode === incoming.design.mode;
  if (link.mode === "pivot" && sameKey) {
    return { error: issue("link.pivotSameKey", "A forced pivot requires an actual key or mode change.", { linkId: link.id }) };
  }
  if (link.mode === "direct") {
    return { transition: null, technique: "direct", label: "Direct", explanation: "Direct section join; no transition chord was added." };
  }
  if (link.mode === "pivot" || (link.mode === "auto" && !sameKey)) {
    const [pivot] = findPivotChords(fromKey, previous.design.mode, toKey, incoming.design.mode);
    if (pivot) {
      return {
        transition: null,
        pivot,
        technique: "pivot",
        label: `Pivot ${pivot.root}`,
        explanation: `Shared diatonic pivot: degree ${pivot.degreeInSource} in ${fromKey} and degree ${pivot.degreeInTarget} in ${toKey}.`,
      };
    }
    if (link.mode === "pivot") {
      return { error: issue("link.pivotUnavailable", "No real shared diatonic pivot exists for this key change.", { linkId: link.id }) };
    }
    // Auto falls through to the deterministic dominant fallback when a pivot
    // cannot be proved in both keys.
  }
  if (link.mode === "dominant" || (link.mode === "auto" && !sameKey)) {
    const dominant = transitionsInto(to.root, to.quality, pitchClassToSemitone(toKey))
      .find((candidate) => candidate.technique === "secondaryDominant");
    if (!dominant) return { error: issue("link.dominantUnavailable", "No valid secondary-dominant approach exists for this boundary.", { linkId: link.id }) };
    return {
      transition: dominant,
      technique: "secondaryDominant",
      label: dominant.label,
      explanation: dominant.explanation,
    };
  }
  const planned = planTransition(
    { root: from.root, quality: from.quality },
    { root: to.root, quality: to.quality },
    {
      style: options.style,
      seed: link.seed,
      boundaryIndex: 0,
      tonicSemitone: pitchClassToSemitone(toKey),
      mode: incoming.design.mode,
    },
  );
  return planned
    ? { transition: planned, technique: planned.technique, label: planned.label, explanation: planned.explanation }
    : hasCommonPitchClass(from, to)
      ? { transition: null, technique: "commonTone", label: "Common tone", explanation: "No extra chord was required; the outgoing and incoming voicings share a sounding pitch class." }
      : { transition: null, technique: "voiceLeading", label: "Voice leading", explanation: "No extra chord was required; continuity is provided by global voice-leading without a shared pitch class." };
}

function insertTransition(
  chords: ChordEvent[],
  boundaryBar: number,
  ticksPerBarValue: number,
  transition: TransitionChord,
  id: string,
): ChordEvent[] | null {
  const boundaryTick = boundaryBar * ticksPerBarValue;
  const incomingIndex = chords.findIndex((chord) => chord.startTick === boundaryTick);
  if (incomingIndex <= 0) return null;
  const outgoing = chords[incomingIndex - 1] as ChordEvent;
  const incoming = chords[incomingIndex] as ChordEvent;
  if (outgoing.startTick + outgoing.durationTick !== boundaryTick
    || outgoing.durationTick < ticksPerBarValue / 2) return null;
  const half = Math.floor(outgoing.durationTick / 2);
  if (half <= 0) return null;
  const approachNotes = voiceChord(transition.root, transition.quality, outgoing.notes).notes;
  const approach: ChordEvent = {
    ...incoming,
    id: `${id}:transition`,
    symbol: `${transition.root}${transitionQualitySuffix(transition.quality)}`,
    romanNumeral: transition.label,
    function: transition.harmonyFunction,
    degree: 0,
    root: normalizePitchClass(transition.root),
    quality: transition.quality,
    startTick: outgoing.startTick + outgoing.durationTick - half,
    durationTick: half,
    notes: approachNotes,
    inversion: 0,
    source: "other",
    leftHand: undefined,
    tensions: undefined,
    bass: undefined,
    specialKind: undefined,
    targetDegree: undefined,
    borrowedFromMode: undefined,
    transformation: undefined,
    explanation: transition.explanation,
  };
  return [
    ...chords.slice(0, incomingIndex - 1),
    { ...outgoing, durationTick: outgoing.durationTick - half },
    approach,
    ...chords.slice(incomingIndex),
  ];
}

function transitionQualitySuffix(quality: ChordEvent["quality"]): string {
  switch (quality) {
    case "dominant7": return "7";
    case "diminished7": return "dim7";
    case "major7": return "maj7";
    case "minor7": return "m7";
    case "minor": return "m";
    case "minorMajor7": return "mMaj7";
    case "minorAdd9": return "madd9";
    case "add9": return "add9";
    case "sus2": return "sus2";
    case "sus4": return "sus4";
    case "diminished": return "dim";
    case "augmented": return "aug";
    case "halfDiminished7": return "m7b5";
    case "augmentedMajor7": return "augMaj7";
    default: return "";
  }
}

function insertPivot(
  chords: ChordEvent[],
  boundaryBar: number,
  ticksPerBarValue: number,
  pivot: ReturnType<typeof findPivotChords>[number],
  from: SectionDesign,
  id: string,
): ChordEvent[] | null {
  const boundaryTick = boundaryBar * ticksPerBarValue;
  const incomingIndex = chords.findIndex((chord) => chord.startTick === boundaryTick);
  if (incomingIndex <= 0) return null;
  const outgoing = chords[incomingIndex - 1] as ChordEvent;
  if (outgoing.startTick + outgoing.durationTick !== boundaryTick
    || outgoing.durationTick < ticksPerBarValue / 2) return null;
  const half = Math.floor(outgoing.durationTick / 2);
  if (half <= 0) return null;
  const pivotChord = createDiatonicChordEvent({
    key: from.key,
    mode: from.mode,
    degree: pivot.degreeInSource,
    startTick: outgoing.startTick + outgoing.durationTick - half,
    durationTick: half,
    id: `${id}:pivot`,
    previousNotes: outgoing.notes,
    voiceLeadingStrength: 1,
  });
  return [
    ...chords.slice(0, incomingIndex - 1),
    { ...outgoing, durationTick: outgoing.durationTick - half },
    {
      ...pivotChord,
      explanation: `Pivot: ${pivot.root} is degree ${pivot.degreeInSource} of ${from.key} ${from.mode} and degree ${pivot.degreeInTarget} of the incoming key.`,
    },
    ...chords.slice(incomingIndex),
  ];
}

function reconcileMelodyWindow(
  notes: NoteEvent[],
  chords: readonly ChordEvent[],
  startTick: number,
  endTick: number,
  section: SectionDesign,
  settings: GeneratorSettings,
  linkId: string,
): SectionArrangementIssue | null {
  const chordTones = new Set(chords
    .filter((chord) => chord.startTick < endTick && chord.startTick + chord.durationTick > startTick)
    .flatMap((chord) => chord.notes.map((note) => ((note % 12) + 12) % 12)));
  const scaleTones = new Set(getScalePitchClasses(section.key, section.mode)
    .map((root) => pitchClassToSemitone(root)));
  for (const note of notes) {
    if (note.startTick < startTick || note.startTick >= endTick) continue;
    let best = note.midi;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let candidate = settings.melody.minMidi; candidate <= settings.melody.maxMidi; candidate += 1) {
      const pitchClass = ((candidate % 12) + 12) % 12;
      if (!chordTones.has(pitchClass) && !scaleTones.has(pitchClass)) continue;
      const distance = Math.abs(candidate - note.midi);
      if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (!Number.isFinite(bestDistance)) {
      return issue("link.melodyWindow", "No transition chord or incoming-scale pitch fits the configured melody range.", { linkId });
    }
    note.midi = best;
    note.noteName = noteName(best);
    const pitchClass = ((best % 12) + 12) % 12;
    note.role = chordTones.has(pitchClass)
      ? "chordTone"
      : "scaleTone";
  }
  return null;
}

function mergeVoices(
  voices: NonNullable<GeneratedComposition["voices"]>,
): NonNullable<GeneratedComposition["voices"]> {
  const groups = new Map<string, NonNullable<GeneratedComposition["voices"]>[number]>();
  for (const voice of voices) {
    const key = `${voice.role}:${voice.instrument}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...voice, id: `arranged-${key}`, notes: [...voice.notes] });
    } else {
      existing.notes.push(...voice.notes);
      existing.muted = existing.muted && (voice.muted ?? false);
    }
  }
  return [...groups.values()].map((voice) => ({
    ...voice,
    notes: [...voice.notes].sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id)),
  }));
}

function smoothChords(
  chords: readonly ChordEvent[],
  settings: GeneratorSettings,
): ChordEvent[] {
  const voiceLeading: VoiceLeadingSettings = settings.voiceLeading ?? { enabled: true, optimizeSequence: true };
  const revoiced = revoiceInFourParts(chords, {
    key: settings.key,
    mode: settings.mode,
    style: settings.style,
    profileName: voiceLeading.profile,
    optimizeSequence: voiceLeading.optimizeSequence ?? true,
  });
  return revoiced.map((chord) => withHands(chord, {
    shell: settings.bassRegister?.shell ?? false,
    bassFor: (lowest) => bassRegisterPitch(lowest, settings.bassRegister),
  }));
}

/** Assembles independent source materials into one derived, validated composition. */
export function assembleSectionArrangement(
  plan: SectionArrangementPlan,
  baseSettings: GeneratorSettings,
): SectionArrangementAssemblyResult {
  const structural = validateSectionArrangement(plan);
  if (!structural.valid) return { ok: false, issues: structural.errors };
  const sources = sectionInstanceMap(plan);
  const totalBars = plan.sequence.reduce((sum, instance) => sum + (sources.get(instance.sourceSectionId)?.design.bars ?? 0), 0);
  const finalSettings: GeneratorSettings = {
    ...clone(baseSettings),
    bars: totalBars as BarCount,
    songForm: { ...(baseSettings.songForm ?? {}), form: "none" },
    progressionId: undefined,
    seed: deriveSeed(plan.seed, "assembled", plan.id, plan.revision, totalBars),
  };
  const settingsIssues = validateGeneratorSettings(finalSettings, { allowArrangementBars: true });
  if (!settingsIssues.valid) return { ok: false, issues: settingsIssues.errors.map((entry) => issue(`settings.${entry.code}`, entry.message)) };

  const first = plan.sequence[0] ? sources.get(plan.sequence[0].sourceSectionId) : undefined;
  if (!first) return { ok: false, issues: [issue("sequence.reference", "Sequence has no first source material.")] };
  const expectedTicks = ticksPerBar(baseSettings.timeSignature, first.material.ppq);
  const errors: SectionArrangementIssue[] = [];
  const referencedSourceIds = new Set(plan.sequence.map((instance) => instance.sourceSectionId));
  for (const source of plan.sections.filter((entry) => referencedSourceIds.has(entry.design.id))) {
    if (source.dirty) errors.push(issue("section.dirty", "Dirty source material must be regenerated before assembly.", { sectionId: source.design.id }));
    if (source.material.ppq !== first.material.ppq || source.material.timeSignature !== baseSettings.timeSignature) {
      errors.push(issue("section.globalSettings", "All source materials must share time signature and PPQ with the assembly.", { sectionId: source.design.id }));
    }
    if (source.material.ticksPerBar !== expectedTicks) errors.push(issue("section.grid", "Source material tick grid does not match the arrangement time signature.", { sectionId: source.design.id }));
  }
  if (errors.length > 0) return { ok: false, issues: errors };

  const ticks = expectedTicks;
  let offsetBar = 0;
  const chords: ChordEvent[] = [];
  const notes: NoteEvent[] = [];
  const instanceNotes = new Map<string, NoteEvent[]>();
  const voices: NonNullable<GeneratedComposition["voices"]> = [];
  const lockedBars: number[] = [];
  const sections: NonNullable<GeneratedComposition["sections"]> = [];
  const instanceRanges = new Map<string, { startBar: number; endBar: number; source: SectionSourceDefinition }>();
  for (const instance of plan.sequence) {
    const source = sources.get(instance.sourceSectionId) as SectionSourceDefinition;
    const endBar = offsetBar + source.design.bars;
    const offset = offsetMaterial(source.material, offsetBar, offsetBar * ticks, instance.id);
    chords.push(...offset.chords);
    notes.push(...offset.notes);
    instanceNotes.set(instance.id, offset.notes);
    voices.push(...offset.voices);
    lockedBars.push(...offset.lockedBars);
    sections.push({
      id: instance.id,
      kind: ROLE_TO_SECTION_KIND[source.design.role],
      startBar: offsetBar,
      endBar,
      key: normalizePitchClass(source.design.key),
      mode: source.design.mode,
      transpose: pitchClassToSemitone(source.design.key) - pitchClassToSemitone(baseSettings.key),
      progressionId: source.material.settings.progressionId,
    });
    instanceRanges.set(instance.id, { startBar: offsetBar, endBar, source });
    offsetBar = endBar;
  }

  const resolvedLinks: ResolvedSectionLink[] = [];
  let linkedChords = [...chords].sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id));
  for (const link of plan.links) {
    const fromRange = instanceRanges.get(link.fromInstanceId);
    const toRange = instanceRanges.get(link.toInstanceId);
    if (!fromRange || !toRange) return { ok: false, issues: [issue("link.reference", "Link references a missing sequence instance.", { linkId: link.id })] };
    const candidate = transitionCandidate(link, fromRange.source, toRange.source, {
      style: toRange.source.material.resolvedStyle,
    });
    if ("error" in candidate) return { ok: false, issues: [candidate.error] };
    if (candidate.pivot) {
      const next = insertPivot(linkedChords, toRange.startBar, ticks, candidate.pivot, fromRange.source.design, link.id);
      if (!next) return { ok: false, issues: [issue("link.pivotWindow", "Pivot link has no writable boundary window.", { linkId: link.id })] };
      linkedChords = next;
    } else if (candidate.transition) {
      const next = insertTransition(linkedChords, toRange.startBar, ticks, candidate.transition, link.id);
      if (!next) return { ok: false, issues: [issue("link.transitionWindow", "Transition link has no writable boundary window.", { linkId: link.id })] };
      linkedChords = next;
    }
    const transitionChord = linkedChords.find((chord) => chord.id === `${link.id}:transition` || chord.id === `${link.id}:pivot`);
    if (transitionChord) {
      const melodyIssue = reconcileMelodyWindow(
        notes,
        [transitionChord],
        transitionChord.startTick,
        transitionChord.startTick + transitionChord.durationTick,
        toRange.source.design,
        finalSettings,
        link.id,
      );
      if (melodyIssue) return { ok: false, issues: [melodyIssue] };
    }
    resolvedLinks.push({
      linkId: link.id,
      fromInstanceId: link.fromInstanceId,
      toInstanceId: link.toInstanceId,
      boundaryBar: toRange.startBar,
      mode: link.mode,
      technique: candidate.technique,
      label: candidate.label,
      explanation: candidate.explanation,
    });
  }

  linkedChords = smoothChords(linkedChords, finalSettings);
  const smoothedNotes = smoothMelodyByInstance(instanceNotes, plan.sequence, finalSettings);
  const mergedVoices = mergeVoices(voices);
  const assembledPlan = {
    ...clone(plan),
    assembledRevision: plan.revision,
    manualSongEdited: false,
    resolvedLinks,
  } satisfies SectionArrangementPlan;
  const composition: GeneratedComposition = {
    id: `composition-${hashSeed(deriveSeed(plan.id, plan.seed, plan.revision, totalBars)).toString(36)}`,
    version: 1,
    seed: String(finalSettings.seed),
    settings: finalSettings,
    ppq: first.material.ppq,
    ticksPerBar: ticks,
    totalTicks: ticks * totalBars,
    timeSignature: finalSettings.timeSignature,
    resolvedStyle: first.material.resolvedStyle,
    cadence: (sources.get(plan.sequence.at(-1)?.sourceSectionId ?? "")?.material.cadence ?? first.material.cadence),
    bars: createBars(totalBars as BarCount, finalSettings.timeSignature, first.material.ppq),
    chords: linkedChords,
    notes: smoothedNotes,
    ...(mergedVoices.length > 0 ? { voices: mergedVoices } : {}),
    lockedBars: [...new Set(lockedBars)].sort((left, right) => left - right),
    sections,
    arrangementPlan: assembledPlan,
  };
  const finalValidation: ValidationResult = validateComposition(composition);
  if (!finalValidation.valid) {
    return {
      ok: false,
      issues: finalValidation.errors.map((entry) => issue(`composition.${entry.code}`, entry.message)),
    };
  }
  return { ok: true, composition, plan: assembledPlan, resolvedLinks };
}
